// The read cache and writes (2026-10-01): a read that overlaps a write on
// its topic is served but never kept, and a write drops the cache both
// as it starts and as it lands.
import { describe, expect, it } from "vitest";
import { bumpChange, changeVersion, memoRead, writing } from "../store/changes";

const tick = () => new Promise((r) => setTimeout(r, 0));
let n = 0;
const topic = () => `t${++n}`;

describe("memoRead with writes", () => {
  it("keeps a read made while nothing is being written", async () => {
    const t = topic();
    let loads = 0;
    await memoRead(t, "k", async () => ++loads);
    await memoRead(t, "k", async () => ++loads);
    expect(loads).toBe(1);
  });
  it("never keeps a read that starts while a write travels", async () => {
    const t = topic();
    let release: () => void = () => undefined;
    const write = writing(t, new Promise<void>((r) => (release = r)));
    let loads = 0;
    // the write is in flight: this read may see the row as it was
    await memoRead(t, "k", async () => ++loads);
    await memoRead(t, "k", async () => ++loads);
    expect(loads).toBe(2);
    release();
    await write;
    await tick();
    // the write landed: the next read is fresh, and kept
    await memoRead(t, "k", async () => ++loads);
    await memoRead(t, "k", async () => ++loads);
    expect(loads).toBe(3);
  });
  it("drops a read that was travelling when a write started", async () => {
    const t = topic();
    let loads = 0;
    let finish: (v: number) => void = () => undefined;
    const slow = memoRead(t, "k", () => new Promise<number>((r) => (finish = r)).then((v) => (loads++, v)));
    bumpChange(t); // a write begins while the read is out
    finish(1);
    await slow;
    await tick();
    await memoRead(t, "k", async () => ++loads);
    expect(loads).toBe(2);
  });
  it("a write bumps the version as it starts and as it lands, even on failure", async () => {
    const t = topic();
    const before = changeVersion(t);
    const p = writing(t, Promise.reject(new Error("no")));
    expect(changeVersion(t)).toBe(before + 1);
    await p.catch(() => undefined);
    await tick();
    expect(changeVersion(t)).toBe(before + 2);
    // and the topic is no longer "writing": reads are kept again
    let loads = 0;
    await memoRead(t, "k", async () => ++loads);
    await memoRead(t, "k", async () => ++loads);
    expect(loads).toBe(1);
  });
});
