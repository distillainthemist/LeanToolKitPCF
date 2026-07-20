// The card save envelope: the tile svg arrives AFTER the change event
// (editors snapshot post-render), and the final snapshot must never be
// lost to the debounce (the standard-content tile lagged one edit).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saver } from "../../cardRegistry";

describe("saver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("re-saves when the snapshot lands after the debounced save", () => {
    const saves: Array<[string, string]> = [];
    const s = saver({ onSave: (json, svg) => saves.push([json, svg]) });

    s.save('{"v":1}');
    s.onPng("", "<svg>1</svg>");
    vi.advanceTimersByTime(500);
    expect(saves).toEqual([['{"v":1}', "<svg>1</svg>"]]);

    // the edit Ben loses: change fires, save debounce elapses, THEN the
    // fresh snapshot arrives
    s.save('{"v":2}');
    vi.advanceTimersByTime(500); // save fired with the stale svg
    expect(saves[saves.length - 1]).toEqual(['{"v":2}', "<svg>1</svg>"]);
    s.onPng("", "<svg>2</svg>"); // late snapshot must reschedule
    vi.advanceTimersByTime(500);
    expect(saves[saves.length - 1]).toEqual(['{"v":2}', "<svg>2</svg>"]);
  });

  it("does not save from a mount-time snapshot before any change", () => {
    const saves: string[] = [];
    const s = saver({ onSave: (json) => saves.push(json) });
    s.onPng("", "<svg>initial</svg>");
    vi.advanceTimersByTime(1000);
    expect(saves).toEqual([]);
  });
});
