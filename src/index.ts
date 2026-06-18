import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Backlog } from "backlog-js";
import { z } from "zod";
import { BacklogHandler } from "./backlog-handler";
import { createIssueResourceTemplate, createProjectResourceTemplate } from "./resources";
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
			this.server.tool(tool.name, tool.description, tool.schema, tool.annotations, async (args: unknown) => {
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
			getIssuesTool.annotations,
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
			getDocumentsTool.annotations,
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
			getDocumentTreeTool.annotations,
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
			{ readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
			{ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
			{ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
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

		// Helper that resolves a fresh Backlog client using the current valid token.
		const getBacklog = async (): Promise<Backlog> => {
			const accessToken = await this.getValidAccessToken();
			return new Backlog({ accessToken, host: this.env.BACKLOG_HOST });
		};

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
				try {
					const backlog = await getBacklog();
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
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to fetch Backlog projects: ${message}`);
				}
			},
		);

		// ── Resource templates with argument completions ──────────────────────────
		// `backlog://projects/{projectKey}` — autocompletes projectKey against the
		// live list of projects the authenticated user can access.
		this.server.resource(
			"backlog-project",
			createProjectResourceTemplate(getBacklog),
			{ description: "Fetch a Backlog project by its project key." },
			async (uri, variables) => {
				const projectKey = String(variables.projectKey ?? "");
				try {
					const backlog = await getBacklog();
					const project = await backlog.getProject(projectKey);
					return {
						contents: [{ uri: uri.href, text: JSON.stringify(project), mimeType: "application/json" }],
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						contents: [{ uri: uri.href, text: `Error fetching project "${projectKey}": ${message}` }],
					};
				}
			},
		);

		// `backlog://issues/{issueKey}` — autocompletes issueKey against the 20
		// most-recently-updated issues the authenticated user can see.
		this.server.resource(
			"backlog-issue",
			createIssueResourceTemplate(getBacklog),
			{ description: "Fetch a Backlog issue by its issue key (e.g. DEMO-123)." },
			async (uri, variables) => {
				const issueKey = String(variables.issueKey ?? "");
				try {
					const backlog = await getBacklog();
					const issue = await backlog.getIssue(issueKey);
					return {
						contents: [{ uri: uri.href, text: JSON.stringify(issue), mimeType: "application/json" }],
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						contents: [{ uri: uri.href, text: `Error fetching issue "${issueKey}": ${message}` }],
					};
				}
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
				if (!documentId || typeof documentId !== "string") {
					throw new Error("Missing or invalid documentId parameter");
				}
				try {
					const backlog = await getBacklog();
					const document = await backlog.getDocument(documentId);
					return {
						contents: [
							{
								uri: uri.href,
								mimeType: "application/json",
								text: JSON.stringify(document),
							},
						],
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to fetch Backlog document "${documentId}": ${message}`);
				}
			},
		);

		// ── Prompts ───────────────────────────────────────────────────────────────

		/**
		 * daily-report prompt — instructs the model to build a formatted daily
		 * activity report from Backlog data for a given date.
		 */
		this.server.registerPrompt(
			"daily-report",
			{
				title: "Daily Activity Report",
				description:
					"Generate a daily activity report from Backlog for a given date. " +
					"Uses the generate_daily_report tool to fetch activities and renders them in a readable format.",
				argsSchema: {
					date: z
						.string()
						.optional()
						.describe(
							"Target date in YYYY-MM-DD format. Defaults to today when omitted.",
						),
					language: z
						.enum(["ja", "en"])
						.optional()
						.describe("Report language — 'ja' (Japanese) or 'en' (English). Defaults to ja."),
				},
			},
			({ date, language }) => {
				const targetDate = date ?? new Date().toISOString().slice(0, 10);
				const lang = language ?? "ja";
				const text =
					`Please generate a daily activity report for ${targetDate} using the Backlog MCP server.\n\n` +
					`Steps:\n` +
					`1. Call the \`getMyself\` tool to obtain the authenticated user's numeric userId.\n` +
					`2. Call the \`generate_daily_report\` tool with userId, date="${targetDate}", language="${lang}", and templateType="markdown".\n` +
					`3. Present the resulting report clearly. If no activities are found, state that there were no recorded activities for the day.\n\n` +
					`Target date: ${targetDate}\n` +
					`Language: ${lang}`;
				return {
					messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
				};
			},
		);

		/**
		 * summarize-activities prompt — instructs the model to fetch and summarize
		 * a Backlog user's recent activities since a given date.
		 */
		this.server.registerPrompt(
			"summarize-activities",
			{
				title: "Summarize User Activities",
				description:
					"Summarize a Backlog user's recent activities. " +
					"Fetches structured activity data and asks the model to produce a concise summary.",
				argsSchema: {
					userId: z
						.string()
						.optional()
						.describe(
							"Backlog user ID as a string. Omit or pass '0' to use the authenticated user.",
						),
					since: z
						.string()
						.optional()
						.describe(
							"Start date for the summary window in YYYY-MM-DD format. Defaults to yesterday.",
						),
				},
			},
			({ userId, since }) => {
				const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
				const sinceDate = since ?? yesterday;
				const userIdNote =
					userId && userId !== "0"
						? `for user with ID ${userId}`
						: "for the authenticated user (pass userId < 1 to the tool)";
				const text =
					`Please summarize the Backlog activities ${userIdNote} since ${sinceDate}.\n\n` +
					`Steps:\n` +
					`1. If no userId was provided, call \`getMyself\` to obtain the authenticated user's numeric userId.\n` +
					`2. Call \`summarize_daily_activities\` with the resolved userId and date="${sinceDate}" to retrieve structured activity data.\n` +
					`3. Produce a concise, readable summary grouped by project. Highlight key accomplishments, comments added, and issues updated.\n` +
					`4. If there are no activities, clearly indicate that.\n\n` +
					`Since: ${sinceDate}`;
				return {
					messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
				};
			},
		);

		/**
		 * issue-triage prompt — instructs the model to triage open issues in a
		 * Backlog project and suggest priorities or next steps.
		 */
		this.server.registerPrompt(
			"issue-triage",
			{
				title: "Issue Triage",
				description:
					"Triage open issues in a Backlog project. " +
					"Fetches the current open issues and asks the model to suggest priorities and next steps.",
				argsSchema: {
					projectKey: z
						.string()
						.describe(
							"Backlog project key (e.g. 'DEMO'). Used to scope the issue list to a single project.",
						),
				},
			},
			({ projectKey }) => {
				const text =
					`Please triage the open issues in Backlog project "${projectKey}".\n\n` +
					`Steps:\n` +
					`1. Call \`getProjects\` to resolve the numeric projectId for key "${projectKey}".\n` +
					`2. Call \`getIssues\` with that projectId, filtering to open/unresolved statuses (use \`getProjectStatuses\` to find the open status IDs), and sort by priority descending.\n` +
					`3. For each issue, evaluate urgency based on due date, priority, and description.\n` +
					`4. Produce a triage report with:\n` +
					`   - **Critical / High** issues that need immediate attention\n` +
					`   - **Medium** issues that should be scheduled soon\n` +
					`   - **Low / Backlog** items that can be deferred\n` +
					`5. For each critical/high issue, suggest a recommended next step or assignee.\n\n` +
					`Project key: ${projectKey}`;
				return {
					messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
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
