# Sorcery City — Discord認証 × Firebase セットアップ手順

管理者ログを **Discordロール／ユーザーIDで制限** するための完全手順書です。

---

## 全体の流れ

```
ユーザーがルールページを開く
   ↓
「Discordでログイン」ボタンをクリック
   ↓
Discord OAuth認証（discord.com）
   ↓
callback.html → Firebase Functionにcodeを送信
   ↓
Function が Discord APIでロール確認 → Firestoreにログ記録
   ↓
Firebase Custom Tokenを発行 → フロントでサインイン
   ↓
管理者タブ → IDトークンで認証確認 → ログ一覧表示
```

---

## STEP 1 — Discordアプリを作成する

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 右上の **「New Application」** をクリック
3. 名前（例：`Sorcery City Portal`）を入力して **Create**
4. 左メニュー → **「OAuth2」** をクリック
5. **「Redirects」** に以下を追加して保存：
   ```
   https://あなたのGitHubPagesドメイン.github.io/callback.html
   ```
6. **Client ID** と **Client Secret** をメモしておく（後で使う）

### Botトークンの取得

1. 左メニュー → **「Bot」** をクリック
2. **「Add Bot」** → 確認画面で **「Yes, do it!」**
3. 「TOKEN」欄の **「Reset Token」** → 表示されたトークンをメモ
4. 下の **Privileged Gateway Intents** で **「Server Members Intent」** をONにして保存

### BotをサーバーへInvite

1. 左メニュー → **「OAuth2」→「URL Generator」**
2. Scopes: `bot` にチェック
3. Bot Permissions: `View Channels`, `Read Message History` にチェック
4. 生成されたURLを開いてSorcery CityサーバーにBotを招待

---

## STEP 2 — Firebaseプロジェクトを作成する

1. [Firebase Console](https://console.firebase.google.com/) を開く
2. **「プロジェクトを追加」** → 名前（例：`sorcery-city`）を入力 → 作成
3. 左メニュー → **「Firestore Database」** → **「データベースの作成」**
   - リージョン: `asia-northeast1`（東京）を選択
   - モード: **本番環境モード**
4. 左メニュー → **「Authentication」** → **「始める」**
   - 「Sign-in method」タブ → 何も有効化しなくてOK（Custom Tokenを使うため）
5. 左メニュー → **「プロジェクトの設定」**（歯車アイコン）→ **「マイアプリ」**
   - `</>` ボタンでWebアプリを追加
   - **「Firebase SDK の追加」** に表示される設定値をメモ

---

## STEP 3 — Firestoreセキュリティルールを設定する

Firebase Console → Firestore → 「ルール」タブ に以下を貼り付けて公開：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // viewLogsはCloud Functionからのみ書き込み可（直接アクセス不可）
    match /viewLogs/{logId} {
      allow read, write: if false;
    }
  }
}
```

---

## STEP 4 — Node.js環境を用意してFunctionsをデプロイする

### 前提
- Node.js 18以上がインストール済みであること
- `npm install -g firebase-tools` でFirebase CLIを導入済み

### 手順

```bash
# 1. 提供したフォルダをダウンロードして移動
cd sorcery-auth

# 2. Firebaseにログイン
firebase login

# 3. プロジェクトを紐付け
firebase use --add
# → Firebase Consoleで作ったプロジェクトを選択

# 4. 依存関係インストール
cd functions
npm install

# 5. 環境変数を設定（★ ここを自分の値に変更 ★）
firebase functions:config:set \
  discord.client_id="あなたのCLIENT_ID" \
  discord.client_secret="あなたのCLIENT_SECRET" \
  discord.guild_id="SorceryCityのサーバーID" \
  discord.bot_token="あなたのBOT_TOKEN" \
  discord.allowed_role_ids="ロールID1,ロールID2" \
  discord.allowed_user_ids="ユーザーID1,ユーザーID2" \
  discord.site_url="https://あなたのGitHub名.github.io"

