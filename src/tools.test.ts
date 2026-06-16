import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type BacklogClient, type ToolDef, executeTool, tools } from "./tools";

/**
 * Build a fake BacklogClient where every method is a vi.fn() returning the
 * given sentinel value. Lets us assert (a) which method a tool calls, (b) with
 * what arguments, and (c) that the tool serialises the return value verbatim.
 */
function fakeBacklog(returnValue: unknown = { ok: true }): BacklogClient {
	return new Proxy({} as Record<string | symbol, unknown>, {
		get: (target, prop) => {
			// Respect explicitly assigned mocks; otherwise auto-vivify a stub fn.
			if (!(prop in target)) {
				target[prop] = vi.fn().mockResolvedValue(returnValue);
			}
			return target[prop];
		},
	}) as unknown as BacklogClient;
}

function getTool(name: string): ToolDef {
	const tool = tools.find((t) => t.name === name);
	if (!tool) throw new Error(`tool not found: ${name}`);
	return tool;
}

/** Run a tool's handler and return the parsed JSON payload of its first content item. */
async function run(name: string, backlog: BacklogClient, args: Record<string, unknown> = {}) {
	const result = await getTool(name).handler(backlog, args);
	return result;
}

describe("tools registry", () => {
	it("registers all 21 tools", () => {
		expect(tools).toHaveLength(21);
	});

	it("has the expected tool names", () => {
		expect(tools.map((t) => t.name).sort()).toEqual(
			[
				"getMyself",
				"getUsers",
				"getProjects",
				"getProjectUsers",
				"getIssueTypes",
				"getProjectStatuses",
				"getPriorities",
				"getIssues",
				"getIssue",
				"postIssue",
				"patchIssue",
				"getIssueComments",
				"postIssueComments",
				"getNotifications",
				"get_user_activities",
				"get_issue_with_comments",
				"generate_daily_report",
				"summarize_daily_activities",
				"getDocuments",
				"getDocument",
				"getDocumentTree",
			].sort(),
		);
	});

	it("gives every tool a unique name, a description, and a schema", () => {
		const names = new Set<string>();
		for (const tool of tools) {
			expect(tool.name).toBeTruthy();
			expect(tool.description.length).toBeGreaterThan(0);
			expect(tool.schema).toBeTypeOf("object");
			expect(names.has(tool.name)).toBe(false);
			names.add(tool.name);
		}
	});

	it("serialises the Backlog response as JSON text content", async () => {
		const payload = { id: 1, name: "Alice" };
		const result = await run("getMyself", fakeBacklog(payload));
		expect(result).toEqual({
			content: [{ type: "text", text: JSON.stringify(payload) }],
		});
	});
});

describe("no-argument tools", () => {
	it.each(["getMyself", "getUsers", "getPriorities"])("%s calls the matching method", async (name) => {
		const backlog = fakeBacklog();
		const method = vi.fn().mockResolvedValue({ ok: true });
		(backlog as Record<string, unknown>)[name] = method;
		await run(name, backlog);
		expect(method).toHaveBeenCalledWith();
	});
});

describe("project lookup tools", () => {
	it("getProjects passes archived/all params through", async () => {
		const backlog = fakeBacklog();
		const getProjects = vi.fn().mockResolvedValue([]);
		(backlog as Record<string, unknown>).getProjects = getProjects;
		await run("getProjects", backlog, { archived: true });
		expect(getProjects).toHaveBeenCalledWith({ archived: true });
	});

	it.each(["getProjectUsers", "getIssueTypes", "getProjectStatuses"])(
		"%s forwards projectIdOrKey as a positional argument",
		async (name) => {
			const backlog = fakeBacklog();
			const method = vi.fn().mockResolvedValue([]);
			(backlog as Record<string, unknown>)[name] = method;
			await run(name, backlog, { projectIdOrKey: "DEMO" });
			expect(method).toHaveBeenCalledWith("DEMO");
		},
	);
});

