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

import { bytesToBinaryString, parseBasePermissions, validateItemErrors } from "./model";
import type { SpResult } from "./sp";
import {
  addFile,
  addFileBytes,
  checkInFile,
  checkOutFile,
  copyFileTo,
  fetchFileInfo,
  fetchFileItemId,
  fetchListPermissions,
  fetchListRoot,
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

const say = (r: { ok: boolean; status: string }, good: string) =>
  r.ok ? good : r.status.slice(0, 200) || "refused";

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
        const attempts = [
          { how: "label|id", value: `${tc.label}|${tc.termId}` },
          { how: "label alone", value: tc.label },
        ];
        let done = false;
        let last = "";
        for (const a of attempts) {
          if (done) break;
          const tax = await validateUpdateListItem(site, listId, itemId, [
            { FieldName: tc.internal, FieldValue: a.value },
          ]);
          const errs = validateItemErrors(tax.data);
          if (tax.ok && errs.length === 0) {
            step(`Write metadata (term “${tc.label}”)`, true, `accepted as ${a.how}`);
            done = true;
          } else {
            last = tax.ok
              ? `${a.how}: ${errs.map((e) => e.message).join("; ") || "rejected"}`
              : `${a.how}: ${say(tax, "")}`;
          }
        }
        if (!done) step(`Write metadata (term “${tc.label}”)`, false, last);
      }
    }

    const out = await checkOutFile(site, textUrl);
    step("Check out", out.ok, say(out, "checked out"));
    if (out.ok) {
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
