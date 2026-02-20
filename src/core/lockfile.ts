import type { AgentsLockFile, LockEntry, ScopePaths } from "../types.js";
import { readJsonIfExists, writeJsonAtomic } from "./fs.js";

const EMPTY_LOCK: AgentsLockFile = {
	version: 1,
	entries: [],
};

export function readLockfile(paths: ScopePaths): AgentsLockFile {
	const lock = readJsonIfExists<AgentsLockFile>(paths.lockPath);
	if (!lock || lock.version !== 1 || !Array.isArray(lock.entries)) {
		return { ...EMPTY_LOCK };
	}
	return lock;
}

export function writeLockfile(
	paths: ScopePaths,
	lockfile: AgentsLockFile,
): void {
	writeJsonAtomic(paths.lockPath, lockfile);
}

export function upsertLockEntry(
	lockfile: AgentsLockFile,
	entry: LockEntry,
): void {
	const index = lockfile.entries.findIndex(
		(item) =>
			item.source === entry.source &&
			item.sourceType === entry.sourceType &&
			item.subdir === entry.subdir,
	);

	if (index >= 0) {
		lockfile.entries[index] = entry;
		return;
	}

	lockfile.entries.push(entry);
}
