import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Backlog } from "backlog-js";
import { z } from "zod";
import { BacklogHandler } from "./backlog-handler";
import {
	type BacklogClient,
	generateDailyReport,
	getIssueWithComments,
	getUserActivities,
	summarizeDailyActivities,
} from "./backlog-tools";
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

	/**
	 * Builds a Backlog client authenticated with a fresh access token.
	 */
	private async backlogClient(): Promise<BacklogClient> {
		const accessToken = await this.getValidAccessToken();
		return new Backlog({ accessToken, host: this.env.BACKLOG_HOST }) as unknown as BacklogClient;
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

		// Combines an issue with its comments in a single call.
		this.server.tool(
			"get_issue_with_comments",
			"Get a Backlog issue together with all of its comments. Provide either issueId or issueKey (e.g. PROJ-123).",
			{
				issueId: z.string().optional().describe("Issue ID"),
				issueKey: z.string().optional().describe("Issue key, e.g. PROJ-123"),
				count: z.number().optional().describe("Number of comments to retrieve (default 100)"),
				order: z.enum(["asc", "desc"]).optional().describe("Comment sort order (default asc)"),
			},
			async (params) => {
				const backlog = await this.backlogClient();
				const result = await getIssueWithComments(backlog, params);
				return { content: [{ type: "text", text: JSON.stringify(result) }] };
			},
		);

		// Recent activities for a user (use userId < 1 for the current user).
		this.server.tool(
			"get_user_activities",
			"Get a Backlog user's recent activities. Use a userId < 1 for the authenticated user.",
			{
				userId: z.number().describe("Backlog user ID. Use a value < 1 for the authenticated user."),
				activityTypeId: z.array(z.number()).optional().describe("Filter by activity type IDs"),
				minId: z.number().optional().describe("Minimum activity ID"),
				maxId: z.number().optional().describe("Maximum activity ID"),
				count: z.number().optional().describe("Number of activities to retrieve"),
				order: z.enum(["asc", "desc"]).optional().describe("Sort order"),
			},
			async (params) => {
				const backlog = await this.backlogClient();
				const result = await getUserActivities(backlog, params);
				return { content: [{ type: "text", text: JSON.stringify(result) }] };
			},
		);

		// Filtered, grouped and rendered daily report for a user/date.
		this.server.tool(
			"generate_daily_report",
			"Generate a daily activity report for a Backlog user on a given date. Activities are filtered to meaningful ones (comments or substantive changes), grouped by project, and rendered. Use userId < 1 for the authenticated user.",
			{
				userId: z.number().describe("Backlog user ID. Use a value < 1 for the authenticated user."),
				date: z.string().describe("Target date in YYYY-MM-DD format"),
				templateType: z
					.enum(["markdown", "text", "html"])
					.optional()
					.describe("Report output format (default markdown)"),
				language: z.enum(["ja", "en"]).optional().describe("Report language (default ja)"),
			},
			async (params) => {
				const backlog = await this.backlogClient();
				const result = await generateDailyReport(backlog, params);
				return { content: [{ type: "text", text: JSON.stringify(result) }] };
			},
		);

		// Same filtering/grouping as the daily report, but returns structured data
		// without a pre-rendered report so the calling LLM can summarize it.
		this.server.tool(
			"summarize_daily_activities",
			"Get a Backlog user's meaningful activities for a given date as structured data (filtered and grouped by project), without a pre-rendered report, so the calling model can summarize them. Use userId < 1 for the authenticated user.",
			{
				userId: z.number().describe("Backlog user ID. Use a value < 1 for the authenticated user."),
				date: z.string().describe("Target date in YYYY-MM-DD format"),
			},
			async (params) => {
				const backlog = await this.backlogClient();
				const result = await summarizeDailyActivities(backlog, params);
				return { content: [{ type: "text", text: JSON.stringify(result) }] };
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
