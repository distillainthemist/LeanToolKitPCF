// Standard Documents — the Phase 4A write probe.
//
// Phase 4 is the first phase that writes, and one path in it is genuinely
// unproven: a file's BYTES through a connector that serialises its body
// as a string. Rather than design around a guess, this runs the whole
// write surface against a probe file it creates and recycles, and says
// which parts of it this tenant actually allows.
//
// It is loaded on demand from the settings tab, so its bytes are in
// nobody's chunk until an admin asks the question. It stays useful after
// Phase 4 ships: a deployment where writes are blocked says so in one
// click, instead of failing later at a user's first check-out.

import {
  bytesToBase64,
  bytesToBinaryString,
  parseBasePermissions,
  spErrorText,
  textFieldGuidFromSchema,
  validateItemErrors,
} from "./model";
import type { SpResult } from "./sp";
import { driveIdFor, renderListPage } from "./data";
import { buildRenderViewXml } from "./rows";
import {
  addFile,
  addFileBytes,
  checkInFile,
  checkOutFile,
  connectorCreateFile,
  connectorPatchItem,
  copyFileTo,
  fetchFieldByGuid,
  fetchFieldSchema,
  fetchFileInfo,
  fetchFileItemId,
  fetchListEntityType,
  fetchListPermissions,
  fetchListRoot,
  patchDriveItemFields,
  patchTaxonomyField,
  recycleFile,
  undoCheckOut,
  validateUpdateListItem,
} from "./sp";

export interface ProbeStep {
  name: string;
  ok: boolean;
  /** What happened, in the server's words where there are any. */
  detail: string;
}

export interface ProbeInput {
  site: string;
  listId: string;
  /** A taxonomy column and one real term from its set, when the site has
   *  one. The awkward write, and the one 4C's metadata form leans on —
   *  the id matters, because a bare label is what SharePoint rejects. */
  taxColumn?: { internal: string; label: string; termId: string };
}

/** The bytes the upload step sends. Deliberately not text: 0x80–0xFF are
 *  exactly what a UTF-8 re-encode would double, and a NUL is what a
 *  C-string truncation would cut at. Sixteen bytes, so the expected
 *  Length is unambiguous. */
const PROBE_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0x7f, 0x80, 0xa9, 0xc3, 0xfe, 0xff, 0x0a,
]);

const PROBE_TEXT = "LeanBoard write probe — safe to delete.";

// SharePoint's own sentence where one exists, and enough room to read
// it — the first probe runs clipped at 200 characters, which cut every
// 502 off exactly at "innerError": { and hid the one line that said
// what actually failed.
const say = (r: { ok: boolean; status: string }, good: string) =>
  r.ok ? good : spErrorText(r.status).slice(0, 500) || "refused";

/**
 * Runs the probe, reporting each step as it lands so a hang is visible
 * rather than mysterious. Never throws; every created file is recycled
 * even when a step fails half-way.
 */
