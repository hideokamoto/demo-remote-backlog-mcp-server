import type { ActivityResult, BacklogActivity } from "./types.js";
import { CommentFilter, MeaningfulChangeFilter, OrFilter } from "./filters.js";
import type { ActivityFilter } from "./filters.js";
import { TemplateReportGenerator } from "./generators.js";
import type { ReportGenerator, ReportGeneratorConfig } from "./generators.js";

/**
 * Minimal slice of the Backlog client this service depends on. Keeping it small
 * makes the service trivial to unit test with a mock.
 */
export interface ActivitySource {
	getUserActivities(userId: number, params: { count?: number }): Promise<unknown[]>;
}

/**
 * Configuration for {@link BacklogActivityService}.
 */
export interface BacklogActivityServiceConfig {
	/** Custom activity filter (default: comment OR meaningful change). */
	filter?: ActivityFilter;
	/** Report rendering config passed to the default generator. */
	reportConfig?: ReportGeneratorConfig;
	/** Custom report generator override. */
	reportGenerator?: ReportGenerator;
	/**
	 * IANA timezone used to bucket activities into a calendar day. Backlog
	 * timestamps are UTC and this server runs on Cloudflare Workers (also UTC),
	 * so we default to Asia/Tokyo to keep day boundaries correct for the typical
	 * Backlog (Nulab) user.
	 */
	timeZone?: string;
}

/**
 * Fetches a user's activities for a given day, filters out noise, groups them
 * by project and renders a report.
 */
export class BacklogActivityService {
	private filter: ActivityFilter;
	private reportGenerator: ReportGenerator;
	private timeZone: string;

	constructor(
		private backlog: ActivitySource,
		config: BacklogActivityServiceConfig = {},
	) {
		this.filter = config.filter || new OrFilter([new CommentFilter(), new MeaningfulChangeFilter()]);
		this.reportGenerator =
			config.reportGenerator || new TemplateReportGenerator(config.reportConfig || {});
		this.timeZone = config.timeZone || "Asia/Tokyo";
	}

	/** Formats a Date as YYYY-MM-DD in the configured timezone. */
	private formatDate(date: Date): string {
		// en-CA renders dates as ISO-style YYYY-MM-DD.
		return new Intl.DateTimeFormat("en-CA", {
			timeZone: this.timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(date);
	}

	setFilter(filter: ActivityFilter): void {
		this.filter = filter;
	}

	setReportGenerator(generator: ReportGenerator): void {
		this.reportGenerator = generator;
	}

	configureReport(config: ReportGeneratorConfig): void {
		this.reportGenerator.configure(config);
	}

	/**
	 * Returns the meaningful activities for `userId` on `date` (YYYY-MM-DD),
	 * grouped by project, together with a rendered report.
	 */
	async getMeaningfulActivities(userId: number, date: string): Promise<ActivityResult> {
		const formattedDate = date || this.formatDate(new Date());

		const activities = await this.backlog.getUserActivities(userId, { count: 100 });

		const dayActivities = (activities as BacklogActivity[]).filter((activity) => {
			return this.formatDate(new Date(activity.created)) === formattedDate;
		});

		const meaningfulActivities = dayActivities.filter((activity) => this.filter.filter(activity));
		const groupedByProject = this.groupByProject(meaningfulActivities);
		const report = this.reportGenerator.generate(meaningfulActivities);

		return {
			date: formattedDate,
			activities: meaningfulActivities,
			groupedByProject,
			report,
		};
	}

	private groupByProject(activities: BacklogActivity[]): Record<string, BacklogActivity[]> {
		const groupedByProject: Record<string, BacklogActivity[]> = {};
		activities.forEach((activity) => {
			const projectKey = activity.project.projectKey;
			if (!groupedByProject[projectKey]) {
				groupedByProject[projectKey] = [];
			}
			groupedByProject[projectKey].push(activity);
		});
		return groupedByProject;
	}
}
