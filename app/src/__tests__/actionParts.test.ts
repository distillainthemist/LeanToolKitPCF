import { describe, expect, it } from "vitest";
import { newAction, settleFromParts } from "../../../shared/schema/actions";

const act = (parts: boolean[], status: "open" | "done" | "verify" | "cancelled" = "open") => {
  const a = newAction({ source: "card", sourceId: "" });
  a.status = status;
  a.pdca = status === "done" ? "closed" : "do";
  a.assignees = parts.map((done, i) => ({ whoId: `u${i}`, who: `P${i}`, done }));
  return a;
};

describe("settleFromParts — the parts and the whole agree", () => {
  it("the last part done closes the action", () => {
    const a = act([true]);
    expect(settleFromParts(a, { reopen: true })).toBe(true);
    expect(a.status).toBe("done");
    expect(a.pdca).toBe("closed");
  });
  it("one part of several leaves it open", () => {
    const a = act([true, false]);
    expect(settleFromParts(a, { reopen: true })).toBe(false);
    expect(a.status).toBe("open");
  });
  it("a part undone reopens only when asked (the store never reopens)", () => {
    const a = act([false, true], "done");
    expect(settleFromParts(a, { reopen: false })).toBe(false);
    expect(a.status).toBe("done");
    expect(settleFromParts(a, { reopen: true })).toBe(true);
    expect(a.status).toBe("open");
    expect(a.pdca).toBe("do");
  });
  it("leaves waiting, cancelled and unassigned actions alone", () => {
    const waiting = act([true], "verify");
    expect(settleFromParts(waiting, { reopen: false })).toBe(false);
    expect(waiting.status).toBe("verify");
    const cancelled = act([true], "cancelled");
    expect(settleFromParts(cancelled, { reopen: true })).toBe(false);
    const none = act([]);
    expect(settleFromParts(none, { reopen: true })).toBe(false);
  });
});
