// Guard against the "silently ignored setting" class of bug: an editor
// supports a capability (setPeople / setDisableActions / setOptions /
// setReadOnly) but its app mounter never calls it, so the setting appears
// in the UI and does nothing. This audit found five such cases at once
// (Fishbone stayed editable in closed meetings; Winning conditions and
// Five whys lost the assignee roster and their disable-actions toggle).
//
// Sources are read through Vite's ?raw imports rather than node's fs so
// the app's tsconfig can keep its browser-only `types`.

import { describe, expect, it } from "vitest";
import registrySrc from "../cardRegistry.ts?raw";

const editorSources = import.meta.glob("../../../controls/*/editor.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Each mounter's body, keyed by card type. */
function mounterBodies(): Record<string, string> {
  const parts = registrySrc.split(/\n {2}(\w+): \(opts\) => \{/);
  const out: Record<string, string> = {};
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}

function editorFor(card: string): string | undefined {
  const hit = Object.entries(editorSources).find(([path]) =>
    path.endsWith(`/${card}/editor.ts`)
  );
  return hit?.[1];
}

const SETTERS = ["setPeople", "setDisableActions", "setOptions", "setReadOnly"];

describe("card mounters apply what their editors support", () => {
  const bodies = mounterBodies();

  it("finds the mounters and the editor sources (guards the parser)", () => {
    expect(Object.keys(bodies).length).toBeGreaterThan(15);
    expect(bodies).toHaveProperty("SqdpcCard");
    expect(Object.keys(editorSources).length).toBeGreaterThan(15);
  });

  for (const [card, body] of Object.entries(bodies)) {
    const src = editorFor(card);
    if (src === undefined) continue;
    for (const setter of SETTERS) {
      if (!new RegExp(`\\b${setter}\\s*\\(`).test(src)) continue;
      it(`${card} calls ${setter}`, () => {
        expect(body).toContain(`.${setter}(`);
      });
    }
  }
});
