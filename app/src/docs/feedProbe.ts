// The feed probe (mobile truncation, 2026-08-11): on phones, the
// player's native bridge cuts SOME connector response bodies, and the
// SDK's JSON.parse of the stump surfaces as "Retrieve operation
// failure: JSON parse error: unterminated string". A 5-row page passed
// while the next 5-row page failed, and a single-document kiosk fetch
// failed — so the cause is not size alone, and only the failing device
// can say what it is. This probe maps it empirically, read-only:
//
//   1 a size ladder (1..64 rows, core fields only) — a byte cap shows
//     as a clean threshold with everything under it passing;
//   2 a per-document scan with the kiosk's own field set — content
//     poison (a value the bridge miscounts, e.g. an autocorrected dash
//     or emoji) shows as specific documents failing at ANY size;
//   3 a field-by-field drill of the first failing document, naming the
//     column that carries the value.
//
// Every request goes through spRequest DIRECTLY — renderListPage's
// adaptive page shrink would mask exactly what this measures. Run it on
// the device that fails; on a desktop everything passes by design.

import { ProbeStep } from "./writeProbe";
import { addFile, fetchListRoot, recycleFile, spRequest } from "./sp";
import {
  DocRow,
  buildRenderViewXml,
  looksTruncatedResponse,
  parseRenderPage,
} from "./rows";
import { spErrorText, suspiciousCodePoints } from "./model";

export interface FeedProbeInput {
  site: string;
  listId: string;
  /** The register's available internals — the kiosk fetch's field set. */
  fields: string[];
}

const clip = (s: string) => spErrorText(s).slice(0, 300) || "refused";

const approxSize = (data: unknown): string => {
  try {
    const n = JSON.stringify(data ?? "").length;
    return n >= 1024 ? `~${Math.round(n / 1024)} KB` : `~${n} B`;
  } catch {
    return "unknown size";
  }
};

/** One raw RLDAS page — no retries, no shrinking: failures ARE the data. */
async function rawPage(
  site: string,
  listId: string,
  viewXml: string
): Promise<{ ok: boolean; status: string; size: string; rows: DocRow[] }> {
  const r = await spRequest(site, "POST", `_api/web/lists(guid'${listId}')/RenderListDataAsStream`, {
    headers: {
      "Content-Type": "application/json;odata=nometadata",
      Accept: "application/json;odata=nometadata",
    },
    body: JSON.stringify({
      parameters: { RenderOptions: 2, ViewXml: viewXml, DatesInUtc: true },
    }),
  });
  if (!r.ok) return { ok: false, status: r.status, size: "", rows: [] };
  return { ok: true, status: "", size: approxSize(r.data), rows: parseRenderPage(r.data, listId).rows };
}

const SCAN_CAP = 40;

