import { describe, it, expect } from "vitest";
import {
	MILESTONE_FIELDS,
	ASSIGNEE_FIELDS,
	CommentFilter,
	MeaningfulChangeFilter,
	OrFilter,
	AndFilter,
	NotFilter,
} from "../filters.js";
import type { BacklogActivity } from "../types.js";

// Helper to build mock activities
function createMockActivity(options: {
	hasComment?: boolean;
	commentContent?: string;
	changes?: Array<{
		field: string;
		field_text?: string;
		new_value: string | null;
		old_value: string | null;
		type: string;
	}>;
}): BacklogActivity {
	const { hasComment = false, commentContent = "", changes = [] } = options;

	return {
		id: 1,
		project: { id: 1, projectKey: "TEST", name: "テストプロジェクト" },
		type: 1,
		content: {
			id: 1,
			key_id: 1,
			summary: "テスト課題",
			description: null,
			...(hasComment ? { comment: { id: 1, content: commentContent } } : {}),
			...(changes.length > 0 ? { changes } : {}),
		},
		createdUser: {
			id: 1,
			userId: "test-user",
			name: "テストユーザー",
			roleType: 1,
			lang: "ja",
			mailAddress: "test@example.com",
			nulabAccount: { nulabId: "test-nulab", name: "テストユーザー", uniqueId: "test-unique" },
			keyword: "keyword",
			lastLoginTime: "2023-03-01T10:00:00Z",
		},
		created: "2023-03-01T10:00:00Z",
	} as BacklogActivity;
}

describe("filters", () => {
	describe("constants", () => {
		it("MILESTONE_FIELDS contains deadline-related field names", () => {
			expect(MILESTONE_FIELDS).toContain("milestone");
			expect(MILESTONE_FIELDS).toContain("limitDate");
			expect(MILESTONE_FIELDS).toContain("期限日");
		});

		it("ASSIGNEE_FIELDS contains assignee-related field names", () => {
			expect(ASSIGNEE_FIELDS).toContain("assignee");
			expect(ASSIGNEE_FIELDS).toContain("担当者");
		});
	});

	describe("CommentFilter", () => {
		const filter = new CommentFilter();

		it("returns true when a non-empty comment exists", () => {
			expect(filter.filter(createMockActivity({ hasComment: true, commentContent: "テスト" }))).toBe(true);
		});

		it("returns false when no comment exists", () => {
			expect(filter.filter(createMockActivity({ hasComment: false }))).toBe(false);
		});

		it("returns false when the comment is whitespace only", () => {
			expect(filter.filter(createMockActivity({ hasComment: true, commentContent: "   " }))).toBe(false);
		});
	});

	describe("MeaningfulChangeFilter", () => {
		const filter = new MeaningfulChangeFilter();

		it("returns false when there are no changes", () => {
			expect(filter.filter(createMockActivity({}))).toBe(false);
		});

		it("returns false for a deadline-only change", () => {
			const activity = createMockActivity({
				changes: [{ field: "limitDate", new_value: "2023-03-10", old_value: "2023-03-01", type: "standard" }],
			});
			expect(filter.filter(activity)).toBe(false);
		});

		it("returns false for an assignee-only change", () => {
			const activity = createMockActivity({
				changes: [{ field: "assignee", new_value: "user2", old_value: "user1", type: "standard" }],
			});
			expect(filter.filter(activity)).toBe(false);
		});

		it("returns true for a substantive change (status)", () => {
			const activity = createMockActivity({
				changes: [{ field: "status", new_value: "処理中", old_value: "未対応", type: "standard" }],
			});
			expect(filter.filter(activity)).toBe(true);
		});

		it("returns false when all multiple changes are deadline-related", () => {
			const activity = createMockActivity({
				changes: [
					{ field: "limitDate", new_value: "2023-03-10", old_value: "2023-03-01", type: "standard" },
					{ field: "milestone", new_value: "Sprint 2", old_value: "Sprint 1", type: "standard" },
				],
			});
			expect(filter.filter(activity)).toBe(false);
		});

		it("returns true when a deadline change is mixed with a substantive change", () => {
			const activity = createMockActivity({
				changes: [
					{ field: "limitDate", new_value: "2023-03-10", old_value: "2023-03-01", type: "standard" },
					{ field: "status", new_value: "処理中", old_value: "未対応", type: "standard" },
				],
			});
			expect(filter.filter(activity)).toBe(true);
		});
	});

	describe("OrFilter", () => {
		const orFilter = new OrFilter([new CommentFilter(), new MeaningfulChangeFilter()]);

		it("returns true when any filter matches", () => {
			const commentOnly = createMockActivity({
				hasComment: true,
				commentContent: "テスト",
				changes: [{ field: "limitDate", new_value: "2023-03-10", old_value: "2023-03-01", type: "standard" }],
			});
			expect(orFilter.filter(commentOnly)).toBe(true);
		});

		it("returns false when no filter matches", () => {
			const noise = createMockActivity({
				changes: [{ field: "limitDate", new_value: "2023-03-10", old_value: "2023-03-01", type: "standard" }],
			});
			expect(orFilter.filter(noise)).toBe(false);
		});
	});

	describe("AndFilter", () => {
		const andFilter = new AndFilter([new CommentFilter(), new MeaningfulChangeFilter()]);

		it("returns true only when every filter matches", () => {
			const both = createMockActivity({
				hasComment: true,
				commentContent: "テスト",
				changes: [{ field: "status", new_value: "処理中", old_value: "未対応", type: "standard" }],
			});
			expect(andFilter.filter(both)).toBe(true);
		});

		it("returns false when any filter fails", () => {
			const commentOnly = createMockActivity({
				hasComment: true,
				commentContent: "テスト",
				changes: [{ field: "limitDate", new_value: "2023-03-10", old_value: "2023-03-01", type: "standard" }],
			});
			expect(andFilter.filter(commentOnly)).toBe(false);
		});
	});

	describe("NotFilter", () => {
		it("inverts the wrapped filter", () => {
			const notComment = new NotFilter(new CommentFilter());
			expect(notComment.filter(createMockActivity({ hasComment: true, commentContent: "x" }))).toBe(false);
			expect(notComment.filter(createMockActivity({ hasComment: false }))).toBe(true);
		});
	});
});