# 6. ビルド＆デプロイ
cd ..
firebase deploy --only functions
```

デプロイが成功すると以下のようなURLが表示されます：
```
✔ Function URL (getAuthUrl): https://us-central1-YOUR_PROJECT.cloudfunctions.net/getAuthUrl
✔ Function URL (discordCallback): https://us-central1-YOUR_PROJECT.cloudfunctions.net/discordCallback
✔ Function URL (getViewLogs): https://us-central1-YOUR_PROJECT.cloudfunctions.net/getViewLogs
```

---

## STEP 5 — サーバーIDとロールIDの調べ方

### サーバーID（Guild ID）

1. Discordアプリ → 設定 → 詳細設定 → **開発者モード** をON
2. Sorcery Cityサーバーのアイコンを**右クリック** → **「IDをコピー」**

### ロールID

1. サーバー設定 → 役職（ロール）
2. 権限を付与したいロールにカーソルを合わせて**右クリック** → **「IDをコピー」**

### 自分のユーザーID

1. Discordで自分のアイコンを**右クリック** → **「IDをコピー」**

---

## STEP 6 — index.html と callback.html を更新する

### callback.html

提供した `callback.html` の以下を書き換えてください：

```javascript
const FIREBASE_CONFIG = {
  apiKey: "Firebase ConsoleのapiKey",
  authDomain: "あなたのproject.firebaseapp.com",
  projectId: "あなたのproject-id",
};
const FUNCTIONS_BASE = "https://us-central1-あなたのproject-id.cloudfunctions.net";
```

### index.html の変更点

1. **`<head>`** 内にFirebase SDKを追加：
```html
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js"></script>
```

2. **`<script>`** タグの一番上に `index_patch.js` の中身を貼り付ける

3. **`FIREBASE_CONFIG`** と **`FUNCTIONS_BASE`** を自分の値に変更

4. **Discordモーダル** のボタンを変更（入力欄は不要、ボタン1つに）：
```html
<button onclick="loginWithDiscord()" style="（既存のスタイルをそのまま）">
  <i class="fa-brands fa-discord"></i> Discordでログインして閲覧する
</button>
```

5. **既存の `submitDiscordInfo()`、`discordIdInput`、`discordNameInput`** 関連のHTML/JSは削除

---

## STEP 7 — GitHub Pagesにプッシュ

```bash
# index.html と callback.html を同じリポジトリに配置
git add index.html callback.html
git commit -m "Add Discord OAuth auth"
git push origin main
```

---

## 動作確認チェックリスト

- [ ] `callback.html` にアクセスしてエラーが出ないか
- [ ] `index.html` を開いたときにDiscordログインモーダルが表示されるか
- [ ] Discordでログイン後、`index.html` に戻ってくるか
- [ ] 管理者ロールを持つアカウントで「管理者ログ」タブが見えるか
- [ ] 管理者ロールを持たないアカウントでタブが拒否されるか
- [ ] Firebase Console → Firestore → viewLogsコレクションにログが記録されているか

---

## よくある問題

| 症状 | 原因 | 対処 |
|------|------|------|
| `redirect_uri mismatch` | callback.htmlのURLがDiscordアプリと不一致 | Developer PortalのRedirectsを確認 |
| `403 Forbidden` | Botがサーバーに参加していない | STEP1のInvite手順を再確認 |
| `Cannot read properties of undefined` | Firebase設定が間違っている | FIREBASE_CONFIGを再確認 |
| ログが記録されない | Firestoreルールの問題 | STEP3のルールを確認 |
| 管理者タブが出ない | ロールIDの設定ミス | `discord.allowed_role_ids`を確認 |

---

## セキュリティについて

- Botトークン・Client Secretは**絶対にGitHubにプッシュしない**
- Firebase Functions の環境変数として管理しているため、フロントには露出しない
- Firestoreのログは Functions 経由でのみアクセス可能（直接読み書き不可）
