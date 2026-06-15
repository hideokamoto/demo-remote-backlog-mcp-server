import { BacklogActivityService } from "./daily-report-generator/index.js";
import type { ActivityResult, ProjectActivitiesMap } from "./daily-report-generator/index.js";
// Type-only import (erased at runtime, so no import cycle with tools.ts) keeps a
// single definition of the Backlog client surface shared by the whole registry.
import type { BacklogClient } from "./tools.js";

/**
 * Resolves a Backlog user id, treating any value `< 1` as "the current user"
 * and looking it up via `getMyself()`.
 */
export async function resolveUserId(backlog: BacklogClient, userId: number): Promise<number> {
	if (userId < 1) {
		const myself = await backlog.getMyself();
		return myself.id;
	}
	return userId;
}

export interface GetUserActivitiesParams {
	userId: number;
	activityTypeId?: number[];
	minId?: number;
	maxId?: number;
	count?: number;
	order?: "asc" | "desc";
}

/**
 * Fetches a user's recent activities. `userId < 1` resolves to the current user.
 */
export async function getUserActivities(
	backlog: BacklogClient,
	{ userId, ...params }: GetUserActivitiesParams,
): Promise<unknown[]> {
	const resolved = await resolveUserId(backlog, userId);
	return backlog.getUserActivities(resolved, params);
}

export interface GetIssueWithCommentsParams {
	issueId?: string;
	issueKey?: string;
	count?: number;
	order?: "asc" | "desc";
}

/**
 * Fetches an issue together with its comments in a single call. Accepts either
 * an `issueId` or an `issueKey` (id wins if both are given).
 */
export async function getIssueWithComments(
	backlog: BacklogClient,
	{ issueId, issueKey, count, order }: GetIssueWithCommentsParams,
): Promise<{ issue: unknown; comments: unknown }> {
	const issueIdOrKey = issueId || issueKey;
	if (!issueIdOrKey) {
		throw new Error("issueId or issueKey is required");
	}
	// The issue and its comments are independent reads — fetch them in parallel.
	// Use `??` so an explicit `count: 0` / `order` is honoured rather than overridden.
	const [issue, comments] = await Promise.all([
		backlog.getIssue(issueIdOrKey),
		backlog.getIssueComments(issueIdOrKey, {
			order: order ?? "asc",
			count: count ?? 100,
		}),
	]);
	return { issue, comments };
}

export interface DailyParams {
	userId: number;
	date: string;
	templateType?: "markdown" | "text" | "html";
	language?: "ja" | "en";
}

/**
 * Builds a daily activity report (filtered, grouped, rendered) for a user/date.
 * Returns the rendered `report` plus the activities grouped by project. The flat
 * activity list is intentionally omitted: it duplicates `groupedByProject` and
 * would roughly double the serialized payload (and the client's context window).
 */
export async function generateDailyReport(
	backlog: BacklogClient,
	{ userId, date, templateType, language }: DailyParams,
): Promise<{ date: string; groupedByProject: ProjectActivitiesMap; report: string }> {
	const resolved = await resolveUserId(backlog, userId);
	const service = new BacklogActivityService(backlog, {
		reportConfig: { templateType, language },
	});
	const { date: reportDate, groupedByProject, report } = await service.getMeaningfulActivities(resolved, date);
	return { date: reportDate, groupedByProject, report };
}

/**
 * Returns the filtered daily activities grouped by project, without a
 * pre-rendered report — leaving the summarization to the calling LLM. The flat
 * activity list is omitted because `groupedByProject` already holds every
 * activity; returning both would duplicate the payload.
 */
export async function summarizeDailyActivities(
	backlog: BacklogClient,
	{ userId, date }: Pick<DailyParams, "userId" | "date">,
): Promise<Pick<ActivityResult, "date" | "groupedByProject">> {
	const resolved = await resolveUserId(backlog, userId);
	const service = new BacklogActivityService(backlog);
	const { date: reportDate, groupedByProject } = await service.getMeaningfulActivities(resolved, date);
	return { date: reportDate, groupedByProject };
}