describe("issue tools", () => {
	it("getIssues forwards filter params as a single object", async () => {
		const backlog = fakeBacklog();
		const getIssues = vi.fn().mockResolvedValue([]);
		(backlog as Record<string, unknown>).getIssues = getIssues;
		await run("getIssues", backlog, { projectId: [1], statusId: [2], keyword: "bug" });
		expect(getIssues).toHaveBeenCalledWith({ projectId: [1], statusId: [2], keyword: "bug" });
	});

	it("getIssue forwards issueIdOrKey positionally", async () => {
		const backlog = fakeBacklog();
		const getIssue = vi.fn().mockResolvedValue({});
		(backlog as Record<string, unknown>).getIssue = getIssue;
		await run("getIssue", backlog, { issueIdOrKey: "DEMO-1" });
		expect(getIssue).toHaveBeenCalledWith("DEMO-1");
	});

	it("postIssue forwards the params object", async () => {
		const backlog = fakeBacklog();
		const postIssue = vi.fn().mockResolvedValue({});
		(backlog as Record<string, unknown>).postIssue = postIssue;
		const params = { projectId: 1, summary: "Bug", issueTypeId: 2, priorityId: 3 };
		await run("postIssue", backlog, params);
		expect(postIssue).toHaveBeenCalledWith(params);
	});

	it("patchIssue splits issueIdOrKey from the update params", async () => {
		const backlog = fakeBacklog();
		const patchIssue = vi.fn().mockResolvedValue({});
		(backlog as Record<string, unknown>).patchIssue = patchIssue;
		await run("patchIssue", backlog, {
			issueIdOrKey: "DEMO-1",
			statusId: 3,
			comment: "done",
		});
		expect(patchIssue).toHaveBeenCalledWith("DEMO-1", { statusId: 3, comment: "done" });
	});
});

describe("comment tools", () => {
	it("getIssueComments splits issueIdOrKey from the query params", async () => {
		const backlog = fakeBacklog();
		const getIssueComments = vi.fn().mockResolvedValue([]);
		(backlog as Record<string, unknown>).getIssueComments = getIssueComments;
		await run("getIssueComments", backlog, { issueIdOrKey: "DEMO-1", count: 5, order: "desc" });
		expect(getIssueComments).toHaveBeenCalledWith("DEMO-1", { count: 5, order: "desc" });
	});

	it("postIssueComments splits issueIdOrKey from the body params", async () => {
		const backlog = fakeBacklog();
		const postIssueComments = vi.fn().mockResolvedValue({});
		(backlog as Record<string, unknown>).postIssueComments = postIssueComments;
		await run("postIssueComments", backlog, { issueIdOrKey: "DEMO-1", content: "hello" });
		expect(postIssueComments).toHaveBeenCalledWith("DEMO-1", { content: "hello" });
	});
});

describe("notification tools", () => {
	it("getNotifications forwards the query params", async () => {
		const backlog = fakeBacklog();
		const getNotifications = vi.fn().mockResolvedValue([]);
		(backlog as Record<string, unknown>).getNotifications = getNotifications;
		await run("getNotifications", backlog, { count: 10, order: "desc" });
		expect(getNotifications).toHaveBeenCalledWith({ count: 10, order: "desc" });
	});

	it("getNotifications defaults to an empty params object when none given", async () => {
		const backlog = fakeBacklog();
		const getNotifications = vi.fn().mockResolvedValue([]);
		(backlog as Record<string, unknown>).getNotifications = getNotifications;
		await run("getNotifications", backlog);
		expect(getNotifications).toHaveBeenCalledWith({});
	});
});

describe("executeTool error handling", () => {
	it("returns a structured isError result when the Backlog call throws", async () => {
		const backlog = fakeBacklog();
		(backlog as Record<string, unknown>).getMyself = vi.fn().mockRejectedValue(new Error("boom"));
		const result = await executeTool(getTool("getMyself"), backlog, {});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("boom");
	});

	it("normalises non-Error throws to a string message", async () => {
		const backlog = fakeBacklog();
		(backlog as Record<string, unknown>).getMyself = vi.fn().mockRejectedValue("nope");
		const result = await executeTool(getTool("getMyself"), backlog, {});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("nope");
	});

	it("passes a successful result through unchanged", async () => {
		const result = await executeTool(getTool("getMyself"), fakeBacklog({ id: 1 }), {});
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toBe(JSON.stringify({ id: 1 }));
	});
});

