import type { Backlog } from "backlog-js";
import { z } from "zod";
import {
	generateDailyReport,
	getIssueWithComments,
	getUserActivities,
	summarizeDailyActivities,
} from "./backlog-tools.js";

/**
 * The subset of the `backlog-js` client used by the Phase 1 tools. Declaring it
 * as a `Pick` of the real `Backlog` class guarantees the registry stays in sync
 * with the SDK while letting tests pass in a lightweight mock.
 */
export type BacklogClient = Pick<
	Backlog,
	| "getMyself"
	| "getUsers"
	| "getProjects"
	| "getProjectUsers"
	| "getIssueTypes"
	| "getProjectStatuses"
	| "getPriorities"
	| "getIssues"
	| "getIssue"
	| "postIssue"
	| "patchIssue"
	| "getIssueComments"
	| "postIssueComments"
	| "getNotifications"
	| "getUserActivities"
	| "getDocuments"
	| "getDocument"
	| "getDocumentTree"
	| "addDocument"
	| "deleteDocument"
>;

/**
 * The MCP tool result shape (a single JSON text block, matching the existing
 * convention). The index signature keeps it assignable to the SDK's
 * `CallToolResult`, which carries optional `_meta`/`isError` fields.
 */
export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	[key: string]: unknown;
}

export interface ToolDef {
	name: string;
	description: string;
	schema: z.ZodRawShape;
	handler: (backlog: BacklogClient, args: any) => Promise<ToolResult>;
}

/**
 * Define a tool with full type inference between its zod schema and handler args,
 * while storing it in the registry under the erased {@link ToolDef} type.
 */
