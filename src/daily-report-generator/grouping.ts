import type { BacklogActivity, ProjectActivitiesMap } from "./types.js";

/**
 * Groups activities by their project key, preserving insertion order within
 * each project. Shared by the activity service and the report generator.
 */
export function groupActivitiesByProject(activities: BacklogActivity[]): ProjectActivitiesMap {
	const grouped: ProjectActivitiesMap = {};
	for (const activity of activities) {
		const projectKey = activity.project.projectKey;
		(grouped[projectKey] ??= []).push(activity);
	}
	return grouped;
}
