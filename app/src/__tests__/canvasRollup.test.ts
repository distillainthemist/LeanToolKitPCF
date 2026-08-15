// CanvasRollup pure model — field matching by label (headings excluded),
// the label union, the transposed projection and the field write-back.

import { describe, expect, it } from "vitest";
import { parseCanvasConfig } from "../../../controls/CanvasCard/types";
import {
  canvasLabelUnion,
  matchCanvasFields,
  mutateCanvasValueJson,
  parseCanvasWriteMode,
  projectCanvasRollup,
  ResolvedCanvasSource,
} from "../../../controls/CanvasRollup/types";

const CONFIG_A = parseCanvasConfig(
  JSON.stringify({
    cols: 2,
    fields: [
      { id: "h", label: "Status", type: "heading" },
      { id: "rag", label: "Status", type: "status" },
      { id: "sponsor", label: "Sponsor", type: "person" },
      { id: "pct", label: "% complete", type: "percent" },
    ],
  })
);

const CONFIG_B = parseCanvasConfig(
  JSON.stringify({
    fields: [
      { id: "state", label: "status", type: "status" }, // same label, different id
      { id: "owner", label: "Owner", type: "person" },
    ],
  })
);

function source(over: Partial<ResolvedCanvasSource>): ResolvedCanvasSource {
  return {
    boardId: "b1",
    cardId: "c1",
    boardName: "Packing",
    cardTitle: "Line 1 charter",
    config: CONFIG_A,
    doc: {
      rowGuid: "g1",
      when: "",
      envelope: {
        schema: "ltk/canvas@1",
        meta: { title: "", updated: "" },
        data: { values: { rag: "good", pct: 60 } },
      },
    },
    ...over,
  };
}

describe("canvas rollup matching", () => {
  it("matches by label case-insensitively; headings never match", () => {
    const matched = matchCanvasFields(CONFIG_A.fields, ["status", "Sponsor", "Missing"]);
    // the heading is ALSO labelled "Status" — the status FIELD must win
    expect(matched[0]?.id).toBe("rag");
    expect(matched[1]?.id).toBe("sponsor");
    expect(matched[2]).toBeNull();
  });

  it("label union spans sources, dedupes case-insensitively, skips headings", () => {
    const union = canvasLabelUnion([
      source({}),
      source({ boardId: "b2", config: CONFIG_B }),
    ]);
    expect(union).toEqual(["Status", "Sponsor", "% complete", "Owner"]);
  });

  it("write mode: full or readonly, nothing else", () => {
    expect(parseCanvasWriteMode("full")).toBe("full");
    expect(parseCanvasWriteMode("unflag")).toBe("readonly");
    expect(parseCanvasWriteMode("")).toBe("readonly");
  });
});

describe("projectCanvasRollup", () => {
  it("one row per source; each resolves the same label to ITS OWN field", () => {
    const rows = projectCanvasRollup(
      [
        source({}),
        source({
          boardId: "b2",
          boardName: "Filling",
          cardTitle: "Line 2 charter",
          config: CONFIG_B,
          doc: {
            rowGuid: "g2",
            when: "2026-08-14T09:00",
            envelope: {
              schema: "ltk/canvas@1",
              meta: { title: "", updated: "" },
              data: { values: { state: "risk" } },
            },
          },
        }),
      ],
      ["Status"]
    );
    expect(rows.length).toBe(2);
    expect(rows[0].fields[0]?.id).toBe("rag");
    expect(rows[0].values[rows[0].fields[0]!.id]).toBe("good");
    expect(rows[1].fields[0]?.id).toBe("state");
    expect(rows[1].values[rows[1].fields[0]!.id]).toBe("risk");
    expect(rows[1].ref.docRowGuid).toBe("g2");
  });

  it("skips errored sources and charters with no content", () => {
    const rows = projectCanvasRollup(
      [
        source({ error: "The source board no longer exists." }),
        source({ boardId: "b2", doc: null }),
        source({ boardId: "b3" }),
      ],
      ["Status"]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].source.boardId).toBe("b3");
  });
});

describe("mutateCanvasValueJson", () => {
  const json = JSON.stringify({
    schema: "ltk/canvas@1",
    meta: { title: "", updated: "" },
    data: { values: { rag: "good", pct: 60 } },
  });

  it("sets one field, stamps updated, leaves the rest untouched", () => {
    const next = JSON.parse(
      mutateCanvasValueJson(json, "rag", "risk", "2026-08-15T12:00:00Z")
    ) as { meta: { updated: string }; data: { values: Record<string, unknown> } };
    expect(next.data.values.rag).toBe("risk");
    expect(next.data.values.pct).toBe(60);
    expect(next.meta.updated).toBe("2026-08-15T12:00:00Z");
  });

  it("clears with undefined; an unknown field id is a legal orphan write", () => {
    const cleared = JSON.parse(mutateCanvasValueJson(json, "rag", undefined, "2026-08-15")) as {
      data: { values: Record<string, unknown> };
    };
    expect("rag" in cleared.data.values).toBe(false);
    const orphan = JSON.parse(mutateCanvasValueJson(json, "brand_new", 5, "2026-08-15")) as {
      data: { values: Record<string, unknown> };
    };
    expect(orphan.data.values.brand_new).toBe(5);
  });
});
