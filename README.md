# Model Context Protocol (MCP) サーバー + Backlog OAuth

これは、リモート MCP 接続に対応した [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) サーバーで、[Backlog (Nulab)](https://developer.nulab.com/docs/backlog/) の OAuth 2.0 認証を組み込んでいます。

ご自身の Cloudflare アカウントにデプロイでき、ご自身の Backlog OAuth アプリケーションを登録すれば、すぐに拡張可能なリモート MCP サーバーが手に入ります。ユーザーは Backlog アカウントでサインインして、この MCP サーバーに接続できます。

> [!NOTE]
> このプロジェクトは、Cloudflare の公式サンプル [`cloudflare/ai` の `demos/remote-mcp-google-oauth`](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-google-oauth) をベースに、認証先を Google から Backlog (Nulab) に置き換えて実装したものです。

この MCP サーバー（[Cloudflare Workers](https://developers.cloudflare.com/workers/) 上で動作）は、次の役割を担います。

- MCP クライアントに対しては OAuth **サーバー**として動作
- 本物の OAuth サーバー（ここでは Backlog）に対しては OAuth **クライアント**として動作

> [!WARNING]
> これは、すぐに使い始められるよう設計されたデモ用テンプレートです。いくつかのセキュリティ対策は実装済みですが、**本番環境にデプロイする前に、予防的かつ多層的なセキュリティ対策をすべて自身で実装する必要があります**。包括的なセキュリティガイドをご確認ください: [Securing MCP Servers](https://github.com/cloudflare/agents/blob/main/docs/securing-mcp-servers.md)

## Backlog OAuth の特徴

Backlog は **スペース単位** です。各スペースは固有のホスト（例: `yourspace.backlog.com`、`yourspace.backlog.jp`、`yourspace.backlogtool.com`）を持ち、OAuth アプリケーションは単一のスペース内に登録されます。そのため、このサーバーは **単一スペース** 構成です。対象スペースのホストを `BACKLOG_HOST` 変数で設定し、`BACKLOG_CLIENT_ID` / `BACKLOG_CLIENT_SECRET` はそのスペースに紐づきます。

Backlog のアクセストークンは 1 時間で失効します。このサーバーはリフレッシュトークンを保存し、アクセストークンが失効した際に **自動的に更新（リフレッシュ）** します（`src/index.ts` の `getValidAccessToken()` を参照）。

詳細は [Backlog の認証・認可ドキュメント](https://developer.nulab.com/ja/docs/backlog/auth/) を参照してください。

## はじめに

リポジトリをクローンし、依存関係をインストールします: `npm install`

### Backlog OAuth アプリケーションの登録

Backlog スペースの **スペース設定 → 連携 → 開発者向け（API）** から、新しい OAuth 2.0 アプリケーションを登録し、**クライアント ID** と **クライアントシークレット** を取得します。

- リダイレクト URI（本番）: `https://<your-worker-name>.<your-subdomain>.workers.dev/callback`
- リダイレクト URI（ローカル開発）: `http://localhost:8788/callback`

### 本番環境向け

シークレットを Wrangler で設定します。

```bash
wrangler secret put BACKLOG_HOST          # 対象スペースのホスト。例: yourspace.backlog.com
wrangler secret put BACKLOG_CLIENT_ID
wrangler secret put BACKLOG_CLIENT_SECRET
wrangler secret put COOKIE_ENCRYPTION_KEY # 任意のランダム文字列。例: openssl rand -hex 32
```

> [!IMPORTANT]
> 最初のシークレットを作成すると、Wrangler が新しい Worker を作成するか尋ねてきます。「Y」を入力して Worker を作成し、シークレットを保存してください。

#### KV ネームスペースのセットアップ

- KV ネームスペースを作成します:
  `wrangler kv namespace create "OAUTH_KV"`
- コマンドの出力に表示される KV ID（`id = "..."`）をコピーします。
- `wrangler.jsonc` の `kv_namespaces` にある `id` を、**自分のアカウントで作成した KV ID に必ず置き換えてください**。リポジトリにコミットされている ID は作者の環境のものなので、そのままでは動作しません。

  ```jsonc
  "kv_namespaces": [
    {
      "binding": "OAUTH_KV",
      "id": "<ここをあなたの KV ID に置き換える>"
    }
  ],
  ```

#### デプロイとテスト

MCP サーバーをデプロイし、workers.dev ドメインで利用できるようにします。

```bash
wrangler deploy
```

[Inspector](https://modelcontextprotocol.io/docs/tools/inspector) を使ってリモートサーバーをテストします。

```bash
npx @modelcontextprotocol/inspector@latest
```

`https://<your-worker-name>.<your-subdomain>.workers.dev/sse` を入力して接続します。Backlog の認証フローを完了すると、ツールが動作するのを確認できます。

これでリモート MCP サーバーがデプロイされました！

### ツール

この MCP サーバーは Backlog OAuth で認証を行います。認証済みのユーザーは次のツールを呼び出せます。

- **`getMyself`** — 認証済みユーザー自身の情報を Backlog から取得します（`GET /api/v2/users/myself`）。

[`backlog-js`](https://github.com/nulab/backlog-js) クライアントと `getValidAccessToken()` が返すアクセストークンを使えば、`src/index.ts` を拡張して Backlog のツールを追加できます。

### Claude Desktop からリモート MCP サーバーへ接続する

Claude Desktop を開き、Settings -> Developer -> Edit Config に移動します。これで、Claude がアクセスできる MCP サーバーを制御する設定ファイルが開きます。

内容を以下の設定に置き換えます。Claude Desktop を再起動すると、OAuth ログインページを表示するブラウザウィンドウが開きます。Backlog の認証フローを完了して、Claude に MCP サーバーへのアクセスを許可してください。許可すると、ツールが利用可能になります。

```json
{
  "mcpServers": {
    "backlog": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<your-worker-name>.<your-subdomain>.workers.dev/sse"
      ]
    }
  }
}
```

ツール（🔨 アイコン）がインターフェースに表示されたら、Claude にツールの利用を依頼できます。例: 「Backlog での自分の情報を教えて」。Claude は `getMyself` ツールを呼び出し、結果を表示します。

### ローカル開発向け

MCP サーバーをローカルで反復開発・テストできます。これには、リダイレクト URI が `http://localhost:8788/callback` の Backlog OAuth アプリケーションが必要です。

- プロジェクトルートに `.dev.vars` ファイルを作成します（`.dev.vars.example` を参照）。

```dotenv
BACKLOG_HOST=yourspace.backlog.com
BACKLOG_CLIENT_ID=your_development_backlog_client_id
BACKLOG_CLIENT_SECRET=your_development_backlog_client_secret
COOKIE_ENCRYPTION_KEY=a_random_string
```

#### 開発とテスト

サーバーをローカルで起動し、`http://localhost:8788` で利用できるようにします。

```bash
wrangler dev
```

ローカルサーバーをテストするには、Inspector に `http://localhost:8788/sse` を入力して接続します。プロンプトに従うと、「List Tools」が利用できます。

#### Cursor やその他の MCP クライアントを使う場合

Cursor を MCP サーバーに接続するには、`Type` で「Command」を選び、`Command` フィールドに command と args を 1 つにまとめて入力します（例: `npx mcp-remote https://<your-worker-name>.<your-subdomain>.workers.dev/sse`）。

Cursor は HTTP+SSE サーバーに対応していますが認証には対応していないため、引き続き `mcp-remote` を使う必要があります（HTTP サーバーではなく STDIO サーバーとして使用します）。

Windsurf などその他の MCP クライアントへ接続する場合は、クライアントの設定ファイルを開き、Claude のセットアップで使用したものと同じ JSON を追加して、MCP クライアントを再起動してください。

## 仕組み

### OAuth Provider

OAuth Provider ライブラリは、Cloudflare Workers 向けの完全な OAuth 2.1 サーバー実装です。トークンの発行・検証・管理を含む OAuth フローの複雑さを処理します。本プロジェクトでは、次の二重の役割を果たします。

- このサーバーに接続する MCP クライアントの認証
- Backlog の OAuth サービスとの接続管理
- トークンと認証状態を KV ストレージへ安全に保存

### Durable MCP

Durable MCP は、Cloudflare の Durable Objects を用いて基本的な MCP 機能を拡張し、次を提供します。

- MCP サーバーの永続的な状態管理
- リクエスト間での認証コンテキストの安全な保存
- `this.props` を通じた認証済みユーザー情報へのアクセス
- リフレッシュした Backlog トークンの Durable Object ストレージへのキャッシュ

### MCP Remote

MCP Remote ライブラリは、Inspector のような MCP クライアントから呼び出せるツールをサーバーが公開できるようにします。次の機能を持ちます。

- クライアントとサーバー間の通信プロトコルを定義
- ツールを構造的に定義する手段を提供
- リクエスト／レスポンスのシリアライズ・デシリアライズを処理
- クライアントとサーバー間の Server-Sent Events (SSE) 接続を維持

## ライセンス

[MIT License](./LICENSE) の下で公開しています。
