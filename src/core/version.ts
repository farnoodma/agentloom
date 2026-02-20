import fs from "node:fs";

let cachedVersion: string | null = null;

function readPackageVersion(): string {
  try {
    const packageUrl = new URL("../../package.json", import.meta.url);
    const raw = fs.readFileSync(packageUrl, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // fall through
  }
  return "0.0.0";
}

export function getCliVersion(): string {
  if (typeof process.env.npm_package_version === "string") {
    return process.env.npm_package_version;
  }

  if (cachedVersion === null) {
    cachedVersion = readPackageVersion();
  }

  return cachedVersion;
}
