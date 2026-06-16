import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Backlog } from "backlog-js";

/**
 * Creates a ResourceTemplate for `backlog://projects/{projectKey}` with an
 * autocomplete callback that suggests matching project keys.
 *
 * The `complete.projectKey` callback fetches the accessible project list and
 * filters it by the partial value the user has typed so far.
 */
export function createProjectResourceTemplate(getBacklog: () => Promise<Backlog>): ResourceTemplate {
	return new ResourceTemplate("backlog://projects/{projectKey}", {
		list: undefined,
		complete: {
			projectKey: async (partial: string): Promise<string[]> => {
				try {
					const backlog = await getBacklog();
					const projects = await backlog.getProjects({});
					const keys = projects.map((p: { projectKey: string }) => p.projectKey);
					if (!partial) return keys;
					const lower = partial.toLowerCase();
					return keys.filter((k: string) => k.toLowerCase().startsWith(lower));
				} catch {
					return [];
				}
			},
		},
	});
}

/**
 * Creates a ResourceTemplate for `backlog://issues/{issueKey}` with an
 * autocomplete callback that suggests recent issue keys matching the partial input.
 *
 * The completion fetches the 20 most-recently-updated issues and extracts their
 * keys, filtered by what the user has typed.
 */
export function createIssueResourceTemplate(getBacklog: () => Promise<Backlog>): ResourceTemplate {
	return new ResourceTemplate("backlog://issues/{issueKey}", {
		list: undefined,
		complete: {
			issueKey: async (partial: string): Promise<string[]> => {
				try {
					const backlog = await getBacklog();
					const issues = await backlog.getIssues({ count: 20, sort: "updated", order: "desc" });
					const keys = issues.map((i: { issueKey: string }) => i.issueKey);
					if (!partial) return keys;
					const lower = partial.toLowerCase();
					return keys.filter((k: string) => k.toLowerCase().startsWith(lower));
				} catch {
					return [];
				}
			},
		},
	});
}
