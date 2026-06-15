/**
 * Change entry inside a Backlog activity
 */
export interface BacklogChange {
	field: string;
	field_text?: string;
	new_value: string | null;
	old_value: string | null;
	type: string;
}

/**
 * Backlog comment
 */
export interface BacklogComment {
	id: number;
	content: string;
}

/**
 * Backlog activity content
 */
export interface BacklogContent {
	id: number;
	key_id: number;
	summary: string;
	description: string | null;
	comment?: BacklogComment;
	changes?: BacklogChange[];
	attachments?: unknown[];
	shared_files?: unknown[];
	external_file_links?: unknown[];
}

/**
 * Backlog project
 */
export interface BacklogProject {
	id: number;
	projectKey: string;
	name: string;
	chartEnabled?: boolean;
	useResolvedForChart?: boolean;
	subtaskingEnabled?: boolean;
	projectLeaderCanEditProjectLeader?: boolean;
	useWiki?: boolean;
	useDocument?: boolean;
	useFileSharing?: boolean;
	useWikiTreeView?: boolean;
	useOriginalImageSizeAtWiki?: boolean;
	textFormattingRule?: string;
	archived?: boolean;
	displayOrder?: number;
	useDevAttributes?: boolean;
}

/**
 * Backlog user
 */
export interface BacklogUser {
	id: number;
	userId: string;
	name: string;
	roleType: number;
	lang: string;
	mailAddress: string;
	nulabAccount: {
		nulabId: string;
		name: string;
		uniqueId: string;
		iconUrl?: string;
	};
	keyword: string;
	lastLoginTime: string;
}

/**
 * Backlog activity
 */
export interface BacklogActivity {
	id: number;
	project: BacklogProject;
	type: number;
	content: BacklogContent;
	notifications?: unknown[];
	createdUser: BacklogUser;
	created: string;
}

/**
 * Map of project key to its activities
 */
export type ProjectActivitiesMap = Record<string, BacklogActivity[]>;

/**
 * Result of fetching meaningful activities for a date
 */
export interface ActivityResult {
	date: string;
	activities: BacklogActivity[];
	groupedByProject: ProjectActivitiesMap;
	report: string;
}
