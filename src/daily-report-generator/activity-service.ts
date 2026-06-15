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
}

/**
 * Fetches a user's activities for a given day, filters out noise, groups them
 * by project and renders a report.
 */
export class BacklogActivityService {
	private filter: ActivityFilter;
	private reportGenerator: ReportGenerator;

	constructor(
		private backlog: ActivitySource,
		config: BacklogActivityServiceConfig = {},
	) {
		this.filter = config.filter || new OrFilter([new CommentFilter(), new MeaningfulChangeFilter()]);
		this.reportGenerator =
			config.reportGenerator || new TemplateReportGenerator(config.reportConfig || {});
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
		const formattedDate = (date ? new Date(date) : new Date()).toISOString().split("T")[0];

		const activities = await this.backlog.getUserActivities(userId, { count: 100 });

		const dayActivities = (activities as BacklogActivity[]).filter((activity) => {
			const activityDate = activity.created.split("T")[0];
			return activityDate === formattedDate;
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
