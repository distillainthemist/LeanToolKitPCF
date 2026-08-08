import { beforeEach, describe, expect, it } from "vitest";
import { readTaskCount, rememberTaskCount } from "../taskBadge";

// the app runs in a browser; the suite does not — a Map-backed stand-in
// is enough for storage semantics
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe("the Documents tab badge's memory", () => {
  it("remembers this viewer's count and reads it back", () => {
    rememberTaskCount("ben", 3);
    expect(readTaskCount("ben")).toBe(3);
  });

  it("never shows one person's tasks to another", () => {
    rememberTaskCount("ben", 3);
    expect(readTaskCount("marketing")).toBe(0);
  });

  it("forgets a count that has aged out", () => {
    store.set(
      "ltk-doctasks",
      JSON.stringify({ who: "ben", n: 4, when: Date.now() - 8 * 24 * 60 * 60 * 1000 })
    );
    expect(readTaskCount("ben")).toBe(0);
  });

  it("says nothing rather than zero — a badge of 0 is noise", () => {
    rememberTaskCount("ben", 0);
    expect(readTaskCount("ben")).toBe(0);
  });

  it("survives unusable storage and malformed records", () => {
    store.set("ltk-doctasks", "not json");
    expect(readTaskCount("ben")).toBe(0);
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => rememberTaskCount("ben", 2)).not.toThrow();
    expect(readTaskCount("ben")).toBe(0);
  });

  it("ignores an anonymous viewer entirely", () => {
    rememberTaskCount("", 5);
    expect(store.size).toBe(0);
    expect(readTaskCount("")).toBe(0);
  });
});
