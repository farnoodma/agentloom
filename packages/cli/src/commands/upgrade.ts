import type { ParsedArgs } from "minimist";
import { getUpgradeHelpText } from "../core/copy.js";
import { upgradeToLatest } from "../core/version-notifier.js";

export async function runUpgradeCommand(
  argv: ParsedArgs,
  currentVersion: string,
): Promise<void> {
  if (argv.help) {
    console.log(getUpgradeHelpText());
    return;
  }

  const result = await upgradeToLatest({ currentVersion });
  if (result === "updated") return;

  if (result === "already-latest") {
    console.log(`agentloom ${currentVersion} is already up to date.`);
    return;
  }

  if (result === "unavailable") {
    throw new Error(
      "Unable to reach npm to check the latest agentloom release.",
    );
  }

  throw new Error("Automatic upgrade failed.");
}
