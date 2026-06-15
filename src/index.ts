import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Backlog } from "backlog-js";
import { BacklogHandler } from "./backlog-handler";
import { type Props, refreshUpstreamAuthToken } from "./utils";

// Refresh the access token this many milliseconds before it actually expires,
// to avoid races where a token expires mid-request.
const TOKEN_EXPIRY_SKEW_MS = 60_000;

// Shape of the token set we keep in Durable Object storage after a refresh.
type CachedTokens = {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
};

const TOKENS_STORAGE_KEY = "backlog:tokens";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	private refreshInFlight: Promise<CachedTokens> | null = null;

	server = new McpServer({
		name: "Backlog OAuth Proxy Demo",
		version: "1.0.0",
	});

	/**
	 * Returns a valid Backlog access token, refreshing it via the refresh token
	 * when the current one is expired (or about to expire).
	 *
	 * `this.props` is immutable for the life of the issued MCP token, so the latest
	 * tokens are cached in Durable Object storage and reused across requests.
	 */
	async getValidAccessToken(): Promise<string> {
		const cached = await this.ctx.storage.get<CachedTokens>(TOKENS_STORAGE_KEY);
		if (!cached && !this.props) {
			throw new Error("No authentication credentials found");
		}
		const current: CachedTokens = cached ?? {
			accessToken: this.props!.accessToken,
			expiresAt: this.props!.expiresAt,
			refreshToken: this.props!.refreshToken,
		};

		if (current.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
			return current.accessToken;
		}

		// Token expired (or close to it): refresh it. Use a single in-flight refresh
		// so concurrent requests don't race and invalidate each other's rotated
		// refresh token.
		if (!this.refreshInFlight) {
			this.refreshInFlight = this.refreshAccessToken(current.refreshToken).finally(() => {
				this.refreshInFlight = null;
			});
		}
		const refreshed = await this.refreshInFlight;
		return refreshed.accessToken;
	}

	private async refreshAccessToken(refreshToken: string): Promise<CachedTokens> {
		const [tokens, errResponse] = await refreshUpstreamAuthToken({
			client_id: this.env.BACKLOG_CLIENT_ID,
			client_secret: this.env.BACKLOG_CLIENT_SECRET,
			refresh_token: refreshToken,
			upstream_url: `https://${this.env.BACKLOG_HOST}/api/v2/oauth2/token`,
		});
		if (errResponse) {
			throw new Error("Failed to refresh Backlog access token");
		}

		const refreshed: CachedTokens = {
			accessToken: tokens.accessToken,
			expiresAt: Date.now() + tokens.expiresIn * 1000,
			refreshToken: tokens.refreshToken,
		};
		await this.ctx.storage.put(TOKENS_STORAGE_KEY, refreshed);
		return refreshed;
	}

	async init() {
		// Use the upstream Backlog access token to facilitate tools
		this.server.tool(
			"getMyself",
			"Get the authenticated user's own information from Backlog",
			{},
			async () => {
				const accessToken = await this.getValidAccessToken();
				const backlog = new Backlog({ accessToken, host: this.env.BACKLOG_HOST });
				return {
					content: [
						{
							text: JSON.stringify(await backlog.getMyself()),
							type: "text",
						},
					],
				};
			},
		);
	}
}

export default new OAuthProvider({
	apiHandler: MyMCP.serve("/mcp"),
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: BacklogHandler as any,
	tokenEndpoint: "/token",
});
