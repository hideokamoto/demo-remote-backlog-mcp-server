import type { BacklogActivity, BacklogChange } from "./types.js";
import { groupActivitiesByProject } from "./grouping.js";

/**
 * Escapes HTML special characters so Backlog-sourced content (issue summaries,
 * comments, user names, change values) can't inject markup into the HTML report.
 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Labels for each activity type.
 */
interface ActivityTypeLabels {
	created: string;
	updated: string;
	commented: string;
	bulkUpdated: string;
	defaultAction: string;
}

/**
 * String resources used when rendering a report.
 */
interface ReportResources {
	noActivities: string;
	changeTitle: string;
	noneValue: string;
	byUser: string;
	activityTypes: ActivityTypeLabels;
}

const jaResources: ReportResources = {
	noActivities: "この日の作業記録はありません。",
	changeTitle: "変更内容:",
	noneValue: "(なし)",
	byUser: "by",
	activityTypes: {
		created: "🆕 作成",
		updated: "✏️ 更新",
		commented: "💬 コメント",
		bulkUpdated: "📝 一括更新",
		defaultAction: "⚙️ アクション",
	},
};

const enResources: ReportResources = {
	noActivities: "No activities for this day.",
	changeTitle: "Changes:",
	noneValue: "(none)",
	byUser: "by",
	activityTypes: {
		created: "🆕 Created",
		updated: "✏️ Updated",
		commented: "💬 Commented",
		bulkUpdated: "📝 Bulk updated",
		defaultAction: "⚙️ Action",
	},
};

const resourcesMap: Record<string, ReportResources> = {
	ja: jaResources,
	en: enResources,
};

/**
 * Formats the individual pieces of a report. Implementations decide the markup
 * (markdown / plain text / html).
 */
export interface ReportTemplate {
	formatNoActivities(): string;
	formatProjectHeader(projectKey: string, projectName: string): string;
	formatActivityHeader(prefix: string, summary: string, keyId: number): string;
	formatComment(content: string): string;
	formatChangesHeader(): string;
	formatChangeLine(field: string, oldValue: string | null, newValue: string | null): string;
	/** Closes the change list opened by {@link formatChangesHeader}. */
	formatChangesFooter(): string;
	formatCreationInfo(time: string, username: string): string;
	formatSeparator(): string;
	wrapReport(content: string): string;
}

/**
 * Markdown template.
 */
export class MarkdownTemplate implements ReportTemplate {
	constructor(private resources: ReportResources) {}

	formatNoActivities(): string {
		return this.resources.noActivities;
	}

	formatProjectHeader(projectKey: string, projectName: string): string {
		return `## ${projectKey}: ${projectName}\n\n`;
	}

	formatActivityHeader(prefix: string, summary: string, keyId: number): string {
		return `### ${prefix}: ${summary} (#${keyId})\n`;
	}

	formatComment(content: string): string {
		return `\n${content}\n\n`;
	}

	formatChangesHeader(): string {
		return `**${this.resources.changeTitle}**\n\n`;
	}

	formatChangeLine(field: string, oldValue: string | null, newValue: string | null): string {
		const oldText = oldValue || this.resources.noneValue;
		const newText = newValue || this.resources.noneValue;
		return `- ${field}: ${oldText} → ${newText}\n`;
	}

	formatChangesFooter(): string {
		return "";
	}

	formatCreationInfo(time: string, username: string): string {
		return `*${time} ${this.resources.byUser} ${username}*\n\n`;
	}

	formatSeparator(): string {
		return "---\n\n";
	}

	wrapReport(content: string): string {
		return content;
	}
}

/**
 * Plain text template.
 */
export class TextTemplate implements ReportTemplate {
	constructor(private resources: ReportResources) {}

	formatNoActivities(): string {
		return this.resources.noActivities;
	}

	formatProjectHeader(projectKey: string, projectName: string): string {
		return `[${projectKey}] ${projectName}\n\n`;
	}

	formatActivityHeader(prefix: string, summary: string, keyId: number): string {
		return `${prefix}: ${summary} (#${keyId})\n`;
	}

	formatComment(content: string): string {
		return `\n${content}\n\n`;
	}

	formatChangesHeader(): string {
		return `${this.resources.changeTitle}\n`;
	}

	formatChangeLine(field: string, oldValue: string | null, newValue: string | null): string {
		const oldText = oldValue || this.resources.noneValue;
		const newText = newValue || this.resources.noneValue;
		return `* ${field}: ${oldText} → ${newText}\n`;
	}

	formatChangesFooter(): string {
		return "";
	}

	formatCreationInfo(time: string, username: string): string {
		return `${time} ${this.resources.byUser} ${username}\n\n`;
	}

	formatSeparator(): string {
		return "----------\n\n";
	}

	wrapReport(content: string): string {
		return content;
	}
}

/**
 * HTML template.
 */
export class HtmlTemplate implements ReportTemplate {
	constructor(private resources: ReportResources) {}

	formatNoActivities(): string {
		return `<p>${this.resources.noActivities}</p>`;
	}