export async function runWriteProbe(
  input: ProbeInput,
  onStep: (step: ProbeStep) => void
): Promise<void> {
  const { site, listId } = input;
  const created: string[] = [];
  const step = (name: string, ok: boolean, detail: string) => onStep({ name, ok, detail });

  try {
    const perms = await fetchListPermissions(site, listId);
    if (!perms.ok) {
      step("Effective permissions", false, perms.status.slice(0, 200));
      return;
    }
    const p = parseBasePermissions(perms.data);
    step(
      "Effective permissions",
      p.add && p.edit,
      `add ${p.add ? "yes" : "no"}, edit ${p.edit ? "yes" : "no"}, delete ${p.remove ? "yes" : "no"}`
    );
    if (!p.add) {
      step("Everything below", false, "skipped — this library does not allow adding items");
      return;
    }

    const rootRes = await fetchListRoot(site, listId);
    const root = String(
      ((rootRes.data ?? {}) as { ServerRelativeUrl?: unknown }).ServerRelativeUrl ?? ""
    );
    step("Library root folder", root !== "", root !== "" ? root : say(rootRes, ""));
    if (root === "") return;

    // one stamp per run, so a probe left behind by a failed run is
    // recognisable and never collides with this one
    // the same folder said two ways: REST addresses it server-relative
    // ("/sites/Dev/Lib"), the connector's file operations site-relative
    // ("/Lib")
    const sitePath = new URL(site).pathname.replace(/\/$/, "");
    const siteRelative =
      sitePath !== "" && root.startsWith(sitePath) ? root.slice(sitePath.length) : root;

    const stamp = String(Date.now());
    const textName = `LeanBoard write probe ${stamp}.txt`;
    const textUrl = `${root}/${textName}`;
    const add = await addFile(site, root, textName, PROBE_TEXT);
    step("Create a text file", add.ok, say(add, textName));
    if (!add.ok) return;
    created.push(textUrl);

    const info = await fetchFileInfo(site, textUrl);
    const textLen = Number(((info.data ?? {}) as { Length?: unknown }).Length ?? -1);
    const wantText = new TextEncoder().encode(PROBE_TEXT).length;
    step(
      "Read it back",
      info.ok && textLen === wantText,
      info.ok ? `${textLen} bytes, expected ${wantText}` : say(info, "")
    );

    const idRes = await fetchFileItemId(site, textUrl);
    const itemId = Number(((idRes.data ?? {}) as { Id?: unknown }).Id ?? 0);
    step("Find its list item", itemId > 0, itemId > 0 ? `item ${itemId}` : say(idRes, ""));

    // Hold a check-out for the whole metadata block. Two run-earned
    // rules live here: a require-check-out library hands a REST-created
    // file back ALREADY checked out to its creator (run five's "already
    // checked out by…" was us), so take the check-out however it comes;
    // and every write below passes bNewDocumentUpdate=false, because
    // true CHECKS THE FILE IN mid-probe — that one boolean faked three
    // runs of taxonomy failures.
    const pre = await fetchFileInfo(site, textUrl);
    const preHeld =
      pre.ok && Number(((pre.data ?? {}) as { CheckOutType?: unknown }).CheckOutType ?? 2) !== 2;
    let held = preHeld;
    if (preHeld) {
      step("Check out", true, "created already checked out — the library requires check-out");
    } else {
      const out = await checkOutFile(site, textUrl);
      held = out.ok;
      step("Check out", out.ok, say(out, "checked out"));
    }

    if (itemId > 0) {
      const titled = await validateUpdateListItem(site, listId, itemId, [
        { FieldName: "Title", FieldValue: "LeanBoard write probe" },
      ]);
      const errs = validateItemErrors(titled.data);
      step(
        "Write metadata (text)",
        titled.ok && errs.length === 0,
        titled.ok
          ? errs.map((e) => `${e.field}: ${e.message}`).join("; ") || "accepted"
          : say(titled, "")
      );

      // The write 4C actually depends on. A bare label is what the
      // tagging UI's own error is complaining about ("not formatted
      // correctly", measured 2026-08-03) — the format is Label|<guid>.
      // Both are tried, so the answer says which one this tenant takes
      // rather than only that one of them failed.
      const tc = input.taxColumn;
      if (tc !== undefined) {
        // Taxonomy, fourth revision (2026-08-03). What three runs
        // established: the transport is fine (Title lands), all four
        // magic-string form values are REJECTED by the tagging-UI
        // validator ("-1;#Label|id", id alone, label alone) or die at
        // the gateway (Label|id, 502), and the guessed note-field name
        // was an ArgumentException. So this revision (a) keeps only the
        // one form value worth re-measuring, with its FULL error now
        // surfaced, and (b) adds the routes never yet tried — above all
        // the connector's own typed item surface, which is what the
        // flow "Update item" action uses and the path Microsoft
        // maintains taxonomy serialisation for.

        /** Did the value LAND, whatever the response said? A 502 from
         *  the gateway can follow a write SharePoint already made, and
         *  a format that works is worth finding behind a bad reply. */
        const landed = async (): Promise<boolean> => {
          const page = await renderListPage(
            site,
            listId,
            buildRenderViewXml({ idIn: [itemId], fields: [tc.internal], rowLimit: 1 })
          );
          const got = (page.rows[0]?.values[tc.internal] ?? "").trim().toLowerCase();
          return got === tc.label.trim().toLowerCase();
        };

        const entityType = async (): Promise<string> => {
          const et = await fetchListEntityType(site, listId);
          return String(
            ((et.data ?? {}) as { ListItemEntityTypeFullName?: unknown })
              .ListItemEntityTypeFullName ?? ""
          );
        };

        /** The REAL hidden note field, read from the taxonomy column's
         *  own SchemaXml — never guessed again. */
        const noteFieldName = async (): Promise<{ name: string } | { error: string }> => {
          const schema = await fetchFieldSchema(site, listId, tc.internal);
          const xml = String(((schema.data ?? {}) as { SchemaXml?: unknown }).SchemaXml ?? "");
          const guid = textFieldGuidFromSchema(xml);
          if (guid === "") {
            return { error: schema.ok ? "the column declares no TextField" : say(schema, "") };
          }
          const f = await fetchFieldByGuid(site, listId, guid);
          const name = String(((f.data ?? {}) as { InternalName?: unknown }).InternalName ?? "");
          return name !== "" ? { name } : { error: say(f, "TextField resolved to no name") };
        };

        const attempts: { how: string; run: () => Promise<SpResult> }[] = [
          {
            // the strongest candidate: the connector's typed surface,
            // where a term is an object, not a string
            how: "connector Update item (term object)",
            run: () =>
              connectorPatchItem(site, listId, itemId, {
                [tc.internal]: { Value: tc.label, TermGuid: tc.termId, WssId: -1 },
              }),
          },
          {
            how: "connector Update item (expanded reference)",
            run: () =>
              connectorPatchItem(site, listId, itemId, {
                [tc.internal]: {
                  "@odata.type": "#Microsoft.Azure.Connectors.SharePoint.SPListExpandedReference",
                  Id: tc.termId,
                  Value: tc.label,
                },
              }),
          },
          {
            how: "the hidden note field, resolved from SchemaXml",
            run: async () => {
              const nf = await noteFieldName();
              if ("error" in nf) return { ok: false, status: `note field: ${nf.error}`, data: null };
              return validateUpdateListItem(site, listId, itemId, [
                { FieldName: nf.name, FieldValue: `-1;#${tc.label}|${tc.termId}` },
              ]);
            },
          },
          {
            // re-measured with the full error surfaced this time
            how: "form value Label|id",
            run: () =>
              validateUpdateListItem(site, listId, itemId, [
                { FieldName: tc.internal, FieldValue: `${tc.label}|${tc.termId}` },
              ]),
          },
          {
            // a true PATCH verb: no X-HTTP-Method header for the
            // gateway to strip, which is the prime suspect for the
            // earlier 502 on this route
            how: "typed value, PATCH verb",
            run: async () => {
              const entity = await entityType();
              if (entity === "")
                return { ok: false, status: "could not read the list entity type", data: null };
              return patchTaxonomyField(
                site, listId, itemId, entity, tc.internal, tc.label, tc.termId, "PATCH"
              );
            },
          },
          {
            how: "typed value, POST + MERGE header",
            run: async () => {
              const entity = await entityType();
              if (entity === "")
                return { ok: false, status: "could not read the list entity type", data: null };
              return patchTaxonomyField(
                site, listId, itemId, entity, tc.internal, tc.label, tc.termId, "MERGE"
              );
            },
          },
          {
            // a wholly different pipeline: Graph-style fields PATCH on
            // the v2.0 drive surface this site already answers on
            how: "v2.0 drive fields PATCH",
            run: async () => {
              const driveId = await driveIdFor(site, listId).catch(() => "");
              if (driveId === "") return { ok: false, status: "no drive id", data: null };
              return patchDriveItemFields(site, driveId, textName, {
                [tc.internal]: `${tc.label}|${tc.termId}`,
              });
            },
          },
        ];

        let accepted = "";
        for (const a of attempts) {
          if (accepted !== "") break;
          const res = await a.run();
          const errs = validateItemErrors(res.data);
          const clean = res.ok && errs.length === 0;
          const stuck = await landed();
          if (clean || stuck) accepted = a.how;
          step(
            `${tc.internal} = “${tc.label}” via ${a.how}`,
            clean || stuck,
            clean
              ? "accepted"
              : stuck
                ? "the reply was an error, but the value LANDED — usable"
                : res.ok
                  ? errs.map((e) => e.message).join("; ") || "rejected"
                  : say(res, "")
          );
        }
        step(
          "Write a term",
          accepted !== "",
          accepted !== ""
            ? `${accepted} is the route 4C's metadata form will use`
            : "no route accepted — 4C's metadata form cannot write taxonomy columns yet"
        );
      }
    }

    if (held) {
      const cin = await checkInFile(site, textUrl, "LeanBoard write probe", false);
      step("Check in (comment, minor)", cin.ok, say(cin, "checked in as a minor version"));
    }

    const out2 = await checkOutFile(site, textUrl);
    if (out2.ok) {
      const undo = await undoCheckOut(site, textUrl);
      step("Discard a check-out", undo.ok, say(undo, "discarded"));
    } else {
      step("Discard a check-out", false, `could not check out again: ${say(out2, "")}`);
    }

    const copyName = `LeanBoard write probe ${stamp} (copy).txt`;
    const copyUrl = `${root}/${copyName}`;
    const copy = await copyFileTo(site, textUrl, copyUrl);
    step("Server-side copy", copy.ok, say(copy, "copied — this is the template route"));
    if (copy.ok) created.push(copyUrl);

    // 5H3's one unmeasured call: copy OVER a file the caller holds
    // checked out (overwrite=true) — the replace-content route. Run
    // against the probe's own file, inside its own check-out, then the
    // check-out is discarded so nothing persists.
    if (copy.ok) {
      const hold = await checkOutFile(site, textUrl);
      const heldNow = hold.ok || /checked out/i.test(say(hold, ""));
      if (!heldNow) {
        step("Copy OVER a checked-out file", false, `could not check out first: ${say(hold, "")}`);
      } else {
        const over = await copyFileTo(site, copyUrl, textUrl, true);
        step(
          "Copy OVER a checked-out file",
          over.ok,
          say(over, "replaced — this is the replace-content route (5H3)")
        );
        await undoCheckOut(site, textUrl);
      }
    }

    // THE question 4A exists to answer. Two carriages, because the first
    // one's failure was diagnostic rather than final: a string body is
    // re-encoded as UTF-8 (16 sent, 21 stored, measured on Dev
    // 2026-08-03), so the bytes are tried again inside Power Platform's
    // own binary envelope, where every character is already ASCII.
    const carriages: { how: string; ext: string; send: (name: string) => Promise<SpResult> }[] = [
      {
        how: "string body",
        ext: "bin",
        send: (name) => addFile(site, root, name, bytesToBinaryString(PROBE_BYTES)),
      },
      {
        how: "base64 envelope",
        ext: "b64.bin",
        send: (name) => addFileBytes(site, root, name, PROBE_BYTES),
      },
      // "Root folder is not found" on the first attempt was my path, not
      // the tenant's: this operation wants a path relative to the SITE,
      // where the REST surface wants the server-relative one.
      {
        how: "connector Create file, base64",
        ext: "conn64.bin",
        send: (name) => connectorCreateFile(site, siteRelative, name, bytesToBase64(PROBE_BYTES)),
      },
      {
        how: "connector Create file, raw",
        ext: "connraw.bin",
        send: (name) =>
          connectorCreateFile(site, siteRelative, name, bytesToBinaryString(PROBE_BYTES)),
      },
    ];
    let uploadWorks = false;
    for (const c of carriages) {
      if (uploadWorks) break;
      const name = `LeanBoard write probe ${stamp}.${c.ext}`;
      const url = `${root}/${name}`;
      const res = await c.send(name);
      if (!res.ok) {
        step(`Upload raw bytes (${c.how})`, false, say(res, ""));
        continue;
      }
      created.push(url);
      const got = Number(
        ((await fetchFileInfo(site, url)).data as { Length?: unknown })?.Length ?? -1
      );
      uploadWorks = got === PROBE_BYTES.length;
      step(
        `Upload raw bytes (${c.how})`,
        uploadWorks,
        uploadWorks
          ? `${got} bytes, exactly as sent`
          : `${got} bytes for ${PROBE_BYTES.length} sent — re-encoded in transit`
      );
    }
    step(
      "Upload from device",
      uploadWorks,
      uploadWorks
        ? "a carriage that preserves bytes exists — 4C can accept an upload"
        : "no carriage preserves bytes — 4C ships template copy only"
    );
  } finally {
    // whatever happened above, leave the library as we found it
    let recycled = 0;
    for (const url of created) {
      const r = await recycleFile(site, url);
      if (r.ok) recycled++;
    }
    if (created.length > 0) {
      step(
        "Clean up",
        recycled === created.length,
        `${recycled} of ${created.length} probe file(s) recycled` +
          (recycled === created.length ? "" : " — remove the rest by hand")
      );
    }
  }
}

