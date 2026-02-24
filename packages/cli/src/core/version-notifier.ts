import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { ensureDir, writeJsonAtomic } from "./fs.js";

const UPDATE_CACHE_PATH = path.join(
  os.homedir(),
  ".agents",
  ".agentloom-version-cache.json",
);
const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1800;
const DISABLE_UPDATE_ENV = "AGENTLOOM_DISABLE_UPDATE_NOTIFIER";
const SKIP_COMMANDS = new Set([
  "help",
  "--help",
  "-h",
  "version",
  "--version",
  "-v",
  "upgrade",
]);

type VersionCache = {
  lastCheckedAt?: string;
  latestVersion?: string;
  lastUpgradeAttemptVersion?: string;
  lastUpgradeAttemptAt?: string;
  // Backward-compatible fields from previous cache format.
  lastAutoUpgradeVersion?: string;
  lastAutoUpgradeAt?: string;
};

type MaybeNotifyOptions = {
  command: string;
  argv: string[];
  packageName?: string;
  currentVersion: string;
};

export type UpgradeResult =
  | "updated"
  | "already-latest"
  | "failed"
  | "unavailable";

export async function maybeNotifyVersionUpdate(
  options: MaybeNotifyOptions,
): Promise<void> {
  if (process.env[DISABLE_UPDATE_ENV] === "1") return;

  const loweredCommand = options.command.trim().toLowerCase();
  if (SKIP_COMMANDS.has(loweredCommand)) return;

  const packageName = options.packageName ?? "agentloom";
  const cache = readVersionCache();
  const latest = await resolveLatestVersion({
    packageName,
    cache,
    forceFetch: false,
  });
  if (!latest) return;
  if (!isNewerVersion(latest, options.currentVersion)) return;

  const now = Date.now();
  if (!shouldAttemptAutoUpgrade(cache, latest, now)) {
    return;
  }

  const approved = await maybeConfirmAutoUpgrade(
    options.currentVersion,
    latest,
  );
  if (!approved) {
    recordUpgradeAttempt(cache, latest, now);
    writeVersionCache(cache);
    return;
  }

  // Persist attempt before upgrade/rerun, because rerun success paths can exit the process.
  recordUpgradeAttempt(cache, latest, now);
  writeVersionCache(cache);

  await promptAndUpdate(options.currentVersion, latest, {
    packageName,
    rerunArgs: options.argv,
  });
}

