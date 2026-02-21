import { EventEmitter } from "node:events";
import https from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FoundAgent } from "../../src/commands/find.js";
import {
  runFindCommand,
  runScopedFindCommand,
  searchAgents,
} from "../../src/commands/find.js";

function encodeBase64(value: string): string {
  return Buffer.from(value).toString("base64");
}

function canonicalAgentMarkdown(agentName: string): string {
  return `---
name: ${agentName}
description: ${agentName} description
---

You are ${agentName}.
`;
}

describe("find command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints help text", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runFindCommand({ _: ["find"], help: true } as never);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("agentloom find <query>");
  });

  it("fails with usage guidance when query is missing", async () => {
    await expect(
      runFindCommand({
        _: ["find"],
      } as never),
    ).rejects.toThrow("Missing required <query>.");
  });

  it("accepts query tokens passed after -- passthrough", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const searchMock = vi.fn<[string, number], Promise<FoundAgent[]>>();
    searchMock.mockResolvedValue([]);

    await runFindCommand(
      {
        _: ["find"],
        "--": ["--react", "reviewer"],
      } as never,
      searchMock,
    );

    expect(searchMock).toHaveBeenCalledWith("--react reviewer", 8);
    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain('No shared agents found for "--react reviewer".');
  });

  it("prints matching agents with install commands", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const searchMock = vi.fn<[string, number], Promise<FoundAgent[]>>();
    searchMock.mockResolvedValue([
      {
        repo: "acme/frontend-agents",
        agentName: "react-reviewer",
        filePath: "agents/react-reviewer.md",
        fileUrl:
          "https://github.com/acme/frontend-agents/blob/main/agents/react-reviewer.md",
        stars: 42,
      },
    ]);

    await runFindCommand(
      { _: ["find", "react", "reviewer"] } as never,
      searchMock,
    );

    expect(searchMock).toHaveBeenCalledWith("react reviewer", 8);
    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain('Found 1 matching agent for "react reviewer":');
    expect(output).toContain("acme/frontend-agents@react-reviewer (42★)");
    expect(output).toContain("Install: agentloom add acme/frontend-agents");
  });

  it("uses explicit install source when provided", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const searchMock = vi.fn<[string, number], Promise<FoundAgent[]>>();
    searchMock.mockResolvedValue([
      {
        repo: "acme/frontend-agents",
        agentName: "react-reviewer",
        filePath: "agents/react-reviewer.md",
        fileUrl:
          "https://github.example.com/acme/frontend-agents/blob/main/agents/react-reviewer.md",
        source: "https://github.example.com/acme/frontend-agents.git",
        stars: 42,
      },
    ]);

    await runFindCommand(
      { _: ["find", "react", "reviewer"] } as never,
      searchMock,
    );

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      "Install: agentloom add 'https://github.example.com/acme/frontend-agents.git'",
    );
  });

  it("quotes unsafe subdir values in install commands", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const searchMock = vi.fn<[string, number], Promise<FoundAgent[]>>();
    searchMock.mockResolvedValue([
      {
        repo: "acme/frontend-agents",
        agentName: "react-reviewer",
        filePath: "packages/docs/agents/react-reviewer.md",
        fileUrl:
          "https://github.com/acme/frontend-agents/blob/main/packages/docs/agents/react-reviewer.md",
        stars: 42,
        subdir: "packages/docs; rm -rf /",
      },
    ]);

    await runFindCommand({ _: ["find", "reviewer"] } as never, searchMock);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      "Install: agentloom add acme/frontend-agents --subdir 'packages/docs; rm -rf /'",
    );
  });

  it("quotes subdir values that start with dashes in install commands", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const searchMock = vi.fn<[string, number], Promise<FoundAgent[]>>();
    searchMock.mockResolvedValue([
      {
        repo: "acme/frontend-agents",
        agentName: "react-reviewer",
        filePath: "packages/docs/agents/react-reviewer.md",
        fileUrl:
          "https://github.com/acme/frontend-agents/blob/main/packages/docs/agents/react-reviewer.md",
        stars: 42,
        subdir: "-hidden/agents",
      },
    ]);

    await runFindCommand({ _: ["find", "reviewer"] } as never, searchMock);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      "Install: agentloom add acme/frontend-agents --subdir '-hidden/agents'",
    );
  });

  it("finds commands from prompts/ paths and prints command install commands", async () => {
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };
      response.statusCode = 200;

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              tree: [
                {
                  path: "prompts/release.mdc",
                  type: "blob",
                },
              ],
            }),
          ),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runScopedFindCommand(
      { _: ["command", "find", "release"] } as never,
      "command",
    );

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain('Found 1 match(es) for "release".');
    expect(output).toContain(
      "acme/frontend-agents@release (42★) (prompts/release.mdc)",
    );
    expect(output).toContain(
      "Install: agentloom command add acme/frontend-agents",
    );
  });

  it("parses root SKILL.md names for skill install commands", async () => {
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };
      response.statusCode = 200;

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (targetUrl.pathname.includes("/contents/SKILL.md")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                type: "file",
                encoding: "base64",
                content: encodeBase64(
                  `---
name: visual-explainer
description: Explain visuals
---

Skill body.
`,
                ),
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              tree: [
                {
                  path: "SKILL.md",
                  type: "blob",
                },
              ],
            }),
          ),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runScopedFindCommand(
      { _: ["skill", "find", "visual"] } as never,
      "skill",
    );

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      "acme/frontend-agents@visual-explainer (42★) (SKILL.md)",
    );
    expect(output).toContain(
      "Install: agentloom skill add acme/frontend-agents --skills visual-explainer",
    );
  });

  it("omits --skills in install command when root SKILL.md name cannot be parsed", async () => {
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };
      response.statusCode = 200;

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (targetUrl.pathname.includes("/contents/SKILL.md")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                type: "file",
                encoding: "base64",
                content: encodeBase64("Skill without frontmatter."),
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              tree: [
                {
                  path: "SKILL.md",
                  type: "blob",
                },
              ],
            }),
          ),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runScopedFindCommand(
      { _: ["skill", "find", "skill"] } as never,
      "skill",
    );

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("acme/frontend-agents@SKILL (42★) (SKILL.md)");
    expect(output).toContain(
      "Install: agentloom skill add acme/frontend-agents",
    );
    expect(output).not.toContain("--skills");
  });

  it("prints empty-result message", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const searchMock = vi.fn<[string, number], Promise<FoundAgent[]>>();
    searchMock.mockResolvedValue([]);

    await runFindCommand({ _: ["find", "unknown"] } as never, searchMock);

    expect(searchMock).toHaveBeenCalledWith("unknown", 8);
    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain('No shared agents found for "unknown".');
  });

  it("prints partial-result warnings when some scans fail", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const searchMock = vi.fn<
      [string, number],
      Promise<{ agents: FoundAgent[]; failures: string[] }>
    >();
    searchMock.mockResolvedValue({
      agents: [
        {
          repo: "acme/frontend-agents",
          agentName: "react-reviewer",
          filePath: "agents/react-reviewer.md",
          fileUrl:
            "https://github.com/acme/frontend-agents/blob/main/agents/react-reviewer.md",
          stars: 42,
        },
      ],
      failures: [
        'acme/failing-repo: Agent search failed with status 403. Response: {"message":"forbidden"}',
      ],
    });

    await runFindCommand(
      { _: ["find", "react", "reviewer"] } as never,
      searchMock,
    );

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      'Found 1 matching agent for "react reviewer" (partial results: 1 repository scan failed):',
    );
    expect(output).toContain("Scan warnings:");
    expect(output).toContain("acme/failing-repo");
  });

  it("fails when diagnostics indicate only partial failures and no matches", async () => {
    const searchMock = vi.fn<
      [string, number],
      Promise<{ agents: FoundAgent[]; failures: string[] }>
    >();
    searchMock.mockResolvedValue({
      agents: [],
      failures: [
        'acme/frontend-agents/agents/react-reviewer.md: Agent search failed with status 403. Response: {"message":"forbidden"}',
      ],
    });

    await expect(
      runFindCommand({ _: ["find", "react", "reviewer"] } as never, searchMock),
    ).rejects.toThrow("Agent search could not complete reliably");
  });

  it("preserves API base path prefixes when searching", async () => {
    const requests: string[] = [];
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      requests.push(`${targetUrl.pathname}${targetUrl.search}`);

      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };
      response.statusCode = 200;

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (targetUrl.pathname.includes("/contents/")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                type: "file",
                encoding: "base64",
                content: encodeBase64(canonicalAgentMarkdown("react-reviewer")),
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              tree: [
                {
                  path: "agents/react-reviewer.md",
                  type: "blob",
                },
              ],
            }),
          ),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    const results = await searchAgents(
      "react reviewer",
      8,
      "https://github.example.com/api/v3",
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      repo: "acme/frontend-agents",
      agentName: "react-reviewer",
      fileUrl:
        "https://github.example.com/acme/frontend-agents/blob/main/agents/react-reviewer.md",
      source: "https://github.example.com/acme/frontend-agents.git",
    });

    const repoSearchRequest = requests.find((url) =>
      url.startsWith("/api/v3/search/repositories"),
    );
    expect(repoSearchRequest).toBeDefined();
    expect(repoSearchRequest).toContain(
      "q=react+reviewer+in%3Aname%2Cdescription%2Creadme",
    );

    const treeRequest = requests.find((url) =>
      url.startsWith("/api/v3/repos/acme/frontend-agents/git/trees/main"),
    );
    expect(treeRequest).toBe(
      "/api/v3/repos/acme/frontend-agents/git/trees/main?recursive=1",
    );

    const contentsRequest = requests.find((url) =>
      url.startsWith(
        "/api/v3/repos/acme/frontend-agents/contents/agents/react-reviewer.md",
      ),
    );
    expect(contentsRequest).toBeDefined();
  });

  it("normalizes .agents agent paths to canonical subdir values", async () => {
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };
      response.statusCode = 200;

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (targetUrl.pathname.includes("/contents/")) {
          const agentName = targetUrl.pathname.includes("security-reviewer")
            ? "security-reviewer"
            : "react-reviewer";
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                type: "file",
                encoding: "base64",
                content: encodeBase64(canonicalAgentMarkdown(agentName)),
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              tree: [
                {
                  path: ".agents/agents/react-reviewer.md",
                  type: "blob",
                },
                {
                  path: "packages/docs/.agents/agents/security-reviewer.md",
                  type: "blob",
                },
              ],
            }),
          ),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    const results = await searchAgents(
      "reviewer",
      8,
      "https://github.example.com/api/v3",
    );
    expect(results).toHaveLength(2);

    const rootMatch = results.find(
      (item) => item.filePath === ".agents/agents/react-reviewer.md",
    );
    const nestedMatch = results.find(
      (item) =>
        item.filePath === "packages/docs/.agents/agents/security-reviewer.md",
    );

    expect(rootMatch?.subdir).toBeUndefined();
    expect(nestedMatch?.subdir).toBe("packages/docs");
  });

  it("filters out non-canonical agent markdown files", async () => {
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };
      response.statusCode = 200;

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (targetUrl.pathname.endsWith("/git/trees/main")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                tree: [
                  {
                    path: "codex-rs/core/templates/agents/orchestrator.md",
                    type: "blob",
                  },
                  {
                    path: "agents/react-reviewer.md",
                    type: "blob",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (
          targetUrl.pathname.includes(
            "/contents/codex-rs/core/templates/agents/orchestrator.md",
          )
        ) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                type: "file",
                encoding: "base64",
                content: encodeBase64("no frontmatter here"),
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              type: "file",
              encoding: "base64",
              content: encodeBase64(canonicalAgentMarkdown("react-reviewer")),
            }),
          ),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    const results = await searchAgents(
      "reviewer",
      8,
      "https://github.example.com/api/v3",
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      agentName: "react-reviewer",
      filePath: "agents/react-reviewer.md",
    });
  });

  it("dedupes same repo+agent match and prefers canonical root paths", async () => {
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };
      response.statusCode = 200;

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (targetUrl.pathname.endsWith("/git/trees/main")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                tree: [
                  {
                    path: ".cursor/agents/react-reviewer.md",
                    type: "blob",
                  },
                  {
                    path: "agents/react-reviewer.md",
                    type: "blob",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              type: "file",
              encoding: "base64",
              content: encodeBase64(canonicalAgentMarkdown("react-reviewer")),
            }),
          ),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    const results = await searchAgents(
      "reviewer",
      8,
      "https://github.example.com/api/v3",
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.filePath).toBe("agents/react-reviewer.md");
    expect(results[0]?.subdir).toBeUndefined();
  });

  it("keeps same repo+agent names when subdirs are different", async () => {
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };
      response.statusCode = 200;

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (targetUrl.pathname.endsWith("/git/trees/main")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                tree: [
                  {
                    path: "pkg-a/agents/reviewer.md",
                    type: "blob",
                  },
                  {
                    path: "pkg-b/agents/reviewer.md",
                    type: "blob",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              type: "file",
              encoding: "base64",
              content: encodeBase64(canonicalAgentMarkdown("reviewer")),
            }),
          ),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    const results = await searchAgents(
      "reviewer",
      8,
      "https://github.example.com/api/v3",
    );

    expect(results).toHaveLength(2);
    expect(results.map((item) => item.filePath).sort()).toEqual([
      "pkg-a/agents/reviewer.md",
      "pkg-b/agents/reviewer.md",
    ]);
    expect(results.map((item) => item.subdir).sort()).toEqual([
      "pkg-a",
      "pkg-b",
    ]);
  });

  it("keeps searching duplicate repo+agent paths until a valid candidate is found", async () => {
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };
      response.statusCode = 200;

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (targetUrl.pathname.endsWith("/git/trees/main")) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                tree: [
                  {
                    path: "agents/react-reviewer.md",
                    type: "blob",
                  },
                  {
                    path: ".agents/agents/react-reviewer.md",
                    type: "blob",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (
          targetUrl.pathname.includes("/contents/agents/react-reviewer.md") &&
          !targetUrl.pathname.includes("/contents/.agents/agents/")
        ) {
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                type: "file",
                encoding: "base64",
                content: encodeBase64("no frontmatter here"),
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              type: "file",
              encoding: "base64",
              content: encodeBase64(canonicalAgentMarkdown("react-reviewer")),
            }),
          ),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    const results = await searchAgents(
      "reviewer",
      8,
      "https://github.example.com/api/v3",
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.filePath).toBe(".agents/agents/react-reviewer.md");
  });

  it("fails when candidate file fetches fail and no installable match remains", async () => {
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.statusCode = 200;
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        if (targetUrl.pathname.endsWith("/git/trees/main")) {
          response.statusCode = 200;
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                tree: [
                  {
                    path: "agents/react-reviewer.md",
                    type: "blob",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.statusCode = 403;
        response.emit(
          "data",
          Buffer.from(JSON.stringify({ message: "forbidden" })),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    await expect(
      searchAgents("reviewer", 8, "https://github.example.com/api/v3"),
    ).rejects.toThrow(/could not validate candidate agents/i);
  });

  it("fails when repo scans error and no matches can be determined", async () => {
    vi.spyOn(https, "get").mockImplementation(((url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (milliseconds: number, handler: () => void) => void;
        destroy: () => void;
      };
      request.setTimeout = (_milliseconds, _handler) => undefined;
      request.destroy = () => undefined;

      const targetUrl = typeof url === "string" ? new URL(url) : url;
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
      };

      queueMicrotask(() => {
        callback(response as never);

        if (targetUrl.pathname.endsWith("/search/repositories")) {
          response.statusCode = 200;
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                items: [
                  {
                    full_name: "acme/frontend-agents",
                    stargazers_count: 42,
                    default_branch: "main",
                  },
                ],
              }),
            ),
          );
          response.emit("end");
          return;
        }

        response.statusCode = 403;
        response.emit(
          "data",
          Buffer.from(JSON.stringify({ message: "forbidden" })),
        );
        response.emit("end");
      });

      return request as never;
    }) as typeof https.get);

    await expect(
      searchAgents("react reviewer", 8, "https://github.example.com/api/v3"),
    ).rejects.toThrow(
      /could not complete repository scans[\s\S]*acme\/frontend-agents/,
    );
  });
});
