import { USER_PREFS_KV_PREFIX, type PrefKey, type UserPrefs } from "./utils";

/** Returns the KV key for a given userId. */
export function userPrefsKey(userId: number): string {
	return `${USER_PREFS_KV_PREFIX}${userId}`;
}

/**
 * Reads and validates user preferences from KV.
 * Returns only recognised fields with correct types; falls back to `{}` on missing or malformed data.
 */
export async function getUserPrefs(kv: KVNamespace, userId: number): Promise<UserPrefs> {
	const raw = await kv.get(userPrefsKey(userId), "json");
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

	const record = raw as Record<string, unknown>;
	const prefs: UserPrefs = {};
	if (
		typeof record.defaultProjectId === "number" &&
		Number.isSafeInteger(record.defaultProjectId) &&
		record.defaultProjectId > 0
	) {
		prefs.defaultProjectId = record.defaultProjectId;
	}
	return prefs;
}

/**
 * Persists a single preference key/value for the given user.
 * Merges with any existing preferences already stored in KV.
 */
export async function setUserPref(
	kv: KVNamespace,
	userId: number,
	key: PrefKey,
	value: number | string,
): Promise<void> {
	const prefs = await getUserPrefs(kv, userId);
	(prefs as Record<string, unknown>)[key] = value;
	await kv.put(userPrefsKey(userId), JSON.stringify(prefs));
}

/**
 * Removes a single preference key for the given user.
 * Deletes the KV entry entirely when no preferences remain.
 */
export async function clearUserPref(kv: KVNamespace, userId: number, key: PrefKey): Promise<void> {
	const prefs = await getUserPrefs(kv, userId);
	delete prefs[key];
	if (Object.keys(prefs).length === 0) {
		await kv.delete(userPrefsKey(userId));
	} else {
		await kv.put(userPrefsKey(userId), JSON.stringify(prefs));
	}
}
