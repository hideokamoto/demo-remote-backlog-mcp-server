import { describe, expect, it } from "vitest";
import { clearUserPref, getUserPrefs, setUserPref, userPrefsKey } from "../user-prefs";
import { USER_PREFS_KV_PREFIX } from "../utils";

/** Minimal in-memory mock for KVNamespace. */
function mockKV() {
	const store = new Map<string, string>();
	return {
		async get(key: string, type?: unknown) {
			const val = store.get(key) ?? null;
			if (val === null) return null;
			if (type === "json") return JSON.parse(val) as unknown;
			return val;
		},
		async put(key: string, value: string) {
			store.set(key, value);
		},
		async delete(key: string) {
			store.delete(key);
		},
		_store: store,
	} as unknown as KVNamespace & { _store: Map<string, string> };
}

describe("userPrefsKey", () => {
	it("returns the correct KV key for a given userId", () => {
		expect(userPrefsKey(42)).toBe(`${USER_PREFS_KV_PREFIX}42`);
	});
});

describe("getUserPrefs", () => {
	it("returns an empty object when no prefs are stored", async () => {
		const kv = mockKV();
		expect(await getUserPrefs(kv, 1)).toEqual({});
	});

	it("returns stored prefs", async () => {
		const kv = mockKV();
		kv._store.set(userPrefsKey(1), JSON.stringify({ defaultProjectId: 99 }));
		expect(await getUserPrefs(kv, 1)).toEqual({ defaultProjectId: 99 });
	});

	it("is isolated per userId", async () => {
		const kv = mockKV();
		kv._store.set(userPrefsKey(1), JSON.stringify({ defaultProjectId: 10 }));
		kv._store.set(userPrefsKey(2), JSON.stringify({ defaultProjectId: 20 }));
		expect(await getUserPrefs(kv, 1)).toEqual({ defaultProjectId: 10 });
		expect(await getUserPrefs(kv, 2)).toEqual({ defaultProjectId: 20 });
	});

	it("returns empty object for corrupted KV data (not an object)", async () => {
		const kv = mockKV();
		kv._store.set(userPrefsKey(1), JSON.stringify("corrupted string"));
		expect(await getUserPrefs(kv, 1)).toEqual({});
	});

	it("returns empty object for corrupted KV data (array)", async () => {
		const kv = mockKV();
		kv._store.set(userPrefsKey(1), JSON.stringify([1, 2, 3]));
		expect(await getUserPrefs(kv, 1)).toEqual({});
	});

	it("strips defaultProjectId when it is not a positive integer", async () => {
		const kv = mockKV();
		kv._store.set(userPrefsKey(1), JSON.stringify({ defaultProjectId: -5 }));
		expect(await getUserPrefs(kv, 1)).toEqual({});
	});

	it("strips defaultProjectId when it is a float", async () => {
		const kv = mockKV();
		kv._store.set(userPrefsKey(1), JSON.stringify({ defaultProjectId: 1.5 }));
		expect(await getUserPrefs(kv, 1)).toEqual({});
	});

	it("strips defaultProjectId when it is a string", async () => {
		const kv = mockKV();
		kv._store.set(userPrefsKey(1), JSON.stringify({ defaultProjectId: "123" }));
		expect(await getUserPrefs(kv, 1)).toEqual({});
	});

	it("strips unrecognised keys from KV data", async () => {
		const kv = mockKV();
		kv._store.set(userPrefsKey(1), JSON.stringify({ defaultProjectId: 42, unknownKey: "evil" }));
		expect(await getUserPrefs(kv, 1)).toEqual({ defaultProjectId: 42 });
	});
});

describe("setUserPref", () => {
	it("stores a numeric preference", async () => {
		const kv = mockKV();
		await setUserPref(kv, 1, "defaultProjectId", 745522);
		expect(await getUserPrefs(kv, 1)).toEqual({ defaultProjectId: 745522 });
	});

	it("overwrites an existing preference", async () => {
		const kv = mockKV();
		await setUserPref(kv, 1, "defaultProjectId", 100);
		await setUserPref(kv, 1, "defaultProjectId", 200);
		expect(await getUserPrefs(kv, 1)).toEqual({ defaultProjectId: 200 });
	});

	it("does not affect other users", async () => {
		const kv = mockKV();
		await setUserPref(kv, 1, "defaultProjectId", 100);
		expect(await getUserPrefs(kv, 2)).toEqual({});
	});
});

describe("clearUserPref", () => {
	it("removes a preference", async () => {
		const kv = mockKV();
		await setUserPref(kv, 1, "defaultProjectId", 99);
		await clearUserPref(kv, 1, "defaultProjectId");
		expect(await getUserPrefs(kv, 1)).toEqual({});
	});

	it("deletes the KV key entirely when no prefs remain", async () => {
		const kv = mockKV();
		await setUserPref(kv, 1, "defaultProjectId", 99);
		await clearUserPref(kv, 1, "defaultProjectId");
		expect(kv._store.has(userPrefsKey(1))).toBe(false);
	});

	it("is a no-op when the preference does not exist", async () => {
		const kv = mockKV();
		await expect(clearUserPref(kv, 1, "defaultProjectId")).resolves.toBeUndefined();
	});

	it("deletes the KV key entirely when only unknown keys remain after clearing the last valid pref", async () => {
		const kv = mockKV();
		// KV contains a valid pref alongside an unrecognised key; after clearing
		// defaultProjectId the validation layer strips the unknown key too, leaving
		// no valid prefs, so the KV entry is deleted entirely.
		kv._store.set(userPrefsKey(1), JSON.stringify({ defaultProjectId: 10, extra: "val" }));
		await clearUserPref(kv, 1, "defaultProjectId");
		expect(kv._store.has(userPrefsKey(1))).toBe(false);
	});
});
