import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Backlog } from "backlog-js";
import { z } from "zod";
import { BacklogHandler } from "./backlog-handler";
import { executeTool, tools } from "./tools";
import { clearUserPref, getUserPrefs, setUserPref } from "./user-prefs";
import { ALLOWED_PREF_KEYS, type PrefKey, type Props, refreshUpstreamAuthToken } from "./utils";

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

	// Throws a descriptive error if the session is not authenticated.
	private requireUserId(): number {
		if (!this.props?.userId) {
			throw new Error("User session is not authenticated or userId is missing");
		}
		return this.props.userId;
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
		// Tools that need defaultProjectId injection are registered separately below.
		const PROJECT_INJECT_TOOLS = new Set(["getIssues", "getDocuments", "getDocumentTree"]);

		// Register all tools except those that need default project injection.
		for (const tool of tools) {
			if (PROJECT_INJECT_TOOLS.has(tool.name)) continue;
			this.server.tool(tool.name, tool.description, tool.schema, async (args: unknown) => {
				const accessToken = await this.getValidAccessToken();
				const backlog = new Backlog({ accessToken, host: this.env.BACKLOG_HOST });
				return executeTool(tool, backlog, args);
			});
		}

		// Helper to load the default project ID from preferences (returns undefined on failure).
		const getDefaultProjectId = async (): Promise<number | undefined> => {
			try {
				const prefs = await getUserPrefs(this.env.OAUTH_KV, this.requireUserId());
				return prefs.defaultProjectId;
			} catch {
				return undefined;
			}
		};

		// getIssues: inject defaultProjectId from user preferences when projectId is omitted.
		const getIssuesTool = tools.find((t) => t.name === "getIssues")!;
		this.server.tool(
			getIssuesTool.name,
			getIssuesTool.description,
			getIssuesTool.schema,
			async (args: Record<string, unknown>) => {
				const resolvedArgs = { ...args };
				if (!resolvedArgs.projectId) {
					const defaultProjectId = await getDefaultProjectId();
					if (defaultProjectId) {
						resolvedArgs.projectId = [defaultProjectId];
					}
				}
				const accessToken = await this.getValidAccessToken();
				const backlog = new Backlog({ accessToken, host: this.env.BACKLOG_HOST });
				return executeTool(getIssuesTool, backlog, resolvedArgs);
			},
		);

		// getDocuments: inject defaultProjectId when projectId array is omitted.
		const getDocumentsTool = tools.find((t) => t.name === "getDocuments")!;
		this.server.tool(
			getDocumentsTool.name,
			getDocumentsTool.description,
			getDocumentsTool.schema,
			async (args: Record<string, unknown>) => {
				const resolvedArgs = { ...args };
				if (!resolvedArgs.projectId) {
					const defaultProjectId = await getDefaultProjectId();
					if (defaultProjectId) {
						resolvedArgs.projectId = [defaultProjectId];
					}
				}
				const accessToken = await this.getValidAccessToken();
				const backlog = new Backlog({ accessToken, host: this.env.BACKLOG_HOST });
				return executeTool(getDocumentsTool, backlog, resolvedArgs);
			},
		);

		// getDocumentTree: inject defaultProjectId when projectIdOrKey is omitted.
		const getDocumentTreeTool = tools.find((t) => t.name === "getDocumentTree")!;
		this.server.tool(
			getDocumentTreeTool.name,
			getDocumentTreeTool.description,
			getDocumentTreeTool.schema,
			async (args: Record<string, unknown>) => {
				const resolvedArgs = { ...args };
				if (!resolvedArgs.projectIdOrKey) {
					const defaultProjectId = await getDefaultProjectId();
					if (defaultProjectId) {
						resolvedArgs.projectIdOrKey = defaultProjectId;
					}
				}
				const accessToken = await this.getValidAccessToken();
				const backlog = new Backlog({ accessToken, host: this.env.BACKLOG_HOST });
				return executeTool(getDocumentTreeTool, backlog, resolvedArgs);
			},
		);

		// Preference tools — registered inline because they need KV access via this.env.OAUTH_KV.
		this.server.tool(
			"get_preferences",
			"Get the current user's saved preferences (e.g. defaultProjectId). Preferences persist across sessions.",
			{},
			async () => {
				try {
					const prefs = await getUserPrefs(this.env.OAUTH_KV, this.requireUserId());
					return { content: [{ type: "text" as const, text: JSON.stringify(prefs) }] };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
				}
			},
		);

		this.server.tool(
			"set_preference",
			"Save a preference that persists across sessions. Use defaultProjectId (numeric project ID) to avoid specifying a project on every getIssues call.",
			{
				key: z.enum(ALLOWED_PREF_KEYS).describe("Preference key to set."),
				value: z.string().describe("Value to store. For defaultProjectId provide the numeric project ID as a string."),
			},
			async ({ key, value }: { key: PrefKey; value: string }) => {
				try {
					let coercedValue: number | string = value;
					if (key === "defaultProjectId") {
						const parsed = Number(value);
						if (isNaN(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
							return {
								content: [{ type: "text" as const, text: "Error: defaultProjectId must be a positive integer." }],
								isError: true,
							};
						}
						coercedValue = parsed;
					}
					await setUserPref(this.env.OAUTH_KV, this.requireUserId(), key, coercedValue);
					return { content: [{ type: "text" as const, text: `Preference "${key}" saved.` }] };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text" as const, text: `Error setting preference: ${message}` }],
						isError: true,
					};
				}
			},
		);

		this.server.tool(
			"clear_preference",
			"Remove a saved preference for the current user.",
			{
				key: z.enum(ALLOWED_PREF_KEYS).describe("Preference key to clear."),
			},
			async ({ key }: { key: PrefKey }) => {
				try {
					await clearUserPref(this.env.OAUTH_KV, this.requireUserId(), key);
					return { content: [{ type: "text" as const, text: `Preference "${key}" cleared.` }] };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text" as const, text: `Error clearing preference: ${message}` }],
						isError: true,
					};
				}
			},
		);

		// ── MCP Resources ──────────────────────────────────────────────────────────
		// Static resource: list all projects accessible to the authenticated user.
		this.server.registerResource(
			"backlog-projects",
			"backlog://projects",
			{
				title: "Backlog Projects",
				description: "All Backlog projects accessible to the authenticated user, returned as a JSON array.",
				mimeType: "application/json",
			},
			async (uri) => {
				const accessToken = await this.getValidAccessToken();
				const backlog = new Backlog({ accessToken, host: this.env.BACKLOG_HOST });
				const projects = await backlog.getProjects({});
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify(projects),
						},
					],
				};
			},
		);

		// Template resource: fetch a single issue by its key or numeric ID.
		const issueTemplate = new ResourceTemplate("backlog://issues/{issueKey}", { list: undefined });
		this.server.registerResource(
			"backlog-issue",
			issueTemplate,
			{
				title: "Backlog Issue",
				description: "A single Backlog issue fetched by its key (e.g. DEMO-123) or numeric ID.",
				mimeType: "application/json",
			},
			async (uri, { issueKey }) => {
				const accessToken = await this.getValidAccessToken();
				const backlog = new Backlog({ accessToken, host: this.env.BACKLOG_HOST });
				const issue = await backlog.getIssue(issueKey as string);
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify(issue),
						},
					],
				};
			},
		);

		// Template resource: fetch a single document by its UUIDv7 ID.
		const documentTemplate = new ResourceTemplate("backlog://documents/{documentId}", { list: undefined });
		this.server.registerResource(
			"backlog-document",
			documentTemplate,
			{
				title: "Backlog Document",
				description: "A single Backlog document (wiki page) fetched by its UUIDv7 ID.",
				mimeType: "application/json",
			},
			async (uri, { documentId }) => {
				const accessToken = await this.getValidAccessToken();
				const backlog = new Backlog({ accessToken, host: this.env.BACKLOG_HOST });
				const document = await backlog.getDocument(documentId as string);
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify(document),
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
