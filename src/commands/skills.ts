import { spawnSync } from "node:child_process";

export function runSkillsPassthrough(args: string[]): never {
	const child = spawnSync("npx", ["skills", ...args], {
		stdio: "inherit",
		shell: false,
	});

	if (child.error) {
		throw child.error;
	}

	process.exit(child.status ?? 1);
}
