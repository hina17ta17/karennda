# マイカレンダー

ログイン機能付きのカレンダーWebアプリ（Node.js + Express + SQLite）。

## セットアップ

`node_modules/` と `calendar.db` はリポジトリに含まれていません（`.gitignore` で除外）。
クローンまたはダウンロード直後は **必ず `npm install` を先に実行してください**。これを忘れると
`Error: Cannot find module 'express'` のようなエラーで起動に失敗します。

```bash
git clone <このリポジトリのURL>
cd <クローンしたフォルダ>
npm install
npm start
```

起動後、ブラウザで以下を開く。

```
http://localhost:3000
```

## オンライン公開（Render へのデプロイ）

> ⚠️ このアプリは Node.js のサーバーで動くため、**GitHub Pages では動きません**
> （GitHub Pages は静的ファイルのみ。`server.js` を実行できません）。
> ログイン・予定保存を動かすには、Node を実行できるホストが必要です。ここでは無料の **Render** を使います。

### 手順

1. このプロジェクトを GitHub にプッシュしておく。
2. https://render.com にGitHubアカウントで登録・ログイン。
3. ダッシュボードで **「New +」→「Web Service」** を選び、対象のGitHubリポジトリを接続。
4. 設定を以下のように入力（`render.yaml` を使う場合は「Blueprint」から読み込めば自動入力）。
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
   - **Environment Variable**: `SESSION_SECRET` に適当なランダム文字列を設定
     （`render.yaml` 経由なら自動生成される）
5. 「Create Web Service」を押すとビルド＆起動され、`https://〇〇.onrender.com` のURLが発行される。

### ⚠️ 無料プランの制約（重要）

- **データは再起動・再デプロイで消えます。** Renderの無料プランはディスクが揮発性のため、
  `calendar.db`（登録ユーザー・予定）はサービス再起動時にリセットされます。
  動作確認・デモ用途には十分ですが、データを永続化したい場合は次のいずれかが必要です:
  - Render の有料「Disk」を追加してDBファイルを永続化する
  - SQLite をやめて PostgreSQL などのホスト型DBに切り替える
- 無料プランは**アクセスが無いとスリープ**し、次のアクセス時に起動まで数十秒かかります。

## 補足

- `calendar.db` は初回起動時に自動生成されます（[init_db.sql](init_db.sql) の内容でテーブル作成）。
- `better-sqlite3` はOS・CPUアーキテクチャごとにネイティブビルドされるため、
  `node_modules` をコミットして別環境にそのまま持ち込むと動かないことがあります。
  そのため `npm install` を都度実行する運用にしています。
- 本番では環境変数 `SESSION_SECRET` を必ず設定してください（未設定時は開発用の固定値が使われます）。