// ---- U0: the Dataverse file-column relay (doc-cards plan part C) -------
//
// The connector carriages cannot carry bytes (measured four ways, re-
// checked per SDK bump above). This probe measures the OTHER door: the
// SDK's own uploadFileToRecord/downloadFileFromRecord on a Dataverse
// FILE column (ben_ltkupload.ben_file, schema 2026-08-08). If bytes
// round-trip intact here, the native-upload relay road is open: app →
// Dataverse file column → deployment flow → SharePoint staging.

/** Deterministic pattern including high bytes and NULs — the same
 *  re-encode/truncation traps the SharePoint carriages fell into. */
function patternBytes(size: number): Uint8Array<ArrayBuffer> {
  // explicit ArrayBuffer so the result satisfies BlobPart (a bare
  // `new Uint8Array(n)` types over ArrayBufferLike since TS 5.7)
  const b = new Uint8Array(new ArrayBuffer(size));
  for (let i = 0; i < size; i++) b[i] = (i * 31) & 0xff;
  return b;
}

/** First divergence between two byte arrays, -1 when identical. */
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/**
 * Runs the Dataverse upload probe: create a row, round-trip 64KB and
 * then 4MB through the file column, delete everything. Reports each
 * step as it lands; the row is deleted even when a step fails.
 */