function defineTool<S extends z.ZodRawShape>(def: {
	name: string;
	description: string;
	schema: S;
	handler: (backlog: BacklogClient, args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>;
}): ToolDef {
	return def as unknown as ToolDef;
}

/** Serialise any Backlog API response as the single JSON text block MCP clients expect. */
function jsonResult(data: unknown): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/**
 * Run a tool's handler, converting any thrown error (e.g. a failed Backlog API
 * request) into a structured `isError` result so the MCP client / LLM can read
 * and react to it instead of receiving an opaque server error.
 */
export async function executeTool(tool: ToolDef, backlog: BacklogClient, args: unknown): Promise<ToolResult> {
	try {
		return await tool.handler(backlog, args);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Backlog API error in ${tool.name}: ${message}` }],
			isError: true,
		};
	}
}

// Backlog requires `string | number` for *IdOrKey arguments: users pass keys
// like "DEMO-1" or numeric IDs.
const idOrKey = z.union([z.string(), z.number()]);
const order = z.enum(["asc", "desc"]);
// LLMs often pass a single number where Backlog expects a number[] (e.g. statusId).
// Accept either and always normalise to an array.
const numberOrArray = z
	.union([z.number(), z.array(z.number())])
	.transform((val) => (Array.isArray(val) ? val : [val]));
// Mirrors backlog-js `Option.Issue.SortKey`.
const issueSortKey = z.enum([
	"issueType",
	"category",
	"version",
	"milestone",
	"summary",
	"status",
	"priority",
	"attachment",
	"sharedFile",
	"created",
	"createdUser",
	"updated",
	"updatedUser",
	"assignee",
	"startDate",
	"dueDate",
	"estimatedHours",
	"actualHours",
	"childIssue",
]);

export const tools: ToolDef[] = [
	// ── User / space ──────────────────────────────────────────────────────────
	defineTool({
		name: "getMyself",
		description: "Get the authenticated user's own information from Backlog.",
		schema: {},
		handler: async (backlog) => jsonResult(await backlog.getMyself()),
	}),
	defineTool({
		name: "getUsers",
		description:
			"List all users in the Backlog space. Use this to resolve a person's name to the numeric userId required by assignee and notification parameters.",
		schema: {},
		handler: async (backlog) => jsonResult(await backlog.getUsers()),
	}),

	// ── Project metadata (ID resolution) ────────────────────────────────────────
	defineTool({
		name: "getProjects",
		description: "List the projects the authenticated user can access, to resolve project IDs and keys.",
		schema: {
			archived: z.boolean().optional().describe("Filter by archived state; omit to include both."),
			all: z.boolean().optional().describe("Admins only: include every project in the space."),
		},
		handler: async (backlog, args) => jsonResult(await backlog.getProjects(args)),
	}),
	defineTool({
		name: "getProjectUsers",
		description:
			"List the members of a project. Use this to resolve a name to the assigneeId needed when creating or filtering issues.",
		schema: {
			projectIdOrKey: idOrKey.describe('Project ID or key, e.g. "DEMO".'),
		},
		handler: async (backlog, { projectIdOrKey }) => jsonResult(await backlog.getProjectUsers(projectIdOrKey)),
	}),
	defineTool({
		name: "getIssueTypes",
		description:
			"List the issue types (e.g. Bug, Task) of a project. Required to resolve the issueTypeId when creating an issue.",
		schema: {
			projectIdOrKey: idOrKey.describe('Project ID or key, e.g. "DEMO".'),
		},
		handler: async (backlog, { projectIdOrKey }) => jsonResult(await backlog.getIssueTypes(projectIdOrKey)),
	}),
	defineTool({
		name: "getProjectStatuses",
		description:
			"List the statuses (e.g. Open, In Progress, Closed) of a project. Use this to resolve the statusId for filtering or for changing an issue's status.",
		schema: {
			projectIdOrKey: idOrKey.describe('Project ID or key, e.g. "DEMO".'),
		},
		handler: async (backlog, { projectIdOrKey }) => jsonResult(await backlog.getProjectStatuses(projectIdOrKey)),
	}),
	defineTool({
		name: "getPriorities",
		description: "List the space-wide issue priorities (High, Normal, Low) to resolve the priorityId.",
		schema: {},
		handler: async (backlog) => jsonResult(await backlog.getPriorities()),
	}),

	// ── Issues ──────────────────────────────────────────────────────────────────
	defineTool({
		name: "getIssues",
		description:
			"Search and list issues with filters such as project, status, assignee, keyword, and date ranges.",
		schema: {
			projectId: numberOrArray.optional().describe("Filter by project IDs."),
			issueTypeId: numberOrArray.optional().describe("Filter by issue type IDs."),
			categoryId: numberOrArray.optional().describe("Filter by category IDs."),
			milestoneId: numberOrArray.optional().describe("Filter by milestone (version) IDs."),
			statusId: numberOrArray.optional().describe("Filter by status IDs."),
			priorityId: numberOrArray.optional().describe("Filter by priority IDs."),
			assigneeId: numberOrArray.optional().describe("Filter by assignee user IDs."),
			parentIssueId: numberOrArray.optional().describe("Filter to children of these parent issue IDs."),
			keyword: z.string().optional().describe("Full-text search keyword."),
			createdSince: z.string().optional().describe("Created on or after this date (yyyy-MM-dd)."),
			createdUntil: z.string().optional().describe("Created on or before this date (yyyy-MM-dd)."),
			updatedSince: z.string().optional().describe("Updated on or after this date (yyyy-MM-dd)."),
			updatedUntil: z.string().optional().describe("Updated on or before this date (yyyy-MM-dd)."),
			dueDateSince: z.string().optional().describe("Due on or after this date (yyyy-MM-dd)."),
			dueDateUntil: z.string().optional().describe("Due on or before this date (yyyy-MM-dd)."),
			sort: issueSortKey.optional().describe("Sort key, e.g. created, updated, dueDate, priority."),
			order: order.optional().describe("Sort order."),
			offset: z.number().optional().describe("Pagination offset."),
			count: z.number().optional().describe("Number of issues to return (1-100, default 20)."),
		},
		handler: async (backlog, args) => jsonResult(await backlog.getIssues(args)),
	}),
	defineTool({
		name: "getIssue",
		description: "Get the full details of a single issue by its key or numeric ID.",
		schema: {
			issueIdOrKey: idOrKey.describe('Issue key (e.g. "DEMO-123") or numeric ID.'),
		},
		handler: async (backlog, { issueIdOrKey }) => jsonResult(await backlog.getIssue(issueIdOrKey)),
	}),
	defineTool({
		name: "postIssue",
		description:
			"Create a new issue. projectId, summary, issueTypeId and priorityId are required (resolve them with getProjects, getIssueTypes and getPriorities first).",
		schema: {
			projectId: z.number().describe("Project ID."),
			summary: z.string().describe("Issue summary / title."),
			issueTypeId: z.number().describe("Issue type ID (from getIssueTypes)."),
			priorityId: z.number().describe("Priority ID (from getPriorities)."),
			description: z.string().optional().describe("Issue body."),
			assigneeId: z.number().optional().describe("Assignee user ID."),
			parentIssueId: z.number().optional().describe("Parent issue ID, to create a child issue."),
			startDate: z.string().optional().describe("Start date (yyyy-MM-dd)."),
			dueDate: z.string().optional().describe("Due date (yyyy-MM-dd)."),
			estimatedHours: z.number().optional().describe("Estimated hours."),
			categoryId: numberOrArray.optional().describe("Category IDs."),
			milestoneId: numberOrArray.optional().describe("Milestone (version) IDs."),
			versionId: numberOrArray.optional().describe("Affected version IDs."),
			notifiedUserId: numberOrArray.optional().describe("User IDs to notify."),
		},
		handler: async (backlog, args) => jsonResult(await backlog.postIssue(args)),
	}),
	defineTool({
		name: "patchIssue",
		description:
			"Update an issue: change its status, assignee, due date, or add a comment. Set statusId to move an issue (e.g. to In Progress or Closed); use comment to record progress at the same time.",
		schema: {
			issueIdOrKey: idOrKey.describe('Issue key (e.g. "DEMO-123") or numeric ID.'),
			summary: z.string().optional().describe("New summary / title."),
			description: z.string().optional().describe("New body."),
			statusId: z.number().optional().describe("New status ID (from getProjectStatuses)."),
			resolutionId: z.number().optional().describe("Resolution ID, set when closing."),
			assigneeId: z.number().optional().describe("New assignee user ID."),
			priorityId: z.number().optional().describe("New priority ID."),
			startDate: z.string().optional().describe("Start date (yyyy-MM-dd)."),
			dueDate: z.string().optional().describe("Due date (yyyy-MM-dd)."),
			estimatedHours: z.number().optional().describe("Estimated hours."),
			actualHours: z.number().optional().describe("Actual hours."),
			comment: z.string().optional().describe("Comment to add alongside the update."),
			notifiedUserId: numberOrArray.optional().describe("User IDs to notify."),
		},
		handler: async (backlog, { issueIdOrKey, ...params }) =>
			jsonResult(await backlog.patchIssue(issueIdOrKey, params)),
	}),

	// ── Comments ──────────────────────────────────────────────────────────────
	defineTool({
		name: "getIssueComments",
		description: "List the comments on an issue, with optional pagination and ordering.",
		schema: {
			issueIdOrKey: idOrKey.describe('Issue key (e.g. "DEMO-123") or numeric ID.'),
			minId: z.number().optional().describe("Return comments with an ID greater than this."),
			maxId: z.number().optional().describe("Return comments with an ID less than this."),
			count: z.number().optional().describe("Number of comments to return (1-100, default 20)."),
			order: order.optional().describe("Sort order."),
		},
		handler: async (backlog, { issueIdOrKey, ...params }) =>
			jsonResult(await backlog.getIssueComments(issueIdOrKey, params)),
	}),
	defineTool({
		name: "postIssueComments",
		description: "Add a comment to an issue, optionally notifying users.",
		schema: {
			issueIdOrKey: idOrKey.describe('Issue key (e.g. "DEMO-123") or numeric ID.'),
			content: z.string().describe("Comment body (Markdown / Backlog notation supported)."),
			notifiedUserId: numberOrArray.optional().describe("User IDs to notify."),
		},
		handler: async (backlog, { issueIdOrKey, ...params }) =>
			jsonResult(await backlog.postIssueComments(issueIdOrKey, params)),
	}),

	// ── Notifications ───────────────────────────────────────────────────────────
	defineTool({
		name: "getNotifications",
		description: "List notifications addressed to the authenticated user (mentions, assignments, comments).",
		schema: {
			minId: z.number().optional().describe("Return notifications with an ID greater than this."),
			maxId: z.number().optional().describe("Return notifications with an ID less than this."),
			count: z.number().optional().describe("Number to return (1-100)."),
			order: order.optional().describe("Sort order."),
		},
		handler: async (backlog, args) => jsonResult(await backlog.getNotifications(args)),
	}),

	// ── Documents ──────────────────────────────────────────────────────────────
	defineTool({
		name: "getDocuments",
		description:
			"List Backlog documents with optional filters. Each result includes a 'plain' field with the full document body, so title listing and body reference can be done in a single API call. Omit projectId to use the defaultProjectId preference.",
		schema: {
			projectId: numberOrArray
				.optional()
				.describe("Filter by project IDs. A single number is also accepted and normalised to an array. Omit to use the defaultProjectId preference."),
			keyword: z.string().optional().describe("Filter documents by title keyword."),
			sort: z.enum(["created", "updated"]).optional().describe('Sort field: "created" or "updated".'),
			order: order.optional().describe('Sort order: "asc" or "desc" (default desc).'),
			offset: z.number().describe("Pagination offset (required by the Backlog API, use 0 to start from the beginning)."),
			count: z.number().optional().describe("Number of documents to return (1-100, default 20)."),
		},
		handler: async (backlog, args) => jsonResult(await backlog.getDocuments(args)),
	}),
	defineTool({
		name: "getDocument",
		description:
			"Get a single Backlog document by its ID (UUIDv7 string). Returns the full document including 'plain' body text.",
		schema: {
			documentId: z.string().describe("Document ID in UUIDv7 format (e.g. '01234567-89ab-7def-0123-456789abcdef')."),
		},
		handler: async (backlog, { documentId }) => jsonResult(await backlog.getDocument(documentId)),
	}),
	defineTool({
		name: "getDocumentTree",
		description:
			"Get the document folder/tree structure for a project, showing the parent-child hierarchy. Omit projectIdOrKey to use the defaultProjectId preference.",
		schema: {
			projectIdOrKey: idOrKey
				.optional()
				.describe('Project ID or key (e.g. "DEMO"). Omit to use the defaultProjectId preference.'),
		},
		handler: async (backlog, { projectIdOrKey }) => {
			if (!projectIdOrKey) {
				throw new Error(
					"projectIdOrKey is required. Provide it directly or set the defaultProjectId preference via set_preference.",
				);
			}
			return jsonResult(await backlog.getDocumentTree(projectIdOrKey));
		},
	}),

	defineTool({
		name: "addDocument",
		description:
			"Create a new document in a Backlog project. Returns the created document including its ID.",
		schema: {
			projectId: z.number().describe("Project ID."),
			title: z.string().optional().describe("Document title."),
			content: z.string().optional().describe("Document body (Backlog notation supported)."),
			emoji: z.string().optional().describe("Emoji icon for the document."),
			parentId: z
				.string()
				.optional()
				.describe("Parent document ID (UUIDv7) to create a child document."),
			addLast: z
				.boolean()
				.optional()
				.describe("Place this document last among siblings (default true)."),
		},
		handler: async (backlog, args) => jsonResult(await backlog.addDocument(args)),
	}),
	defineTool({
		name: "deleteDocument",
		description: "Delete a Backlog document by its ID. Returns the deleted document.",
		schema: {
			documentId: z
				.string()
				.describe("Document ID in UUIDv7 format (e.g. '01234567-89ab-7def-0123-456789abcdef')."),
		},
		handler: async (backlog, { documentId }) => jsonResult(await backlog.deleteDocument(documentId)),
	}),

	// ── Activities & daily reports ──────────────────────────────────────────────
	defineTool({
		name: "get_user_activities",
		description:
			"Get a Backlog user's recent activities (work log). Use a userId < 1 for the authenticated user.",
		schema: {
			userId: z.number().describe("Backlog user ID. Use a value < 1 for the authenticated user."),
			activityTypeId: z.array(z.number()).optional().describe("Filter by activity type IDs."),
			minId: z.number().optional().describe("Return activities with an ID greater than this."),
			maxId: z.number().optional().describe("Return activities with an ID less than this."),
			count: z.number().optional().describe("Number of activities to return (1-100)."),
			order: order.optional().describe("Sort order."),
		},
		handler: async (backlog, args) => jsonResult(await getUserActivities(backlog, args)),
	}),
	defineTool({
		name: "get_issue_with_comments",
		description:
			"Get an issue together with its comments in a single call. Provide either issueId or issueKey (e.g. DEMO-123). Convenient to avoid a second round-trip; for issues with very many comments, prefer getIssue + getIssueComments with pagination so the combined payload doesn't overflow the context window.",
		schema: {
			issueId: z.string().optional().describe("Issue numeric ID (as a string)."),
			issueKey: z.string().optional().describe('Issue key, e.g. "DEMO-123".'),
			count: z.number().optional().describe("Number of comments to retrieve (default 100)."),
			order: order.optional().describe("Comment sort order (default asc)."),
		},
		handler: async (backlog, args) => jsonResult(await getIssueWithComments(backlog, args)),
	}),
	defineTool({
		name: "generate_daily_report",
		description:
			"Generate a daily activity report for a Backlog user on a given date. Activities are filtered to meaningful ones (comments or substantive changes), grouped by project, and rendered. Use userId < 1 for the authenticated user.",
		schema: {
			userId: z.number().describe("Backlog user ID. Use a value < 1 for the authenticated user."),
			date: z.string().describe("Target date in YYYY-MM-DD format."),
			templateType: z
				.enum(["markdown", "text", "html"])
				.optional()
				.describe("Report output format (default markdown)."),
			language: z.enum(["ja", "en"]).optional().describe("Report language (default ja)."),
		},
		handler: async (backlog, args) => jsonResult(await generateDailyReport(backlog, args)),
	}),
	defineTool({
		name: "summarize_daily_activities",
		description:
			"Get a Backlog user's meaningful activities for a given date as structured data (filtered and grouped by project), without a pre-rendered report, so the calling model can summarize them. Use userId < 1 for the authenticated user.",
		schema: {
			userId: z.number().describe("Backlog user ID. Use a value < 1 for the authenticated user."),
			date: z.string().describe("Target date in YYYY-MM-DD format."),
		},
		handler: async (backlog, args) => jsonResult(await summarizeDailyActivities(backlog, args)),
	}),
];
