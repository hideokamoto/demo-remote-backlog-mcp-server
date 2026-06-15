import { describe, it, expect, vi } from "vitest";
import {
	resolveUserId,
	getUserActivities,
	getIssueWithComments,
	generateDailyReport,
	summarizeDailyActivities,
} from "../backlog-tools.js";
import type { BacklogActivity } from "../daily-report-generator/index.js";

function activity(over: { id?: number; created?: string; projectKey?: string; comment?: string }): BacklogActivity {
	return {
		id: over.id ?? 1,
		project: { id: 1, projectKey: over.projectKey ?? "PROJ", name: "Project" },
		type: 2,
		content: {
			id: 1,
			key_id: 1,
			summary: "Summary",
			description: null,
			...(over.comment ? { comment: { id: 1, content: over.comment } } : {}),
		},
		createdUser: {
			id: 1,
			userId: "u",
			name: "Alice",
			roleType: 1,
			lang: "ja",
			mailAddress: "a@example.com",
			nulabAccount: { nulabId: "n", name: "Alice", uniqueId: "uq" },
			keyword: "",
			lastLoginTime: "2023-03-01T10:00:00Z",
		},
		created: over.created ?? "2023-04-01T10:00:00Z",
	} as BacklogActivity;
}

describe("resolveUserId", () => {
	it("returns the given id when it is positive", async () => {
		const backlog = { getMyself: vi.fn() } as any;
		expect(await resolveUserId(backlog, 42)).toBe(42);
		expect(backlog.getMyself).not.toHaveBeenCalled();
	});

	it("falls back to the current user when id < 1", async () => {
		const backlog = { getMyself: vi.fn().mockResolvedValue({ id: 7 }) } as any;
		expect(await resolveUserId(backlog, 0)).toBe(7);
		expect(backlog.getMyself).toHaveBeenCalledOnce();
	});
});

describe("getUserActivities", () => {
	it("resolves the current user before fetching when userId < 1", async () => {
		const backlog = {
			getMyself: vi.fn().mockResolvedValue({ id: 7 }),
			getUserActivities: vi.fn().mockResolvedValue([{ id: 1 }]),
		} as any;

		const result = await getUserActivities(backlog, { userId: -1, count: 20, order: "desc" });

		expect(backlog.getUserActivities).toHaveBeenCalledWith(7, { count: 20, order: "desc" });
		expect(result).toEqual([{ id: 1 }]);
	});

	it("passes through optional filter params", async () => {
		const backlog = { getUserActivities: vi.fn().mockResolvedValue([]) } as any;

		await getUserActivities(backlog, { userId: 5, activityTypeId: [1, 2], minId: 10, maxId: 99 });

		expect(backlog.getUserActivities).toHaveBeenCalledWith(5, {
			activityTypeId: [1, 2],
			minId: 10,
			maxId: 99,
		});
	});
});

describe("getIssueWithComments", () => {
	it("fetches the issue and its comments and returns them together", async () => {
		const backlog = {
			getIssue: vi.fn().mockResolvedValue({ id: 1, summary: "bug" }),
			getIssueComments: vi.fn().mockResolvedValue([{ id: 11, content: "c" }]),
		} as any;

		const result = await getIssueWithComments(backlog, { issueKey: "PROJ-1", count: 50, order: "desc" });

		expect(backlog.getIssue).toHaveBeenCalledWith("PROJ-1");
		expect(backlog.getIssueComments).toHaveBeenCalledWith("PROJ-1", { order: "desc", count: 50 });
		expect(result).toEqual({ issue: { id: 1, summary: "bug" }, comments: [{ id: 11, content: "c" }] });
	});

	it("prefers issueId over issueKey", async () => {
		const backlog = {
			getIssue: vi.fn().mockResolvedValue({}),
			getIssueComments: vi.fn().mockResolvedValue([]),
		} as any;

		await getIssueWithComments(backlog, { issueId: "123", issueKey: "PROJ-1" });

		expect(backlog.getIssue).toHaveBeenCalledWith("123");
	});

	it("defaults to asc order and count 100", async () => {
		const backlog = {
			getIssue: vi.fn().mockResolvedValue({}),
			getIssueComments: vi.fn().mockResolvedValue([]),
		} as any;

		await getIssueWithComments(backlog, { issueId: "123" });

		expect(backlog.getIssueComments).toHaveBeenCalledWith("123", { order: "asc", count: 100 });
	});

	it("throws when neither issueId nor issueKey is provided", async () => {
		const backlog = { getIssue: vi.fn(), getIssueComments: vi.fn() } as any;
		await expect(getIssueWithComments(backlog, {})).rejects.toThrow(/issueId or issueKey/i);
	});
});

describe("generateDailyReport", () => {
	it("returns a rendered report for the day, in the requested template", async () => {
		const backlog = {
			getUserActivities: vi.fn().mockResolvedValue([activity({ id: 1, comment: "did the work" })]),
		} as any;

		const result = await generateDailyReport(backlog, { userId: 5, date: "2023-04-01", templateType: "html" });

		expect(result.date).toBe("2023-04-01");
		expect(result.report).toContain('<div class="backlog-report">');
		expect(result.groupedByProject.PROJ).toHaveLength(1);
	});

	it("resolves the current user when userId < 1", async () => {
		const backlog = {
			getMyself: vi.fn().mockResolvedValue({ id: 9 }),
			getUserActivities: vi.fn().mockResolvedValue([]),
		} as any;

		await generateDailyReport(backlog, { userId: -1, date: "2023-04-01" });

		expect(backlog.getUserActivities).toHaveBeenCalledWith(9, { count: 100 });
	});
});

describe("summarizeDailyActivities", () => {
	it("returns structured data without a report string (left for the client LLM)", async () => {
		const backlog = {
			getUserActivities: vi.fn().mockResolvedValue([activity({ id: 1, comment: "did the work" })]),
		} as any;

		const result = await summarizeDailyActivities(backlog, { userId: 5, date: "2023-04-01" });

		expect(result.date).toBe("2023-04-01");
		expect(result.activities).toHaveLength(1);
		expect(result.groupedByProject.PROJ).toHaveLength(1);
		expect("report" in result).toBe(false);
	});
});
