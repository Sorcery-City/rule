// =============================================================
// このコードを index.html の <script> タグ先頭に追加してください
// （既存の「管理者設定」セクションより前に置く）
// =============================================================

// ★ ここを自分の設定に変更してください ★
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
};
const FUNCTIONS_BASE = "https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net";

// Firebase SDK読み込み（headタグ内にも追加が必要）
// <script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js"></script>

// ============================================================
// Discord OAuth認証フロー
// ============================================================
let currentUser = null;

async function initDiscordAuth() {
  firebase.initializeApp(FIREBASE_CONFIG);

  // sessionStorageにユーザー情報があればそれを使う
  const stored = sessionStorage.getItem("sc_user");
  if (stored) {
    currentUser = JSON.parse(stored);
    onUserLoaded();
    return;
  }

  // 未ログイン → Discordモーダル表示
  showDiscordModal();
}

function onUserLoaded() {
  // Discord入力モーダルは不要になる（OAuthで取得済み）
  hideDiscordModal();
  console.log("Logged in:", currentUser.displayName);
}

// Discord OAuthへリダイレクト
async function loginWithDiscord() {
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/getAuthUrl`);
    const { url } = await res.json();
    window.location.href = url;
  } catch (e) {
    alert("Discord認証URLの取得に失敗しました: " + e.message);
  }
}

// ============================================================
// 管理者ログ取得（Firebase IDトークン付きで）
// ============================================================
async function fetchAdminLogs() {
  const fbUser = firebase.auth().currentUser;
  if (!fbUser) return [];

  const idToken = await fbUser.getIdToken();
  const res = await fetch(`${FUNCTIONS_BASE}/getViewLogs`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!res.ok) {
    if (res.status === 403) throw new Error("権限がありません（管理者ロール必要）");
    throw new Error("ログ取得失敗: " + res.status);
  }

  const { logs } = await res.json();
  return logs;
}

// ============================================================
// 管理者チェック（isAdminフラグをIDトークンのclaimsから確認）
// ============================================================
async function checkIsAdmin() {
  const fbUser = firebase.auth().currentUser;
  if (!fbUser) return false;
  const token = await fbUser.getIdTokenResult();
  return token.claims.isAdmin === true;
}

// ============================================================
// 既存の openAdminTab を上書き
// ============================================================
// ※ 既存の openAdminTab() 関数をこれで置き換えてください

async function openAdminTab() {
  if (sessionStorage.getItem(ADMIN_KEY) === "1") {
    showAdminTab();
    return;
  }

  // Firebase Authで管理者確認
  const fbUser = firebase.auth().currentUser;
  if (!fbUser) {
    alert("先にDiscordでログインしてください");
    return;
  }

  const isAdmin = await checkIsAdmin();
  if (isAdmin) {
    sessionStorage.setItem(ADMIN_KEY, "1");
    showAdminTab();
  } else {
    alert("このページを閲覧する権限がありません。\n管理者ロールが必要です。");
    const first = document.querySelector(".nav-item:not(.nav-admin-btn)");
    if (first) switchTab(first.dataset.tab);
  }
}

// ============================================================
// 既存の renderAdminLogs を上書き（Firebase Firestoreから取得）
// ============================================================
async function renderAdminLogs(filter = "", sort = "newest") {
  const tbody = document.getElementById("logTableBody");
  const empty = document.getElementById("logEmpty");
  const stats = document.getElementById("adminStats");

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted);">
    <div style="width:24px;height:24px;border:2px solid rgba(124,92,252,0.3);border-top-color:var(--purple);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 10px;"></div>
    読み込み中…
  </td></tr>`;

  try {
    let logs = await fetchAdminLogs();

    // 統計
    const today = new Date().toDateString();
    const todayCount = logs.filter(l => new Date(l.viewedAt).toDateString() === today).length;
    const uniqueIds = new Set(logs.map(l => l.discordId)).size;
    stats.innerHTML = `
      <div class="stat-chip"><div class="stat-val">${logs.length}</div><div class="stat-label">総閲覧数</div></div>
      <div class="stat-chip"><div class="stat-val">${uniqueIds}</div><div class="stat-label">ユニークユーザー</div></div>
      <div class="stat-chip"><div class="stat-val">${todayCount}</div><div class="stat-label">本日の閲覧</div></div>
    `;

    // フィルター
    if (filter) {
      const q = filter.toLowerCase();
      logs = logs.filter(l =>
        l.discordId.includes(q) ||
        (l.discordName || "").toLowerCase().includes(q) ||
        (l.displayName || "").toLowerCase().includes(q)
      );
    }

    // ソート
    if (sort === "oldest") logs = [...logs].reverse();

    if (logs.length === 0) {
      tbody.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";

    tbody.innerHTML = logs.map((l, i) => {
      const dt = new Date(l.viewedAt);
      const dateStr = dt.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
      const timeStr = dt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const avatar = l.avatar
        ? `<img src="${l.avatar}" style="width:26px;height:26px;border-radius:50%;margin-right:8px;vertical-align:middle;">`
        : `<span style="width:26px;height:26px;border-radius:50%;background:rgba(124,92,252,0.2);display:inline-block;margin-right:8px;vertical-align:middle;"></span>`;
      const adminBadge = l.isAdmin
        ? `<span style="background:rgba(240,192,96,0.15);border:1px solid rgba(240,192,96,0.3);color:#ffe08a;font-size:0.62rem;padding:2px 7px;border-radius:999px;margin-left:6px;">管理者</span>`
        : "";

      return `<tr class="log-row">
        <td class="log-num">${i + 1}</td>
        <td><span class="log-id">${escHtml(l.discordId)}</span></td>
        <td class="log-name">${avatar}${escHtml(l.displayName || l.discordName)}${adminBadge}</td>
        <td class="log-time">${dateStr}<br><span style="color:rgba(155,146,200,0.5);font-size:0.72rem;">${timeStr}</span></td>
        <td class="log-device"><i class="fa-solid fa-${deviceIcon(l.ua)}" style="margin-right:4px;"></i>${escHtml(getDeviceLabel(l.ua))}</td>
      </tr>`;
    }).join("");

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:#ff8899;">${escHtml(err.message)}</td></tr>`;
  }
}

function getDeviceLabel(ua) {
  if (!ua) return "?";
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac/.test(ua)) return "Mac";
  return "Other";
}

// ============================================================
// Discordモーダルのボタンを「Discordでログイン」に変更
// ============================================================
// index.html の submitDiscordInfo() の呼び出しボタンを以下に変更：
//
// <button onclick="loginWithDiscord()" style="...">
//   <i class="fa-brands fa-discord"></i> Discordでログインして閲覧する
// </button>
//
// また、Discord IDと名前の入力欄は不要になるため削除してください。

// ============================================================
// DOMContentLoaded時の初期化
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  // Firebase初期化
  initDiscordAuth();

  // 検索・ソート
  document.getElementById("adminSearch").addEventListener("input", function () {
    renderAdminLogs(this.value, document.getElementById("adminSort").value);
  });
  document.getElementById("adminSort").addEventListener("change", function () {
    renderAdminLogs(document.getElementById("adminSearch").value, this.value);
  });
});
