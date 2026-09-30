// Writes in flight and the flushable saver (2026-10-01): a screen that
// mounts after an edit reads AFTER the edit's write lands, and leaving
// the card view writes the last edit at once.
import { describe, expect, it } from "vitest";
import { inflightCount, track, whenSettled } from "../store/inflight";
import { flushPendingSaves, saver } from "../saver";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("inflight", () => {
  it("whenSettled waits for a tracked write, and for one that starts meanwhile", async () => {
    let done1 = false;
    let done2 = false;
    let release1: () => void = () => undefined;
    const w1 = new Promise<void>((r) => (release1 = r)).then(() => (done1 = true));
    track(w1);
    let release2: () => void = () => undefined;
    const settled = whenSettled().then(() => [done1, done2]);
    // a second write joins while the first is still travelling
    const w2 = new Promise<void>((r) => (release2 = r)).then(() => (done2 = true));
    track(w2);
    release1();
    await tick();
    release2();
    expect(await settled).toEqual([true, true]);
    expect(inflightCount()).toBe(0);
  });
  it("a failed write still clears; whenSettled never rejects", async () => {
    const w = Promise.reject(new Error("no"));
    track(w).catch(() => undefined);
    await expect(whenSettled()).resolves.toBeUndefined();
    expect(inflightCount()).toBe(0);
  });
  it("resolves at once when nothing is travelling", async () => {
    await expect(whenSettled()).resolves.toBeUndefined();
  });
});

describe("saver", () => {
  it("debounces, and a flush writes the latest document at once", () => {
    const writes: string[] = [];
    const s = saver({ onSave: (json) => writes.push(json) });
    s.save("v1");
    s.save("v2");
    expect(writes).toEqual([]);
    flushPendingSaves();
    expect(writes).toEqual(["v2"]);
    // flushed: nothing is pending, a second flush writes nothing
    flushPendingSaves();
    expect(writes).toEqual(["v2"]);
  });
  it("a flush with nothing saved writes nothing", () => {
    const writes: string[] = [];
    saver({ onSave: (json) => writes.push(json) });
    flushPendingSaves();
    expect(writes).toEqual([]);
  });
  it("carries the latest snapshot with the write", () => {
    const writes: [string, string][] = [];
    const s = saver({ onSave: (json, svg) => writes.push([json, svg]) });
    s.save("doc");
    s.onSnapshot("<svg/>");
    s.flush();
    expect(writes).toEqual([["doc", "<svg/>"]]);
  });
});
