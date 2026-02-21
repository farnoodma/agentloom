import { describe, expect, it } from "vitest";
import { GET } from "@/app/skills/[...path]/route";

describe("skills redirect route", () => {
  it("redirects to skills.sh with path", async () => {
    const response = await GET(new Request("https://agentloom.sh/skills/foo/bar"), {
      params: Promise.resolve({ path: ["foo", "bar"] }),
    });

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://skills.sh/foo/bar");
  });
});
