# Model Context Protocol (MCP) Server + Backlog OAuth

This is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) server that supports remote MCP connections, with [Backlog (Nulab)](https://developer.nulab.com/docs/backlog/) OAuth 2.0 built-in.

You can deploy it to your own Cloudflare account, and after you register your own Backlog OAuth application, you'll have a fully functional remote MCP server that you can build off. Users will be able to connect to your MCP server by signing in with their Backlog account.

The MCP server (powered by [Cloudflare Workers](https://developers.cloudflare.com/workers/)):

- Acts as OAuth _Server_ to your MCP clients
- Acts as OAuth _Client_ to your _real_ OAuth server (in this case, Backlog)

> [!WARNING]
> This is a demo template designed to help you get started quickly. While we have implemented several security controls, **you must implement all preventive and defense-in-depth security measures before deploying to production**. Please review our comprehensive security guide: [Securing MCP Servers](https://github.com/cloudflare/agents/blob/main/docs/securing-mcp-servers.md)

## How Backlog OAuth differs

Backlog is **per-space**: each space has its own host (e.g. `yourspace.backlog.com`, `yourspace.backlog.jp`, `yourspace.backlogtool.com`) and OAuth applications are registered within a single space. This server is therefore **single-space**: you configure the target space host via the `BACKLOG_HOST` variable, and the `BACKLOG_CLIENT_ID` / `BACKLOG_CLIENT_SECRET` belong to that space.

Backlog access tokens expire after 1 hour. This server stores the refresh token and **automatically refreshes** the access token when it expires (see `getValidAccessToken()` in `src/index.ts`).

See the [Backlog Authentication & Authorization docs](https://developer.nulab.com/docs/backlog/auth/) for details.

## Getting Started

Clone the repo directly & install dependencies: `npm install`.

### Register a Backlog OAuth Application

In your Backlog space, go to **Space settings → Integrations → Developer (API)** and register a new OAuth 2.0 application to obtain your **Client ID** and **Client Secret**.

- Redirect URI (production): `https://<your-worker-name>.<your-subdomain>.workers.dev/callback`
- Redirect URI (local development): `http://localhost:8788/callback`

### For Production

Set your target space host in `wrangler.jsonc` under `vars`:

```jsonc
"vars": { "BACKLOG_HOST": "yourspace.backlog.com" }
```

Set the secrets via Wrangler:

```bash
wrangler secret put BACKLOG_CLIENT_ID
wrangler secret put BACKLOG_CLIENT_SECRET
wrangler secret put COOKIE_ENCRYPTION_KEY # add any random string here e.g. openssl rand -hex 32
```

> [!IMPORTANT]
> When you create the first secret, Wrangler will ask if you want to create a new Worker. Submit "Y" to create a new Worker and save the secret.

#### Set up a KV namespace

- Create the KV namespace:
  `wrangler kv namespace create "OAUTH_KV"`
- Update the Wrangler file with the KV ID

#### Deploy & Test

Deploy the MCP server to make it available on your workers.dev domain:

```bash
wrangler deploy
```

Test the remote server using [Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```bash
npx @modelcontextprotocol/inspector@latest
```

Enter `https://<your-worker-name>.<your-subdomain>.workers.dev/sse` and hit connect. Once you go through the Backlog authentication flow, you'll see the Tools working.

You now have a remote MCP server deployed!

### Tools

This MCP server uses Backlog OAuth for authentication. Authenticated users can call:

- **`getMyself`** — returns the authenticated user's own information from Backlog (`GET /api/v2/users/myself`).

You can extend `src/index.ts` with more Backlog tools using the [`backlog-js`](https://github.com/nulab/backlog-js) client and the access token returned by `getValidAccessToken()`.

### Access the remote MCP server from Claude Desktop

Open Claude Desktop and navigate to Settings -> Developer -> Edit Config. This opens the configuration file that controls which MCP servers Claude can access.

Replace the content with the following configuration. Once you restart Claude Desktop, a browser window will open showing your OAuth login page. Complete the Backlog authentication flow to grant Claude access to your MCP server. After you grant access, the tools will become available for you to use.

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

Once the Tools (under 🔨) show up in the interface, you can ask Claude to use them. For example: "Who am I in Backlog?". Claude should invoke the `getMyself` tool and show the result.

### For Local Development

If you'd like to iterate and test your MCP server, you can do so in local development. This requires a Backlog OAuth application whose redirect URI is `http://localhost:8788/callback`.

- Create a `.dev.vars` file in your project root (see `.dev.vars.example`):

```
BACKLOG_CLIENT_ID=your_development_backlog_client_id
BACKLOG_CLIENT_SECRET=your_development_backlog_client_secret
COOKIE_ENCRYPTION_KEY=a_random_string
# Optional: override BACKLOG_HOST locally; otherwise the wrangler.jsonc value is used.
# BACKLOG_HOST=yourspace.backlog.com
```

#### Develop & Test

Run the server locally to make it available at `http://localhost:8788`:

```bash
wrangler dev
```

To test the local server, enter `http://localhost:8788/sse` into Inspector and hit connect. Once you follow the prompts, you'll be able to "List Tools".

#### Using Cursor and other MCP Clients

To connect Cursor with your MCP server, choose `Type`: "Command" and in the `Command` field, combine the command and args fields into one (e.g. `npx mcp-remote https://<your-worker-name>.<your-subdomain>.workers.dev/sse`).

Note that while Cursor supports HTTP+SSE servers, it doesn't support authentication, so you still need to use `mcp-remote` (and to use a STDIO server, not an HTTP one).

You can connect your MCP server to other MCP clients like Windsurf by opening the client's configuration file, adding the same JSON that was used for the Claude setup, and restarting the MCP client.

## How does it work?

#### OAuth Provider

The OAuth Provider library serves as a complete OAuth 2.1 server implementation for Cloudflare Workers. It handles the complexities of the OAuth flow, including token issuance, validation, and management. In this project, it plays the dual role of:

- Authenticating MCP clients that connect to your server
- Managing the connection to Backlog's OAuth services
- Securely storing tokens and authentication state in KV storage

#### Durable MCP

Durable MCP extends the base MCP functionality with Cloudflare's Durable Objects, providing:

- Persistent state management for your MCP server
- Secure storage of authentication context between requests
- Access to authenticated user information via `this.props`
- Caching of refreshed Backlog tokens in Durable Object storage

#### MCP Remote

The MCP Remote library enables your server to expose tools that can be invoked by MCP clients like the Inspector. It:

- Defines the protocol for communication between clients and your server
- Provides a structured way to define tools
- Handles serialization and deserialization of requests and responses
- Maintains the Server-Sent Events (SSE) connection between clients and your server
