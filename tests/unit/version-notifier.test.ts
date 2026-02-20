import { describe, expect, it } from "vitest";
import { isNewerVersion } from "../../src/core/version-notifier.js";

describe("isNewerVersion", () => {
	it("detects higher patch versions", () => {
		expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
		expect(isNewerVersion("0.1.0", "0.1.1")).toBe(false);
	});

	it("detects higher minor and major versions", () => {
		expect(isNewerVersion("0.2.0", "0.1.9")).toBe(true);
		expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
	});

	it("handles prefixed or suffixed versions", () => {
		expect(isNewerVersion("v0.2.0", "0.1.9")).toBe(true);
		expect(isNewerVersion("0.2.0-beta.1", "0.1.9")).toBe(true);
	});

	it("returns false for invalid versions", () => {
		expect(isNewerVersion("invalid", "0.1.0")).toBe(false);
		expect(isNewerVersion("0.1.0", "invalid")).toBe(false);
	});
});
