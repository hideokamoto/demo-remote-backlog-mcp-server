import { BacklogActivityService } from "./daily-report-generator/index.js";
import type { ActivityResult } from "./daily-report-generator/index.js";

/**
 * The subset of the `backlog-js` client used by the tools in this module.
 * Declaring it explicitly keeps the tool logic decoupled from the concrete
 * client and trivial to unit test with a mock.
 */
export interface BacklogClient {
	getMyself(): Promise<{ id: number }>;
	getUserActivities(userId: number, params: Record<string, unknown>): Promise<unknown[]>;
	getIssue(issueIdOrKey: string): Promise<unknown>;
	getIssueComments(issueIdOrKey: string, params: { order?: "asc" | "desc"; count?: number }): Promise<unknown>;
}

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
	const issue = await backlog.getIssue(issueIdOrKey);
	const comments = await backlog.getIssueComments(issueIdOrKey, {
		order: order || "asc",
		count: count || 100,
	});
	return { issue, comments };
}

export interface DailyParams {
	userId: number;
	date: string;
	templateType?: "markdown" | "text" | "html";
	language?: string;
}

/**
 * Builds a daily activity report (filtered, grouped, rendered) for a user/date.
 */
export async function generateDailyReport(
	backlog: BacklogClient,
	{ userId, date, templateType, language }: DailyParams,
): Promise<ActivityResult> {
	const resolved = await resolveUserId(backlog, userId);
	const service = new BacklogActivityService(backlog, {
		reportConfig: { templateType, language },
	});
	return service.getMeaningfulActivities(resolved, date);
}

/**
 * Returns the filtered/grouped daily activities as structured data, without a
 * pre-rendered report — leaving the summarization to the calling LLM.
 */
export async function summarizeDailyActivities(
	backlog: BacklogClient,
	{ userId, date }: Pick<DailyParams, "userId" | "date">,
): Promise<Omit<ActivityResult, "report">> {
	const resolved = await resolveUserId(backlog, userId);
	const service = new BacklogActivityService(backlog);
	const { report: _report, ...rest } = await service.getMeaningfulActivities(resolved, date);
	return rest;
}
