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

const SETTERS = [
  "setPeople",
  "setDisableActions",
  "setOptions",
  "setReadOnly",
  "setUnit",
  "setQuadrantLabels",
];

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

// ---- persistent embed frames ----
//
// The same class of bug, one level up: EmbedCard yields its iframe whenever
// the host passes onEmbedFrame, and BOTH screens that mount cards must pass
// it. The board did and the card editor did not — so an embed preloaded
// warm on the wall built a second, cold iframe the moment it was opened,
// repeating the Power BI autoAuth handshake. Nothing failed; it was just
// slow, and the import sat in the file unused because the app's tsconfig
// deliberately leaves noUnusedLocals off.

import boardSrc from "../screens/board.ts?raw";
import cardEditorSrc from "../screens/cardEditor.ts?raw";

describe("persistent embed frames are wired on every screen that mounts cards", () => {
  const screens: [string, string][] = [
    ["board", boardSrc],
    ["cardEditor", cardEditorSrc],
  ];

  for (const [name, src] of screens) {
    it(`${name} passes onEmbedFrame`, () => {
      expect(src).toContain("onEmbedFrame:");
    });

    it(`${name} acquires and places under a frameKey`, () => {
      expect(src).toContain("acquireFrame(");
      expect(src).toContain("placeFrame(");
      expect(src).toContain("frameKey(");
    });
  }

  it("the EmbedCard mounter only yields its frame when the host asks", () => {
    // without the hook the card must keep loading its own iframe, so a
    // screen that has not been wired still works (just not warm)
    expect(mounterBodies().EmbedCard).toContain("opts.onEmbedFrame");
  });
});

// ---- site state palette ----
//
// palette is OPTIONAL on CardMount (display-only harnesses default to the
// toolkit palette), which makes forgetting it silent: a screen that skips
// it renders default colours instead of the site's. Every screen that
// mounts real cards must pass it.

import composerSrc from "../screens/composer.ts?raw";

describe("the state palette reaches every real mount", () => {
  const screens: [string, string][] = [
    ["board", boardSrc],
    ["cardEditor", cardEditorSrc],
    ["composer", composerSrc],
  ];
  for (const [name, src] of screens) {
    it(`${name} loads the state palette and passes it to mounts`, () => {
      expect(src).toContain("appPalettes(");
      expect(src).toMatch(/palette(?::| ?[,}])/);
    });
  }

  it("the palette-consuming mounters resolve through it", () => {
    const bodies = mounterBodies();
    for (const card of ["StatusTile", "SqdpcCard", "ConditionsCard"]) {
      expect(bodies[card], card).toContain("resolvePaletteColor(");
    }
  });
});
