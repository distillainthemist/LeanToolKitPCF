// CaptureRollup pure model — config parsers, the occurrence-window document
// choice, label-based column matching and the merge projection.

import { describe, expect, it } from "vitest";
import type {
  CaptureColumn,
  CaptureEnvelope,
  CaptureRow,
} from "../../../controls/CaptureCard/types";
import {
  flagColumn,
  isFlagged,
  matchColumns,
  mutateCaptureRowJson,
  parseColumnNames,
  parseRollup,
  parseRollupSources,
  parseWindow,
  parseWriteMode,
  pickWindowDocs,
  projectRollup,
  ResolvedRollupSource,
  serializeRollup,
  SourceDoc,
} from "../../../controls/CaptureRollup/types";

function col(key: string, label: string, type: CaptureColumn["type"] = "text"): CaptureColumn {
  return { key, label, type, multi: false, parent: "", options: [] };
}

function row(id: string, cells: CaptureRow["cells"]): CaptureRow {
  return { id, rowKey: "", cells };
}

function env(rows: CaptureRow[]): CaptureEnvelope {
  return { schema: "ltk/capture@1", meta: { title: "", updated: "" }, data: { rows } };
}

function source(over: Partial<ResolvedRollupSource>): ResolvedRollupSource {
  return {
    boardId: "b1",
    cardId: "c1",
    boardName: "Packing",
    cardTitle: "Issues",
    columns: [col("issue", "Issue"), col("esc", "Escalate", "flag")],
    docs: [],
    ...over,
  };
}

describe("rollup config parsers", () => {
  it("sources: valid pairs survive, junk is dropped", () => {
    expect(
      parseRollupSources(
        JSON.stringify([
          { boardId: "b1", cardId: "c1" },
          { boardId: "", cardId: "c2" },
          { boardId: "b3" },
          "junk",
          { boardId: " b4 ", cardId: " c4 " },
        ])
      )
    ).toEqual([
      { boardId: "b1", cardId: "c1" },
      { boardId: "b4", cardId: "c4" },
    ]);
    expect(parseRollupSources("")).toEqual([]);
    expect(parseRollupSources("not json")).toEqual([]);
  });

  it("column names: JSON array, CSV fallback, case-insensitive dedupe", () => {
    expect(parseColumnNames('["Issue","Owner"]')).toEqual(["Issue", "Owner"]);
    expect(parseColumnNames("Issue, Owner , issue")).toEqual(["Issue", "Owner"]);
    expect(parseColumnNames('["Issue","issue",""]')).toEqual(["Issue"]);
    expect(parseColumnNames("")).toEqual([]);
  });

  it("window: defaults to current, lastN clamps n", () => {
    expect(parseWindow("", null)).toEqual({ mode: "current", n: 3 });
    expect(parseWindow("lastN", 5)).toEqual({ mode: "lastN", n: 5 });
    expect(parseWindow("lastN", 0)).toEqual({ mode: "lastN", n: 1 });
    expect(parseWindow("lastN", 999)).toEqual({ mode: "lastN", n: 50 });
    expect(parseWindow("bogus", 2)).toEqual({ mode: "current", n: 2 });
  });

  it("write mode defaults to readonly", () => {
    expect(parseWriteMode("")).toBe("readonly");
    expect(parseWriteMode("unflag")).toBe("unflag");
    expect(parseWriteMode("full")).toBe("full");
    expect(parseWriteMode("anything")).toBe("readonly");
  });

  it("the rollup's own envelope is minimal and round-trips", () => {
    const parsed = parseRollup("").envelope;
    expect(parsed.schema).toBe("ltk/capturerollup@1");
    expect(parsed.data).toEqual({});
    expect(JSON.parse(serializeRollup(parsed)).data).toEqual({});
  });
});

describe("pickWindowDocs", () => {
  const live: SourceDoc = { rowGuid: "g-live", when: "", json: '{"x":1}' };
  const inst = (guid: string, when: string, json: string): SourceDoc => ({
    rowGuid: guid,
    when,
    json,
  });
  const docs = [
    inst("g3", "2026-08-14T09:00", '{"c":3}'),
    inst("g2", "2026-08-07T09:00", ""),
    inst("g1", "2026-07-31T09:00", '{"a":1}'),
  ];

  it("shared sources read the live row only", () => {
    expect(pickWindowDocs("shared", live, docs, { mode: "lastN", n: 5 })).toEqual([live]);
    expect(pickWindowDocs("shared", null, docs, { mode: "current", n: 3 })).toEqual([]);
  });

  it("current takes the newest non-empty instance document", () => {
    expect(pickWindowDocs("carry", live, docs, { mode: "current", n: 3 }).map((d) => d.rowGuid)).toEqual(["g3"]);
  });

  it("lastN takes the newest N non-empty, skipping blanks", () => {
    expect(pickWindowDocs("clear", live, docs, { mode: "lastN", n: 2 }).map((d) => d.rowGuid)).toEqual(["g3", "g1"]);
  });

  it("no meeting content yet falls back to the live document", () => {
    expect(pickWindowDocs("carry", live, [inst("g9", "2026-08-14", "")], { mode: "current", n: 3 })).toEqual([live]);
    expect(pickWindowDocs("carry", null, [], { mode: "current", n: 3 })).toEqual([]);
  });
});