export async function runUploadProbe(onStep: (step: ProbeStep) => void): Promise<void> {
  const step = (name: string, ok: boolean, detail: string) => onStep({ name, ok, detail });
  const { Ben_ltkuploadsService } = await import("../generated/services/Ben_ltkuploadsService");
  const { getClient } = await import("@microsoft/power-apps/data");
  const { dataSourcesInfo } = await import("../../.power/schemas/appschemas/dataSourcesInfo");
  const client = getClient(dataSourcesInfo);
  const TABLE = "ben_ltkuploads";
  let id = "";
  try {
    const created = await Ben_ltkuploadsService.create({
      ben_name: "LeanBoard U0 probe — safe to delete",
      ben_status: "probe",
    } as Parameters<typeof Ben_ltkuploadsService.create>[0]);
    id =
      created.success !== false
        ? String((created.data as { ben_ltkuploadid?: unknown })?.ben_ltkuploadid ?? "")
        : "";
    step(
      "Create upload row",
      id !== "",
      id !== "" ? "row created" : (created.error?.message ?? "refused").slice(0, 300)
    );
    if (id === "") return;

    for (const size of [64 * 1024, 4 * 1024 * 1024]) {
      const label = size >= 1024 * 1024 ? `${size / (1024 * 1024)}MB` : `${size / 1024}KB`;
      const bytes = patternBytes(size);
      const t0 = performance.now();
      const up = await Ben_ltkuploadsService.upload(
        id,
        "ben_file",
        new File([bytes], `u0-probe-${label}.bin`, { type: "application/octet-stream" })
      );
      const upMs = Math.round(performance.now() - t0);
      if (up.success === false) {
        step(`Upload ${label}`, false, (up.error?.message ?? "refused").slice(0, 300));
        return;
      }
      step(`Upload ${label}`, true, `accepted in ${upMs}ms`);

      const t1 = performance.now();
      const down = await client.downloadFileFromRecord(TABLE, id, "ben_file");
      const downMs = Math.round(performance.now() - t1);
      if (down.success === false || !(down.data instanceof Uint8Array)) {
        step(`Read back ${label}`, false, (down.error?.message ?? "no bytes returned").slice(0, 300));
        return;
      }
      const diff = firstDiff(bytes, down.data);
      step(
        `Read back ${label}`,
        diff === -1,
        diff === -1
          ? `${down.data.length} bytes in ${downMs}ms, identical to what was sent`
          : `${down.data.length} bytes for ${size} sent — first divergence at byte ${diff}`
      );
      if (diff !== -1) return;
    }
    step(
      "Native upload road",
      true,
      "bytes cross the SDK's file door intact — the relay design is buildable"
    );
  } finally {
    if (id !== "") {
      // the file first (a row delete may refuse while a file blocks it),
      // then the row; tolerate either already being gone
      const df = await client
        .deleteFileOrImageFromRecord(TABLE, id, "ben_file")
        .catch(() => ({ success: false }));
      const dr = await Ben_ltkuploadsService.delete(id)
        .then(() => true)
        .catch(() => false);
      step(
        "Clean up",
        dr,
        dr
          ? `probe row deleted${df.success === false ? " (file delete was refused first — the row delete carried it)" : ""}`
          : "probe row NOT deleted — remove it from LeanBoard Uploads by hand"
      );
    }
  }
}