export async function runFeedProbe(
  input: FeedProbeInput,
  onStep: (step: ProbeStep) => void
): Promise<void> {
  const { site, listId, fields } = input;
  const step = (name: string, ok: boolean, detail: string) => onStep({ name, ok, detail });

  // ---- 0: the smallest possible read — transport sanity ---------------
  const tiny = await spRequest(site, "GET", "_api/web?$select=Title");
  step("Site read", tiny.ok, tiny.ok ? approxSize(tiny.data) : clip(tiny.status));
  if (!tiny.ok) {
    step("Everything below", false, "skipped — even the smallest read fails on this device");
    return;
  }

  // ---- 0b: the character clinic ---------------------------------------
  // A read whose payload is KNOWN to carry non-ASCII regardless of what
  // any document holds: SharePoint's localized time-zone list says
  // "København" and "São Paulo" in every tenant. If THIS fails while
  // same-size ASCII pages pass, the bridge cannot carry any non-ASCII
  // response at all — the poison is the character class, not a document.
  const tz = await spRequest(site, "GET", "_api/web/regionalsettings/timezones");
  step(
    "Non-ASCII read (time-zone list)",
    tz.ok,
    tz.ok ? `${approxSize(tz.data)} — accented characters carried intact` : clip(tz.status)
  );

  // ---- 1: the size ladder ---------------------------------------------
  let pool: DocRow[] = [];
  let ladderFailedAt = 0;
  for (const n of [1, 2, 4, 8, 16, 32, 64]) {
    const p = await rawPage(site, listId, buildRenderViewXml({ rowLimit: n, fields: [] }));
    step(
      `Page of ${n} (core fields)`,
      p.ok,
      p.ok ? `${p.rows.length} rows, ${p.size}` : clip(p.status)
    );
    if (p.ok) {
      if (p.rows.length > pool.length) pool = p.rows;
      if (p.rows.length < n) break; // the whole library fits — ladder done
    } else if (ladderFailedAt === 0) {
      ladderFailedAt = n;
    }
  }

  // ---- 2: every document alone, wearing the kiosk's field set ---------
  if (pool.length === 0) {
    step("Per-document scan", false, "skipped — no page of ids survived to scan from");
    return;
  }
  const scan = pool.slice(0, SCAN_CAP);
  const failed: { row: DocRow; status: string }[] = [];
  const fetched: DocRow[] = [];
  for (const row of scan) {
    const p = await rawPage(
      site,
      listId,
      buildRenderViewXml({ idIn: [row.id], fields, rowLimit: 1 })
    );
    if (!p.ok) failed.push({ row, status: p.status });
    else if (p.rows[0] !== undefined) fetched.push(p.rows[0]);
  }
  step(
    "Per-document scan",
    failed.length === 0,
    `${scan.length} documents, full field set — ${
      failed.length === 0 ? "all passed" : `${failed.length} FAILED`
    }${pool.length > SCAN_CAP ? ` (first ${SCAN_CAP} of ${pool.length})` : ""}`
  );
  for (const f of failed) step(f.row.name, false, clip(f.status));

  // ---- 2b: the character audit ----------------------------------------
  // Runs over whatever the scan could READ — which is everything on a
  // desktop — so an invisible poison names itself off the failing
  // device: the document, the column, and the exact code point.
  const findings: string[] = [];
  for (const row of fetched) {
    for (const [col, value] of Object.entries(row.values)) {
      const codes = suspiciousCodePoints(value);
      if (codes.length > 0) findings.push(`${row.name} — ${col}: ${codes.join(" ")}`);
    }
  }
  step(
    "Character audit",
    findings.length === 0,
    findings.length === 0
      ? `${fetched.length} documents' values scanned — nothing suspicious`
      : `invisible or broken characters in ${findings.length} value${findings.length > 1 ? "s" : ""}`
  );
  for (const f of findings.slice(0, 12)) step("Suspicious value", false, f);

  if (failed.length === 0) {
    if (ladderFailedAt > 0) {
      step(
        "Reading",
        true,
        `single documents all pass while ${ladderFailedAt}-row pages fail — a response-size cap; ` +
          "the register's page shrink is the right medicine and the kiosk failure needs a re-test"
      );
    }
    return;
  }

  // ---- 3: the first failing document, one field at a time -------------
  const culprit = failed[0].row;
  const badFields: string[] = [];
  for (const f of fields) {
    const p = await rawPage(
      site,
      listId,
      buildRenderViewXml({ idIn: [culprit.id], fields: [f], rowLimit: 1 })
    );
    if (!p.ok) badFields.push(f);
  }
  step(
    `Field drill — ${culprit.name}`,
    false,
    badFields.length > 0
      ? `the failing column${badFields.length > 1 ? "s" : ""}: ${badFields.join(", ")} — ` +
        "inspect that value for unusual characters (smart dashes, emoji, symbols)"
      : "every field alone passes — the combined response is what fails (size, not content)"
  );
}

// ---- the character-class probe (2026-08-11) ---------------------------
//
// Validates the byte-class theory precisely: five probe FILES, each
// carrying exactly one UTF-8 class in its NAME, are read back one at a
// time — each response holds one class and nothing else, so a failure
// convicts the class, not the payload around it. One button, three
// runs, no leftover state:
//
//   desktop run 1  — files absent → creates them (writes ride the
//                    desktop, where the bridge is known-good);
//   phone run      — files present → reads each; a read that dies with
//                    the truncation signature IS the verdict;
//   desktop run 2  — every class reads clean on this device → recycles
//                    the files, cycle closed.

