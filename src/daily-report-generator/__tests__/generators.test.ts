import { describe, it, expect } from "vitest";
import { TemplateReportGenerator } from "../generators.js";
import type { BacklogActivity } from "../types.js";

function activity(overrides: Partial<BacklogActivity> = {}): BacklogActivity {
	return {
		id: 1,
		project: { id: 1, projectKey: "PROJ", name: "My Project" },
		type: 1,
		content: {
			id: 10,
			key_id: 123,
			summary: "Fix bug",
			description: null,
			comment: { id: 1, content: "looking into it" },
			changes: [{ field: "status", field_text: "ステータス", new_value: "処理中", old_value: "未対応", type: "standard" }],
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
		created: "2023-03-01T10:00:00Z",
		...overrides,
	} as BacklogActivity;
}

describe("TemplateReportGenerator", () => {
	it("returns a no-activities message when given an empty list (ja default)", () => {
		const report = new TemplateReportGenerator().generate([]);
		expect(report).toBe("この日の作業記録はありません。");
	});

	it("returns the English no-activities message when language is en", () => {
		const report = new TemplateReportGenerator({ language: "en" }).generate([]);
		expect(report).toBe("No activities for this day.");
	});

	it("renders a markdown report containing project header, summary, comment and change", () => {
		const report = new TemplateReportGenerator({ templateType: "markdown" }).generate([activity()]);
		expect(report).toContain("## PROJ: My Project");
		expect(report).toContain("### 🆕 作成: Fix bug (#123)");
		expect(report).toContain("looking into it");
		expect(report).toContain("ステータス: 未対応 → 処理中");
	});

	it("renders an html report wrapped in the report container", () => {
		const report = new TemplateReportGenerator({ templateType: "html" }).generate([activity()]);
		expect(report).toContain('<div class="backlog-report">');
		expect(report).toContain("<h2>PROJ: My Project</h2>");
	});

	it("escapes HTML special characters in user-sourced content (no injection)", () => {
		const malicious = activity({
			content: {
				id: 10,
				key_id: 200,
				summary: "<script>alert('xss')</script>",
				description: null,
				comment: { id: 3, content: "<img src=x onerror=alert(1)>" },
			},
		} as Partial<BacklogActivity>);

		const report = new TemplateReportGenerator({ templateType: "html" }).generate([malicious]);

		expect(report).not.toContain("<script>");
		expect(report).not.toContain("<img src=x");
		expect(report).toContain("&lt;script&gt;");
		expect(report).toContain("&lt;img src=x onerror=alert(1)&gt;");
	});

	it("produces balanced <ul>/</ul> tags in html whether or not changes exist", () => {
		const withChanges = activity();
		const noChanges = activity({
			content: {
				id: 10,
				key_id: 124,
				summary: "No change item",
				description: null,
				comment: { id: 2, content: "just a comment" },
			},
		} as Partial<BacklogActivity>);

		const report = new TemplateReportGenerator({ templateType: "html" }).generate([withChanges, noChanges]);

		const opens = report.match(/<ul>/g)?.length ?? 0;
		const closes = report.match(/<\/ul>/g)?.length ?? 0;
		expect(opens).toBe(closes);
		// The activity without changes must not emit an orphaned closing tag.
		expect(opens).toBe(1);
	});

	it("groups multiple activities under their project key", () => {
		const a = activity();
		const b = activity({ project: { id: 2, projectKey: "OTHER", name: "Other" } } as Partial<BacklogActivity>);
		const report = new TemplateReportGenerator({ templateType: "text" }).generate([a, b]);
		expect(report).toContain("[PROJ] My Project");
		expect(report).toContain("[OTHER] Other");
	});
});