describe("document tools", () => {
	it("getDocuments forwards filter params as a single object", async () => {
		const backlog = fakeBacklog();
		const getDocuments = vi.fn().mockResolvedValue([]);
		(backlog as Record<string, unknown>).getDocuments = getDocuments;
		await run("getDocuments", backlog, { projectId: [745522], keyword: "議事録", offset: 0 });
		expect(getDocuments).toHaveBeenCalledWith({ projectId: [745522], keyword: "議事録", offset: 0 });
	});

	it("getDocuments passes offset-only call", async () => {
		const backlog = fakeBacklog();
		const getDocuments = vi.fn().mockResolvedValue([]);
		(backlog as Record<string, unknown>).getDocuments = getDocuments;
		await run("getDocuments", backlog, { offset: 0 });
		expect(getDocuments).toHaveBeenCalledWith({ offset: 0 });
	});

	it("getDocument forwards documentId as a positional string argument", async () => {
		const backlog = fakeBacklog();
		const getDocument = vi.fn().mockResolvedValue({ id: "01234567-89ab-7def-0123-456789abcdef", title: "Test" });
		(backlog as Record<string, unknown>).getDocument = getDocument;
		await run("getDocument", backlog, { documentId: "01234567-89ab-7def-0123-456789abcdef" });
		expect(getDocument).toHaveBeenCalledWith("01234567-89ab-7def-0123-456789abcdef");
	});

	it("getDocumentTree forwards projectIdOrKey as a positional argument", async () => {
		const backlog = fakeBacklog();
		const getDocumentTree = vi.fn().mockResolvedValue({ projectId: "745522", activeTree: { id: "root", children: [] } });
		(backlog as Record<string, unknown>).getDocumentTree = getDocumentTree;
		await run("getDocumentTree", backlog, { projectIdOrKey: 745522 });
		expect(getDocumentTree).toHaveBeenCalledWith(745522);
	});

	it("getDocumentTree accepts a string project key", async () => {
		const backlog = fakeBacklog();
		const getDocumentTree = vi.fn().mockResolvedValue({ projectId: "123" });
		(backlog as Record<string, unknown>).getDocumentTree = getDocumentTree;
		await run("getDocumentTree", backlog, { projectIdOrKey: "JP_STRIPES_CONNECT_2026" });
		expect(getDocumentTree).toHaveBeenCalledWith("JP_STRIPES_CONNECT_2026");
	});

	it("getDocumentTree returns an error when projectIdOrKey is omitted", async () => {
		const result = await executeTool(getTool("getDocumentTree"), fakeBacklog(), {});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("projectIdOrKey is required");
	});

	it("getDocuments accepts a single numeric projectId and normalises it to an array", () => {
		const schema = z.object(getTool("getDocuments").schema);
		const parsed = schema.parse({ projectId: 745522, offset: 0 });
		expect(parsed.projectId).toEqual([745522]);
	});
});

describe("numeric id coercion", () => {
	it("getIssues coerces a single numeric id into an array", () => {
		const schema = z.object(getTool("getIssues").schema);
		const parsed = schema.parse({ projectId: 5, statusId: [1, 2] });
		expect(parsed.projectId).toEqual([5]);
		expect(parsed.statusId).toEqual([1, 2]);
	});

	it("postIssue coerces a single notifiedUserId into an array", () => {
		const schema = z.object(getTool("postIssue").schema);
		const parsed = schema.parse({
			projectId: 1,
			summary: "Bug",
			issueTypeId: 2,
			priorityId: 3,
			notifiedUserId: 7,
		});
		expect(parsed.notifiedUserId).toEqual([7]);
	});

	it("postIssueComments coerces a single notifiedUserId into an array", () => {
		const schema = z.object(getTool("postIssueComments").schema);
		const parsed = schema.parse({ issueIdOrKey: "DEMO-1", content: "hi", notifiedUserId: 7 });
		expect(parsed.notifiedUserId).toEqual([7]);
	});
});