export interface CharClassInput {
  site: string;
  /** A WRITABLE library (working/revision) — probe files live briefly. */
  listId: string;
}

const CHAR_CLASSES: { token: string; label: string; char: string }[] = [
  { token: "CP1X", label: "1-byte ASCII (x)", char: "x" },
  { token: "CP2O", label: "2-byte (ø)", char: "ø" },
  { token: "CP3D", label: "3-byte em dash (—)", char: "—" },
  { token: "CP3A", label: "3-byte fullwidth ampersand (＆)", char: "＆" },
  { token: "CP4E", label: "4-byte emoji (\u{1f600})", char: "\u{1f600}" },
];

export async function runCharClassProbe(
  input: CharClassInput,
  onStep: (step: ProbeStep) => void
): Promise<void> {
  const { site, listId } = input;
  const step = (name: string, ok: boolean, detail: string) => onStep({ name, ok, detail });

  const rootRes = await fetchListRoot(site, listId);
  const root = String(
    ((rootRes.data ?? {}) as { ServerRelativeUrl?: unknown }).ServerRelativeUrl ?? ""
  );
  if (root === "") {
    step("Library root folder", false, clip(rootRes.status) || "not readable");
    return;
  }
  const nameOf = (c: (typeof CHAR_CLASSES)[number]) => `LBCHARPROBE ${c.token} ${c.char}.txt`;

  // ---- read phase: each class alone, addressed by its ASCII token ----
  const missing: typeof CHAR_CLASSES = [];
  let died = 0;
  let unreadable = 0;
  for (const c of CHAR_CLASSES) {
    const q = await rawPage(
      site,
      listId,
      buildRenderViewXml({ nameWords: [c.token], fields: [], rowLimit: 1 })
    );
    if (!q.ok && looksTruncatedResponse(q.status)) {
      step(c.label, false, "the read DIED on this character — the bridge cannot carry it");
      died++;
    } else if (!q.ok) {
      step(c.label, false, clip(q.status));
      unreadable++;
    } else if (q.rows.length === 0) {
      missing.push(c);
    } else {
      step(c.label, true, "read back intact");
    }
  }

  // ---- create phase: only when nothing exists yet (a desktop run) ----
  if (missing.length === CHAR_CLASSES.length) {
    for (const c of missing) {
      const a = await addFile(
        site,
        root,
        nameOf(c),
        "LeanBoard character probe — safe to delete."
      );
      // a truncated CREATE response is itself the file landing and the
      // read of its echo dying — count that as created
      const landed = a.ok || looksTruncatedResponse(a.status);
      step(`Create ${c.label}`, landed, landed ? nameOf(c) : clip(a.status));
    }
    step(
      "Next",
      true,
      "probe files created — run this same button ON THE PHONE for the verdict; " +
        "a later desktop run recycles them"
    );
    return;
  }
  for (const c of missing) {
    step(c.label, false, "probe file missing — run once on a desktop to (re)create it");
  }

  // ---- verdict + cleanup ---------------------------------------------
  if (died > 0) {
    step(
      "Verdict",
      false,
      `${died} class${died > 1 ? "es" : ""} failed on this device — the classes above ` +
        "marked as died are what the bridge drops. Files kept for re-runs; a desktop " +
        "run recycles them."
    );
    return;
  }
  if (missing.length === 0 && unreadable === 0) {
    let recycled = 0;
    for (const c of CHAR_CLASSES) {
      const r = await recycleFile(site, `${root}/${nameOf(c)}`);
      if (r.ok) recycled++;
    }
    step(
      "Cleanup",
      recycled === CHAR_CLASSES.length,
      `every class passed on this device — ${recycled} of ${CHAR_CLASSES.length} probe ` +
        "files recycled"
    );
  }
}