	formatProjectHeader(projectKey: string, projectName: string): string {
		return `<h2>${escapeHtml(projectKey)}: ${escapeHtml(projectName)}</h2>`;
	}

	formatActivityHeader(prefix: string, summary: string, keyId: number): string {
		return `<h3>${prefix}: ${escapeHtml(summary)} (#${keyId})</h3>`;
	}

	formatComment(content: string): string {
		return `<div class="comment">${escapeHtml(content).replace(/\n/g, "<br>")}</div>`;
	}

	formatChangesHeader(): string {
		return `<h4>${this.resources.changeTitle}</h4><ul>`;
	}

	formatChangeLine(field: string, oldValue: string | null, newValue: string | null): string {
		const oldText = oldValue ? escapeHtml(oldValue) : this.resources.noneValue;
		const newText = newValue ? escapeHtml(newValue) : this.resources.noneValue;
		return `<li>${escapeHtml(field)}: ${oldText} → ${newText}</li>`;
	}

	formatChangesFooter(): string {
		return `</ul>`;
	}

	formatCreationInfo(time: string, username: string): string {
		return `<div class="meta"><em>${time} ${this.resources.byUser} ${escapeHtml(username)}</em></div>`;
	}

	formatSeparator(): string {
		return `<hr>`;
	}

	wrapReport(content: string): string {
		return `<div class="backlog-report">${content}</div>`;
	}
}

/**
 * Formats the time portion of an activity timestamp.
 */
export interface DateFormatter {
	formatTime(dateString: string): string;
}

export class DefaultDateFormatter implements DateFormatter {
	// Backlog timestamps are UTC and Cloudflare Workers also run in UTC, so we
	// default to Asia/Tokyo to render times for the typical Backlog (Nulab) user.
	constructor(private timeZone: string = "Asia/Tokyo") {}

	formatTime(dateString: string): string {
		return new Date(dateString).toLocaleTimeString("ja-JP", {
			hour: "2-digit",
			minute: "2-digit",
			timeZone: this.timeZone,
		});
	}
}

/**
 * Report generation configuration.
 */
export interface ReportGeneratorConfig {
	/** Language for the labels (default: "ja"). */
	language?: "ja" | "en";
	/** Output template (default: "markdown"). */
	templateType?: "markdown" | "text" | "html";
	/** Custom template override. */
	customTemplate?: ReportTemplate;
	/** Custom date formatter. */
	dateFormatter?: DateFormatter;
}

/**
 * Turns a list of activities into a formatted report string.
 */
export interface ReportGenerator {
	generate(activities: BacklogActivity[]): string;
}

/**
 * Template-based report generator.
 */
export class TemplateReportGenerator implements ReportGenerator {
	private template: ReportTemplate;
	private resources: ReportResources;
	private dateFormatter: DateFormatter;

	constructor(config: ReportGeneratorConfig = {}) {
		this.resources = resourcesMap[config.language || "ja"] || jaResources;
		this.dateFormatter = config.dateFormatter || new DefaultDateFormatter();
		this.template = this.buildTemplate(config);
	}

	private buildTemplate(config: ReportGeneratorConfig): ReportTemplate {
		if (config.customTemplate) {
			return config.customTemplate;
		}
		switch (config.templateType || "markdown") {
			case "text":
				return new TextTemplate(this.resources);
			case "html":
				return new HtmlTemplate(this.resources);
			default:
				return new MarkdownTemplate(this.resources);
		}
	}

	private getActivityTypeLabel(type: number): string {
		switch (type) {
			case 1:
				return this.resources.activityTypes.created;
			case 2:
				return this.resources.activityTypes.updated;
			case 3:
				return this.resources.activityTypes.commented;
			case 14:
				return this.resources.activityTypes.bulkUpdated;
			default:
				return this.resources.activityTypes.defaultAction;
		}
	}

	generate(activities: BacklogActivity[]): string {
		if (activities.length === 0) {
			return this.template.formatNoActivities();
		}

		let report = "";
		const groupedByProject = groupActivitiesByProject(activities);

		Object.entries(groupedByProject).forEach(([projectKey, projectActivities]) => {
			report += this.template.formatProjectHeader(projectKey, projectActivities[0].project.name);

			projectActivities.forEach((activity) => {
				const prefix = this.getActivityTypeLabel(activity.type);
				report += this.template.formatActivityHeader(prefix, activity.content.summary, activity.content.key_id);

				if (activity.content.comment && activity.content.comment.content) {
					report += this.template.formatComment(activity.content.comment.content);
				}

				if (activity.content.changes && activity.content.changes.length > 0) {
					report += this.template.formatChangesHeader();
					activity.content.changes.forEach((change: BacklogChange) => {
						const fieldName = change.field_text || change.field;
						report += this.template.formatChangeLine(fieldName, change.old_value, change.new_value);
					});
					report += this.template.formatChangesFooter();
				}

				const createdTime = this.dateFormatter.formatTime(activity.created);
				report += this.template.formatCreationInfo(createdTime, activity.createdUser.name);
				report += this.template.formatSeparator();
			});
		});

		return this.template.wrapReport(report);
	}
}
