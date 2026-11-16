import { describe, expect, it } from "vitest";
import { tryParseRemainingMs, tryParseSvelteKitAction } from "../src/claim";

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
});

describe("tryParseRemainingMs", () => {
  it("reads countdown from gems data json", () => {
    const json =
      '{"type":"data","nodes":[{"type":"data","data":[{"dailyFreeGems":80},{"amount":81,"claim":82},5,{"canClaim":7,"remainingMs":83},85769485],"uses":{}}]}';
    const parsed = tryParseRemainingMs(json);
    expect(parsed.ok).toBe(true);
    expect(parsed.remainingMs).toBe(85769485);
  });
});