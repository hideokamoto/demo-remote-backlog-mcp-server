import { describe, it, expect, vi } from "vitest";
import { BacklogActivityService } from "../activity-service.js";
import type { BacklogActivity } from "../types.js";

function activity(over: {
	id?: number;
	created?: string;
	projectKey?: string;
	comment?: string;
	changes?: Array<{ field: string; new_value: string | null; old_value: string | null; type: string }>;
}): BacklogActivity {
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
			...(over.changes ? { changes: over.changes } : {}),
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

function mockBacklog(activities: BacklogActivity[]) {
	return {
		getUserActivities: vi.fn().mockResolvedValue(activities),
	} as any;
}

describe("BacklogActivityService.getMeaningfulActivities", () => {
	it("keeps only activities created on the requested date", async () => {
		const backlog = mockBacklog([
			activity({ id: 1, created: "2023-04-01T09:00:00Z", comment: "on target" }),
			activity({ id: 2, created: "2023-04-02T09:00:00Z", comment: "next day" }),
		]);
		const service = new BacklogActivityService(backlog);

		const result = await service.getMeaningfulActivities(100, "2023-04-01");

		expect(result.date).toBe("2023-04-01");
		expect(result.activities.map((a) => a.id)).toEqual([1]);
	});

	it("filters out noise (deadline-only changes, no comment)", async () => {
		const backlog = mockBacklog([
			activity({ id: 1, comment: "meaningful comment" }),
			activity({
				id: 2,
				changes: [{ field: "limitDate", new_value: "2023-04-10", old_value: "2023-04-01", type: "standard" }],
			}),
		]);
		const service = new BacklogActivityService(backlog);

		const result = await service.getMeaningfulActivities(100, "2023-04-01");

		expect(result.activities.map((a) => a.id)).toEqual([1]);
	});

	it("groups surviving activities by project key", async () => {
		const backlog = mockBacklog([
			activity({ id: 1, projectKey: "AAA", comment: "c1" }),
			activity({ id: 2, projectKey: "BBB", comment: "c2" }),
			activity({ id: 3, projectKey: "AAA", comment: "c3" }),
		]);
		const service = new BacklogActivityService(backlog);

		const result = await service.getMeaningfulActivities(100, "2023-04-01");

		expect(Object.keys(result.groupedByProject).sort()).toEqual(["AAA", "BBB"]);
		expect(result.groupedByProject.AAA.map((a) => a.id)).toEqual([1, 3]);
	});

	it("includes a generated report string", async () => {
		const backlog = mockBacklog([activity({ id: 1, projectKey: "PROJ", comment: "did the work" })]);
		const service = new BacklogActivityService(backlog);

		const result = await service.getMeaningfulActivities(100, "2023-04-01");

		expect(typeof result.report).toBe("string");
		expect(result.report).toContain("## PROJ");
		expect(result.report).toContain("did the work");
	});

	it("buckets activities by the configured timezone (JST default)", async () => {
		// 2023-04-01T16:00Z is 2023-04-02 01:00 JST, so it belongs to Apr 2 in JST.
		const backlog = mockBacklog([
			activity({ id: 1, created: "2023-04-01T16:00:00Z", comment: "late night JST" }),
			activity({ id: 2, created: "2023-04-02T02:00:00Z", comment: "also Apr 2 JST" }),
		]);
		const service = new BacklogActivityService(backlog);

		const result = await service.getMeaningfulActivities(100, "2023-04-02");

		expect(result.activities.map((a) => a.id)).toEqual([1, 2]);
	});

	it("honors a configured template type for the report", async () => {
		const backlog = mockBacklog([activity({ id: 1, projectKey: "PROJ", comment: "did the work" })]);
		const service = new BacklogActivityService(backlog, { reportConfig: { templateType: "html" } });

		const result = await service.getMeaningfulActivities(100, "2023-04-01");

		expect(result.report).toContain('<div class="backlog-report">');
	});
});
