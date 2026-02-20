import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { ensureDir, writeJsonAtomic } from "./fs.js";

const UPDATE_CACHE_PATH = path.join(
	os.homedir(),
	".agents",
	".agentloom-version-cache.json",
);
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1800;

type VersionCache = {
	lastCheckedAt?: string;
	latestVersion?: string;
	lastNotifiedVersion?: string;
};

type MaybeNotifyOptions = {
	command: string;
	packageName?: string;
	currentVersion: string;
};

export async function maybeNotifyVersionUpdate(
	options: MaybeNotifyOptions,
): Promise<void> {
	if (process.env.AGENTLOOM_DISABLE_UPDATE_NOTIFIER === "1") return;
	if (!process.stdout.isTTY || !process.stderr.isTTY) return;

	const loweredCommand = options.command.toLowerCase();
	if (
		loweredCommand === "help" ||
		loweredCommand === "--help" ||
		loweredCommand === "-h" ||
		loweredCommand === "version" ||
		loweredCommand === "--version" ||
		loweredCommand === "-v"
	) {
		return;
	}

	const packageName = options.packageName ?? "agentloom";
	const cache = readVersionCache();

	if (
		cache.latestVersion &&
		isNewerVersion(cache.latestVersion, options.currentVersion) &&
		cache.lastNotifiedVersion !== cache.latestVersion
	) {
		printNotice(options.currentVersion, cache.latestVersion);
		cache.lastNotifiedVersion = cache.latestVersion;
		writeVersionCache(cache);
	}

	const now = Date.now();
	const lastChecked = parseTime(cache.lastCheckedAt);
	if (lastChecked && now - lastChecked < CHECK_INTERVAL_MS) {
		return;
	}

	const latest = await fetchLatestVersion(packageName);
	if (!latest) {
		cache.lastCheckedAt = new Date(now).toISOString();
		writeVersionCache(cache);
		return;
	}

	cache.lastCheckedAt = new Date(now).toISOString();
	cache.latestVersion = latest;

	if (
		isNewerVersion(latest, options.currentVersion) &&
		cache.lastNotifiedVersion !== latest
	) {
		printNotice(options.currentVersion, latest);
		cache.lastNotifiedVersion = latest;
	}

	writeVersionCache(cache);
}

export function isNewerVersion(candidate: string, current: string): boolean {
	const next = parseSemver(candidate);
	const base = parseSemver(current);
	if (!next || !base) return false;

	for (let index = 0; index < 3; index += 1) {
		if (next[index] > base[index]) return true;
		if (next[index] < base[index]) return false;
	}
	return false;
}

function parseSemver(input: string): [number, number, number] | null {
	const normalized = input.replace(/^v/i, "").split("-")[0];
	const parts = normalized.split(".");
	if (parts.length < 3) return null;

	const numbers = parts.slice(0, 3).map((part) => Number(part));
	if (numbers.some((num) => Number.isNaN(num) || num < 0)) return null;

	return [numbers[0], numbers[1], numbers[2]];
}

function fetchLatestVersion(packageName: string): Promise<string | null> {
	const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;

	return new Promise((resolve) => {
		const req = https.get(
			url,
			{
				headers: {
					Accept: "application/json",
				},
			},
			(res) => {
				if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
					resolve(null);
					return;
				}

				const chunks: Buffer[] = [];
				res.on("data", (chunk) => {
					chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
				});
				res.on("end", () => {
					try {
						const parsed = JSON.parse(
							Buffer.concat(chunks).toString("utf8"),
						) as {
							version?: string;
						};
						if (typeof parsed.version === "string" && parsed.version.trim()) {
							resolve(parsed.version.trim());
							return;
						}
					} catch {
						// ignore parse errors
					}
					resolve(null);
				});
			},
		);

		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			req.destroy();
			resolve(null);
		});

		req.on("error", () => resolve(null));
	});
}

function printNotice(current: string, latest: string): void {
	console.error(
		`\nUpdate available for agentloom: ${current} -> ${latest}\nRun: npm i -g agentloom\n`,
	);
}

function readVersionCache(): VersionCache {
	try {
		if (!fs.existsSync(UPDATE_CACHE_PATH)) return {};
		const parsed = JSON.parse(
			fs.readFileSync(UPDATE_CACHE_PATH, "utf8"),
		) as VersionCache;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeVersionCache(cache: VersionCache): void {
	try {
		ensureDir(path.dirname(UPDATE_CACHE_PATH));
		writeJsonAtomic(UPDATE_CACHE_PATH, cache);
	} catch {
		// best-effort only
	}
}

function parseTime(value: string | undefined): number | null {
	if (!value) return null;
	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) return null;
	return parsed;
}
