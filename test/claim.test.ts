import { describe, expect, it, vi, afterEach } from "vitest";
import {
  parseNextFreeGemsFromJsonBody,
  tryClaimAsync,
  tryParseRemainingMs,
  tryParseSvelteKitAction,
} from "../src/claim";

describe("tryParseSvelteKitAction", () => {
  it("parses already claimed 409", () => {
    const json = JSON.stringify({
      type: "failure",
      status: 409,
      data: `[{"message":1},"You've already claimed your free gems for today!"]`,
    });
    const parsed = tryParseSvelteKitAction(json);
    expect(parsed.ok).toBe(true);
    expect(parsed.type).toBe("failure");
    expect(parsed.status).toBe(409);
    expect(parsed.message).toBe("You've already claimed your free gems for today!");
  });

  it("parses unauthorized 401", () => {
    const json = JSON.stringify({
      type: "failure",
      status: 401,
      data: `[{"message":1},"Sign in to claim your free gems."]`,
    });
    const parsed = tryParseSvelteKitAction(json);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe(401);
    expect(parsed.message).toContain("Sign in");
  });

  it("parses forbidden 403", () => {
    const json = JSON.stringify({
      type: "failure",
      status: 403,
      data: `[{"message":1},"Forbidden"]`,
    });
    const parsed = tryParseSvelteKitAction(json);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe(403);
  });
});

describe("tryParseRemainingMs", () => {
  it("resolves devalue index when canClaim value sits between (current unlucid shape)", () => {
    const json = JSON.stringify({
      type: "data",
      nodes: [
        { type: "data", data: [{ user: 1 }, "x"] },
        { type: "data", data: [{ freeGems: 1 }, { canClaim: 2, remainingMs: 3 }, false, 1235056] },
      ],
    });
    expect(tryParseRemainingMs(json)).toEqual({ ok: true, remainingMs: 1235056 });
  });

  it("reads countdown from gems data json", () => {
    const json =
      '{"type":"data","nodes":[{"type":"data","data":[{"dailyFreeGems":80},{"amount":81,"claim":82},5,{"canClaim":7,"remainingMs":83},85769485],"uses":{}}]}';
    const parsed = tryParseRemainingMs(json);
    expect(parsed.ok).toBe(true);
    expect(parsed.remainingMs).toBe(85769485);
  });
});

describe("parseNextFreeGemsFromJsonBody", () => {
  it("reads user.nextFreeGemsAt ms", () => {
    const ms = Date.now() + 3600_000;
    const iso = parseNextFreeGemsFromJsonBody(JSON.stringify({ user: { nextFreeGemsAt: ms } }));
    expect(iso).toBe(new Date(ms).toISOString());
  });
});

describe("tryClaimAsync HTTP handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns auth failure on sveltekit 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ type: "failure", status: 401, data: '"Sign in"' }), { status: 200 })),
    );
    const result = await tryClaimAsync("session=abc");
    expect(result.authFailure).toBe(true);
    expect(result.error).toContain("HTTP 401");
  });

  it("syncs next time on sveltekit 409 when gems data returns remainingMs", async () => {
    const gemsJson =
      '{"type":"data","nodes":[{"type":"data","data":[{"canClaim":7,"remainingMs":83},3600000],"uses":{}}]}';
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("__data.json")) {
        return new Response(gemsJson, { status: 200 });
      }
      return new Response(
        JSON.stringify({
          type: "failure",
          status: 409,
          data: `[{"message":1},"Already claimed"]`,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await tryClaimAsync("session=abc");
    expect(result.authFailure).toBe(false);
    expect(result.nextFreeGemsAtUtc).not.toBeNull();
    expect(result.error).toContain("Already claimed");
  });
});