import { beforeEach, describe, expect, it, vi } from "vitest";

const recordInstallEventMock = vi.fn();

vi.mock("@/server/db/ingest", () => ({
  recordInstallEvent: recordInstallEventMock,
}));

const { POST } = await import("@/app/api/v1/installs/route");

beforeEach(() => {
  recordInstallEventMock.mockReset();
});

describe("POST /api/v1/installs", () => {
  it("returns accepted=false semantics for invalid payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/installs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bad: true }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      ignoredReason: "invalid_payload",
    });
  });

  it("returns accepted response", async () => {
    recordInstallEventMock.mockResolvedValue({ accepted: true });

    const response = await POST(
      new Request("http://localhost/api/v1/installs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: "550e8400-e29b-41d4-a716-446655440000",
          occurredAt: "2026-02-21T14:00:00.000Z",
          cliVersion: "0.1.0",
          source: { owner: "farnoodma", repo: "agents" },
          items: [
            {
              entityType: "skill",
              name: "release-check",
              filePath: "skills/release-check/SKILL.md",
            },
          ],
        }),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body).toEqual({ accepted: true });
  });
});
