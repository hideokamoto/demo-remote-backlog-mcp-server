import type { BacklogActivity, BacklogChange } from "./types.js";

// Field names that represent a deadline/period change (Backlog uses several
// depending on the change, so we match against a list).
export const MILESTONE_FIELDS = ["milestone", "limitDate", "dueDate", "period", "date", "期限日"];
// Field names that represent an assignee change.
export const ASSIGNEE_FIELDS = ["assigner", "assignee", "担当者", "担当"];

/**
 * An activity filter. Every filter implements this interface so they can be
 * composed with the And/Or/Not combinators.
 */
export interface ActivityFilter {
	/**
	 * @returns true when the activity passes the filter
	 */
	filter(activity: BacklogActivity): boolean;
}

/**
 * Passes activities that carry a non-empty comment.
 */
export class CommentFilter implements ActivityFilter {
	filter(activity: BacklogActivity): boolean {
		return !!(activity.content.comment && activity.content.comment.content.trim());
	}
}

/**
 * Passes activities whose changes are "meaningful" — i.e. not purely a
 * deadline change and not purely an assignee change.
 */
export class MeaningfulChangeFilter implements ActivityFilter {
	constructor(
		private milestoneFields: string[] = MILESTONE_FIELDS,
		private assigneeFields: string[] = ASSIGNEE_FIELDS,
	) {}

	filter(activity: BacklogActivity): boolean {
		if (!activity.content.changes || activity.content.changes.length === 0) {
			return false;
		}
		return !this.isNonMeaningfulChange(activity.content.changes);
	}

	private isNonMeaningfulChange(changes: BacklogChange[]): boolean {
		if (!changes || changes.length === 0) {
			return false;
		}

		if (changes.length === 1) {
			const field = changes[0].field;
			const fieldText = changes[0].field_text || "";
			return (
				this.isFieldInList(field, fieldText, this.milestoneFields) ||
				this.isFieldInList(field, fieldText, this.assigneeFields)
			);
		}

		const onlyMilestoneChanges = changes.every((change) =>
			this.isFieldInList(change.field, change.field_text || "", this.milestoneFields),
		);
		const onlyAssigneeChanges = changes.every((change) =>
			this.isFieldInList(change.field, change.field_text || "", this.assigneeFields),
		);

		return onlyMilestoneChanges || onlyAssigneeChanges;
	}

	private isFieldInList(field: string, fieldText: string, fieldList: string[]): boolean {
		return fieldList.includes(field) || fieldList.includes(fieldText);
	}
}

/**
 * Passes when any of the wrapped filters pass.
 */
export class OrFilter implements ActivityFilter {
	constructor(private filters: ActivityFilter[]) {}

	filter(activity: BacklogActivity): boolean {
		return this.filters.some((filter) => filter.filter(activity));
	}
}

/**
 * Passes when all of the wrapped filters pass.
 */
export class AndFilter implements ActivityFilter {
	constructor(private filters: ActivityFilter[]) {}

	filter(activity: BacklogActivity): boolean {
		return this.filters.every((filter) => filter.filter(activity));
	}
}

/**
 * Negates the wrapped filter.
 */
export class NotFilter implements ActivityFilter {
	constructor(private filterToNegate: ActivityFilter) {}

	filter(activity: BacklogActivity): boolean {
		return !this.filterToNegate.filter(activity);
	}
}