describe("column matching", () => {
  it("matches by label, case-insensitive and trimmed; missing is null", () => {
    const cols = [col("issue", "Issue"), col("who", " Owner ")];
    expect(matchColumns(cols, ["issue", "OWNER", "Count"])).toEqual([cols[0], cols[1], null]);
  });

  it("finds the flag column by type regardless of its label", () => {
    const cols = [col("issue", "Issue"), col("esc", "Escalate", "flag")];
    expect(flagColumn(cols)?.key).toBe("esc");
    expect(flagColumn([col("issue", "Flag")])).toBeNull();
  });

  it("isFlagged uses the editor's truthiness", () => {
    expect(isFlagged(row("r1", { esc: true }), "esc")).toBe(true);
    expect(isFlagged(row("r1", { esc: "true" }), "esc")).toBe(true);
    expect(isFlagged(row("r1", { esc: false }), "esc")).toBe(false);
    expect(isFlagged(row("r1", { esc: true }), "")).toBe(false);
  });
});

describe("projectRollup", () => {
  it("merges sources in order, newest occurrence wins on duplicate row ids", () => {
    const s1 = source({
      boardName: "Packing",
      docs: [
        {
          rowGuid: "g2",
          when: "2026-08-14T09:00",
          envelope: env([row("r1", { issue: "Jam", esc: true }), row("r2", { issue: "Leak" })]),
        },
        {
          rowGuid: "g1",
          when: "2026-08-07T09:00",
          // r1 carried from last week (older cells) + r0 deleted since
          envelope: env([row("r1", { issue: "Jam OLD" }), row("r0", { issue: "Gone" })]),
        },
      ],
    });
    const rows = projectRollup([s1], ["Issue"], false);
    expect(rows.map((r) => r.ref.rowId)).toEqual(["r1", "r2", "r0"]);
    // r1 came from the NEWEST document — cells and write target follow it
    expect(rows[0].row.cells.issue).toBe("Jam");
    expect(rows[0].ref.docRowGuid).toBe("g2");
    expect(rows[2].ref.docRowGuid).toBe("g1");
    expect(rows[0].flagged).toBe(true);
    expect(rows[1].flagged).toBe(false);
  });

  it("resolves each source's own key for the same label", () => {
    const s1 = source({
      docs: [{ rowGuid: "g1", when: "", envelope: env([row("r1", { issue: "A" })]) }],
    });
    const s2 = source({
      boardId: "b2",
      boardName: "Filling",
      columns: [col("problem_seen", "Issue")], // same label, different key
      docs: [{ rowGuid: "g2", when: "", envelope: env([row("r2", { problem_seen: "B" })]) }],
    });
    const rows = projectRollup([s1, s2], ["Issue"], false);
    expect(rows[0].columns[0]?.key).toBe("issue");
    expect(rows[1].columns[0]?.key).toBe("problem_seen");
    expect(rows[1].row.cells[rows[1].columns[0]!.key]).toBe("B");
  });

  it("flagged-only keeps flagged rows and hides flag-less sources entirely", () => {
    const flagged = source({
      docs: [
        {
          rowGuid: "g1",
          when: "",
          envelope: env([row("r1", { issue: "A", esc: true }), row("r2", { issue: "B" })]),
        },
      ],
    });
    const noFlagCol = source({
      boardId: "b2",
      columns: [col("issue", "Issue")],
      docs: [{ rowGuid: "g2", when: "", envelope: env([row("r3", { issue: "C" })]) }],
    });
    const rows = projectRollup([flagged, noFlagCol], ["Issue"], true);
    expect(rows.map((r) => r.ref.rowId)).toEqual(["r1"]);
    // filter off: the flag-less source's rows return
    expect(projectRollup([flagged, noFlagCol], ["Issue"], false).length).toBe(3);
  });

  it("write-back mutates one row in a fresh document and stamps updated", () => {
    const json = JSON.stringify(env([row("r1", { issue: "Jam", esc: true }), row("r2", { issue: "Leak" })]));
    const next = mutateCaptureRowJson(json, "r1", (r) => (r.cells.esc = false), "2026-08-15T10:00:00Z");
    expect(next).not.toBeNull();
    const parsed = JSON.parse(next!) as { meta: { updated: string }; data: { rows: CaptureRow[] } };
    expect(parsed.meta.updated).toBe("2026-08-15T10:00:00Z");
    expect(parsed.data.rows.find((r) => r.id === "r1")?.cells.esc).toBe(false);
    // the untouched row survives byte-for-byte
    expect(parsed.data.rows.find((r) => r.id === "r2")?.cells).toEqual({ issue: "Leak" });
  });

  it("write-back refuses when the row has been edited away", () => {
    const json = JSON.stringify(env([row("r2", { issue: "Leak" })]));
    expect(mutateCaptureRowJson(json, "r1", (r) => (r.cells.esc = false), "2026-08-15")).toBeNull();
  });

  it("errored sources are skipped", () => {
    const bad = source({ error: "The board no longer exists.", docs: [] });
    const good = source({
      boardId: "b2",
      docs: [{ rowGuid: "g1", when: "", envelope: env([row("r1", { issue: "A" })]) }],
    });
    expect(projectRollup([bad, good], ["Issue"], false).length).toBe(1);
  });
});