export async function upgradeToLatest(options: {
  currentVersion: string;
  packageName?: string;
}): Promise<UpgradeResult> {
  const packageName = options.packageName ?? "agentloom";
  const cache = readVersionCache();
  const latest = await resolveLatestVersion({
    packageName,
    cache,
    forceFetch: true,
  });

  if (!latest) return "unavailable";
  if (!isNewerVersion(latest, options.currentVersion)) {
    return "already-latest";
  }

  const result = await promptAndUpdate(options.currentVersion, latest, {
    packageName,
  });

  const now = Date.now();
  recordUpgradeAttempt(cache, latest, now);
  writeVersionCache(cache);

  return result;
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

export async function promptAndUpdate(
  current: string,
  latest: string,
  options: {
    packageName?: string;
    rerunArgs?: string[];
  } = {},
): Promise<"updated" | "already-latest" | "failed"> {
  if (!isNewerVersion(latest, current)) return "already-latest";

  const packageName = options.packageName ?? "agentloom";
  const rerunArgs = options.rerunArgs ?? [];

  if (rerunArgs.length > 0 && isLikelyNpxExecution()) {
    if (!canRunPackageViaNpx(packageName, latest)) {
      console.error(
        "\nAutomatic npx upgrade is currently unavailable; continuing with current version.\n",
      );
      return "failed";
    }

    console.log(
      `\nUpdate available: ${current} → ${latest}. Re-running with npx ${packageName}@${latest}...\n`,
    );
    const rerun = spawnSync(
      "npx",
      ["--yes", `${packageName}@${latest}`, ...rerunArgs],
      {
        stdio: "inherit",
        env: buildChildEnv(),
      },
    );

    if (rerun.error || rerun.status === null) {
      console.error(
        "\nAutomatic npx rerun failed after upgrade. Please run your command again.\n",
      );
      process.exit(1);
      return "failed"; // unreachable, but satisfies type checker
    }

    process.exit(rerun.status);
    return rerun.status === 0 ? "updated" : "failed"; // unreachable, but satisfies type checker
  }

  console.log(`\nUpdating ${packageName} ${current} → ${latest}...\n`);
  const install = spawnSync("npm", ["i", "-g", `${packageName}@${latest}`], {
    stdio: "inherit",
  });

  if (install.status !== 0) {
    console.error(
      "\nAutomatic upgrade failed. Run `agentloom upgrade` to retry.\n",
    );
    return "failed";
  }

  if (rerunArgs.length === 0) {
    console.log(`\nUpdated to ${latest}.\n`);
    return "updated";
  }

  console.log(`\nUpdated to ${latest}. Re-running your command...\n`);
  const invocation = buildRerunInvocation(rerunArgs);
  const rerun = spawnSync(invocation.command, invocation.args, {
    stdio: "inherit",
    env: buildChildEnv(),
  });

  if (rerun.error || rerun.status === null) {
    console.error(
      "\nAutomatic rerun failed after upgrade. Please run your command again.\n",
    );
    process.exit(1);
    return "failed"; // unreachable, but satisfies type checker
  }

  process.exit(rerun.status);
  return "updated"; // unreachable, but satisfies type checker
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

async function resolveLatestVersion(options: {
  packageName: string;
  cache: VersionCache;
  forceFetch: boolean;
}): Promise<string | null> {
  const now = Date.now();
  const lastChecked = parseTime(options.cache.lastCheckedAt);
  const shouldFetch =
    options.forceFetch ||
    !lastChecked ||
    now - lastChecked >= CHECK_INTERVAL_MS;

  if (!shouldFetch) {
    return options.cache.latestVersion ?? null;
  }

  const fetched = await fetchLatestVersion(options.packageName);
  options.cache.lastCheckedAt = new Date(now).toISOString();
  if (fetched) {
    options.cache.latestVersion = fetched;
  }

  writeVersionCache(options.cache);
  if (options.forceFetch) {
    return fetched ?? null;
  }
  return fetched ?? options.cache.latestVersion ?? null;
}

function shouldAttemptAutoUpgrade(
  cache: VersionCache,
  latest: string,
  now: number,
): boolean {
  const lastAttemptVersion =
    cache.lastUpgradeAttemptVersion ?? cache.lastAutoUpgradeVersion;
  if (lastAttemptVersion !== latest) return true;
  const lastAttempt = parseTime(
    cache.lastUpgradeAttemptAt ?? cache.lastAutoUpgradeAt,
  );
  if (!lastAttempt) return true;
  return now - lastAttempt >= CHECK_INTERVAL_MS;
}

function isLikelyNpxExecution(): boolean {
  const npmCommand = process.env.npm_command?.trim().toLowerCase();
  if (npmCommand === "exec") return true;

  const argv1 = process.argv[1];
  if (typeof argv1 !== "string" || argv1.length === 0) return false;
  return argv1.includes(`${path.sep}_npx${path.sep}`);
}

function buildChildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    [DISABLE_UPDATE_ENV]: "1",
  };
}

export async function maybeConfirmAutoUpgrade(
  current: string,
  latest: string,
): Promise<boolean> {
  if (!isInteractiveTty()) return true;
  const approved = await confirm({
    message: `Update available: ${current} → ${latest}. Upgrade now and re-run your command?`,
    initialValue: true,
  });
  if (isCancel(approved) || approved !== true) return false;
  return true;
}

function isInteractiveTty(): boolean {
  return Boolean(
    process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY,
  );
}

function recordUpgradeAttempt(
  cache: VersionCache,
  latest: string,
  now: number,
): void {
  cache.lastUpgradeAttemptVersion = latest;
  cache.lastUpgradeAttemptAt = new Date(now).toISOString();
}

function canRunPackageViaNpx(packageName: string, version: string): boolean {
  const probe = spawnSync(
    "npx",
    ["--yes", `${packageName}@${version}`, "--version"],
    {
      stdio: "ignore",
      env: buildChildEnv(),
    },
  );
  return !probe.error && probe.status === 0;
}

function buildRerunInvocation(rerunArgs: string[]): {
  command: string;
  args: string[];
} {
  const scriptPath = process.argv[1];
  if (typeof scriptPath === "string" && scriptPath.trim().length > 0) {
    return {
      command: process.execPath,
      args: [...process.execArgv, scriptPath, ...rerunArgs],
    };
  }

  return {
    command: "agentloom",
    args: rerunArgs,
  };
}
