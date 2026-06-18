import { describe, expect, it } from "vitest";
import { type ToolDef, tools } from "./tools";

/** Tools that only read data from Backlog and must be flagged read-only. */
const READ_ONLY_TOOLS = [
	"getMyself",
	"getUsers",
	"getProjects",
	"getProjectUsers",
	"getIssueTypes",
	"getProjectStatuses",
	"getPriorities",
	"getIssues",
	"getIssue",
	"getIssueComments",
	"getNotifications",
	"getDocuments",
	"getDocument",
	"getDocumentTree",
	"get_issue_with_comments",
	"get_user_activities",
	"generate_daily_report",
	"summarize_daily_activities",
];

/** Tools that mutate state but are not destructive. */
const WRITE_TOOLS = ["postIssue", "patchIssue", "postIssueComments", "addDocument"];

/** Tools that destroy/remove data. */
const DESTRUCTIVE_TOOLS = ["deleteDocument"];

function getTool(name: string): ToolDef {
	const tool = tools.find((t) => t.name === name);
	if (!tool) throw new Error(`tool not found: ${name}`);
	return tool;
}

describe("tool annotations", () => {
	it("every tool has an annotations object", () => {
		for (const tool of tools) {
			expect(tool.annotations, `${tool.name} should have annotations`).toBeDefined();
			expect(typeof tool.annotations).toBe("object");
		}
	});

	it("every tool sets openWorldHint=true (all call the external Backlog API)", () => {
		for (const tool of tools) {
			expect(tool.annotations?.openWorldHint, `${tool.name}.openWorldHint`).toBe(true);
		}
	});

	it("read-only tools have readOnlyHint=true and destructiveHint=false", () => {
		for (const name of READ_ONLY_TOOLS) {
			const a = getTool(name).annotations;
			expect(a?.readOnlyHint, `${name}.readOnlyHint`).toBe(true);
			expect(a?.destructiveHint, `${name}.destructiveHint`).toBe(false);
		}
	});

	it("write tools have readOnlyHint=false and destructiveHint=false", () => {
		for (const name of WRITE_TOOLS) {
			const a = getTool(name).annotations;
			expect(a?.readOnlyHint, `${name}.readOnlyHint`).toBe(false);
			expect(a?.destructiveHint, `${name}.destructiveHint`).toBe(false);
		}
	});

	it("destructive tools have readOnlyHint=false and destructiveHint=true", () => {
		for (const name of DESTRUCTIVE_TOOLS) {
			const a = getTool(name).annotations;
			expect(a?.readOnlyHint, `${name}.readOnlyHint`).toBe(false);
			expect(a?.destructiveHint, `${name}.destructiveHint`).toBe(true);
		}
	});

	it("idempotent write/destructive tools set idempotentHint=true", () => {
		expect(getTool("patchIssue").annotations?.idempotentHint).toBe(true);
		expect(getTool("deleteDocument").annotations?.idempotentHint).toBe(true);
	});
});
