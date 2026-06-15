import { USER_PREFS_KV_PREFIX, type PrefKey, type UserPrefs } from "./utils";

export function userPrefsKey(userId: number): string {
	return `${USER_PREFS_KV_PREFIX}${userId}`;
}

export async function getUserPrefs(kv: KVNamespace, userId: number): Promise<UserPrefs> {
	const raw = await kv.get(userPrefsKey(userId), "json");
	return (raw as UserPrefs) ?? {};
}

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

export async function clearUserPref(kv: KVNamespace, userId: number, key: PrefKey): Promise<void> {
	const prefs = await getUserPrefs(kv, userId);
	delete prefs[key];
	if (Object.keys(prefs).length === 0) {
		await kv.delete(userPrefsKey(userId));
	} else {
		await kv.put(userPrefsKey(userId), JSON.stringify(prefs));
	}
}
