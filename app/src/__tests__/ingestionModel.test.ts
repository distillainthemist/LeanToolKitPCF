// Document ingestion's pure parts (ingestionModel.ts, 2026-10-08).
import { describe, expect, it } from "vitest";
import { blanksToFill, canSeeTask, ingestComment, latestByFile, logSummary, missingFor, rowFromTask, taskFolderName, taskFromRow, tasksForPanel, IngestionTask } from "../docs/ingestionModel";

const task = (over: Partial<IngestionTask> = {}): IngestionTask => ({
  rowId: "r1", name: "Legacy SOPs", siteUrl: "https://x.sharepoint.com/sites/Dev", sourceListId: "src", folder: "/sites/Dev/Ingest/Legacy SOPs", destListId: "dst",
  status: "open", assignees: [{ email: "ann@x.test", name: "Ann" }], defaults: [], log: [], createdByEmail: "ben@x.test", createdByName: "Ben", createdAt: "2026-10-08T01:00:00Z", closedAt: "", ...over,
});

describe("taskFromRow / rowFromTask", () => {
  it("round-trips through the row shape and tolerates rubbish JSON", () => {
    const t = task({ defaults: [{ internal: "DMSOrganisation", kind: "taxonomy", label: "Pechey", termId: "t1" }], log: [{ file: "a.pdf", outcome: "moved", detail: "/sites/Dev/Std/a.pdf", at: "2026-10-08T02:00:00Z", by: "Ben" }] });
    const back = taskFromRow({ ...rowFromTask(t), ben_ltkingestiontaskid: "r1" });
    expect(back).toEqual(t);
    const bad = taskFromRow({ ben_name: "x", ben_assigneesjson: "{not json", ben_logjson: "[1,2]", ben_status: "weird", ben_sourcelistid: "ABC" });
    expect(bad.assignees).toEqual([]);
    expect(bad.log).toEqual([]);
    expect(bad.status).toBe("open");
    expect(bad.sourceListId).toBe("abc");
  });
});

describe("taskFolderName", () => {
  it("strips the characters SharePoint refuses", () => {
    expect(taskFolderName('  Q3: "legacy" / SOPs?  ')).toBe("Q3 legacy SOPs");
  });
});

describe("canSeeTask / tasksForPanel", () => {
  it("shows a task to its assignees, its creator and every controller; hides closed ones", () => {
    const t = task();
    expect(canSeeTask(t, "ANN@x.test", false)).toBe(true);
    expect(canSeeTask(t, "ben@x.test", false)).toBe(true);
    expect(canSeeTask(t, "sam@x.test", false)).toBe(false);
    expect(canSeeTask(t, "sam@x.test", true)).toBe(true);
    expect(canSeeTask(t, "", false)).toBe(false);
    const list = tasksForPanel([task({ rowId: "old", createdAt: "2026-01-01" }), task({ rowId: "closed", status: "closed" }), task({ rowId: "new", createdAt: "2026-10-08" })], "ann@x.test", false);
    expect(list.map((x) => x.rowId)).toEqual(["new", "old"]);
  });
});

describe("missingFor / blanksToFill", () => {
  it("names the blank required columns and fills only blanks from defaults", () => {
    const req = [{ internal: "DMSOwner", label: "Owner" }, { internal: "DMSDocType", label: "Document type" }];
    expect(missingFor({ DMSOwner: "Ann" }, req)).toEqual(["Document type"]);
    expect(missingFor({ DMSOwner: "Ann", DMSDocType: "SOP" }, req)).toEqual([]);
    const org = { internal: "DMSOrganisation", kind: "taxonomy" as const, label: "Pechey", termId: "t1" };
    const type = { internal: "DMSDocType", kind: "choice" as const, text: "Policy" };
    expect(blanksToFill({ DMSOrganisation: "", DMSDocType: "SOP" }, [org, type])).toEqual([org]);
  });
});

describe("log helpers", () => {
  it("summarises and keeps the latest outcome per file", () => {
    const log = [
      { file: "a.pdf", outcome: "refused" as const, detail: "Owner missing", at: "1", by: "Ben" },
      { file: "b.pdf", outcome: "moved" as const, detail: "/x/b.pdf", at: "2", by: "Ben" },
      { file: "a.pdf", outcome: "moved" as const, detail: "/x/a.pdf", at: "3", by: "Ben" },
    ];
    expect(logSummary(log)).toBe("2 moved · 1 refused");
    expect(logSummary([])).toBe("");
    expect(latestByFile(log).get("a.pdf")?.outcome).toBe("moved");
    expect(ingestComment("Legacy SOPs", "Ben")).toBe('Ingested — task "Legacy SOPs" by Ben');
  });
});
