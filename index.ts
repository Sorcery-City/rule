import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import fetch from "node-fetch";

admin.initializeApp();
const db = admin.firestore();

// ============================================================
// ★ ここを自分の設定に変更してください ★
// ============================================================
const CONFIG = {
  DISCORD_CLIENT_ID: functions.config().discord.client_id,
  DISCORD_CLIENT_SECRET: functions.config().discord.client_secret,
  DISCORD_GUILD_ID: functions.config().discord.guild_id,       // サーバーID
  DISCORD_BOT_TOKEN: functions.config().discord.bot_token,     // BotトークンTOKEN
  // 管理者ログを見られるロールID（複数指定可）
  ALLOWED_ROLE_IDS: (functions.config().discord.allowed_role_ids as string).split(","),
  // 管理者ログを見られるユーザーID（複数指定可）
  ALLOWED_USER_IDS: (functions.config().discord.allowed_user_ids as string).split(","),
  // GitHub Pagesのドメイン（例: https://yourname.github.io）
  SITE_URL: functions.config().discord.site_url,
};

// ============================================================
// Step1: Discord OAuthのリダイレクト先URLを返す
// ============================================================
export const getAuthUrl = functions.https.onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", CONFIG.SITE_URL);
  res.set("Access-Control-Allow-Methods", "GET");

  const params = new URLSearchParams({
    client_id: CONFIG.DISCORD_CLIENT_ID,
    redirect_uri: `${CONFIG.SITE_URL}/callback.html`,
    response_type: "code",
    scope: "identify guilds.members.read",
  });

  res.json({ url: `https://discord.com/oauth2/authorize?${params}` });
});

// ============================================================
// Step2: codeをトークンに交換 → ユーザー情報取得 → ロール確認 → ログ記録
// ============================================================
export const discordCallback = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", CONFIG.SITE_URL);
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const { code } = req.body;
  if (!code) { res.status(400).json({ error: "code is required" }); return; }

  try {
    // 1. codeをaccess_tokenに交換
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CONFIG.DISCORD_CLIENT_ID,
        client_secret: CONFIG.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${CONFIG.SITE_URL}/callback.html`,
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) throw new Error("Token exchange failed");

    const accessToken = tokenData.access_token;

    // 2. ユーザー情報取得
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = await userRes.json() as any;

    // 3. サーバーメンバー情報取得（ロール確認用）
    const memberRes = await fetch(
      `https://discord.com/api/guilds/${CONFIG.DISCORD_GUILD_ID}/members/${user.id}`,
      { headers: { Authorization: `Bot ${CONFIG.DISCORD_BOT_TOKEN}` } }
    );

    let roles: string[] = [];
    let nickname = user.username;
    if (memberRes.ok) {
      const member = await memberRes.json() as any;
      roles = member.roles || [];
      nickname = member.nick || user.global_name || user.username;
    }

    // 4. 管理者権限チェック
    const hasAllowedRole = CONFIG.ALLOWED_ROLE_IDS.some(r => r && roles.includes(r));
    const isAllowedUser = CONFIG.ALLOWED_USER_IDS.includes(user.id);
    const isAdmin = hasAllowedRole || isAllowedUser;

    // 5. 閲覧ログ記録（全員）
    const logData = {
      discordId: user.id,
      discordName: user.username,
      displayName: nickname,
      globalName: user.global_name || "",
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : null,
      roles,
      isAdmin,
      viewedAt: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip || "",
      ua: req.headers["user-agent"] || "",
    };

    await db.collection("viewLogs").add(logData);

    // 6. Firebase Custom Tokenを発行（フロントのAuth用）
    const customToken = await admin.auth().createCustomToken(user.id, {
      discordId: user.id,
      displayName: nickname,
      isAdmin,
    });

    res.json({
      success: true,
      customToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: nickname,
        avatar: logData.avatar,
        isAdmin,
      },
    });

  } catch (err: any) {
    console.error("discordCallback error:", err);
    res.status(500).json({ error: "Internal server error", detail: err.message });
  }
});

// ============================================================
// Step3: 管理者用 — ログ一覧取得
// ============================================================
export const getViewLogs = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", CONFIG.SITE_URL);
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  // Firebase IDトークンで認証確認
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }

  try {
    const idToken = authHeader.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    // 管理者フラグ確認
    if (!decoded.isAdmin) {
      res.status(403).json({ error: "Forbidden: admin only" }); return;
    }

    const snapshot = await db.collection("viewLogs")
      .orderBy("viewedAt", "desc")
      .limit(500)
      .get();

    const logs = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        discordId: d.discordId,
        discordName: d.discordName,
        displayName: d.displayName,
        avatar: d.avatar,
        isAdmin: d.isAdmin,
        viewedAt: d.viewedAt?.toDate().toISOString() || null,
        ua: d.ua,
      };
    });

    res.json({ logs });

  } catch (err: any) {
    console.error("getViewLogs error:", err);
    res.status(401).json({ error: "Invalid token" });
  }
});
