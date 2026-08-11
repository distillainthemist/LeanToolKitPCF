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
import { spRequest } from "./sp";
import { DocRow, buildRenderViewXml, parseRenderPage } from "./rows";
import { spErrorText } from "./model";

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
  for (const row of scan) {
    const p = await rawPage(
      site,
      listId,
      buildRenderViewXml({ idIn: [row.id], fields, rowLimit: 1 })
    );
    if (!p.ok) failed.push({ row, status: p.status });
  }
  step(
    "Per-document scan",
    failed.length === 0,
    `${scan.length} documents, full field set — ${
      failed.length === 0 ? "all passed" : `${failed.length} FAILED`
    }${pool.length > SCAN_CAP ? ` (first ${SCAN_CAP} of ${pool.length})` : ""}`
  );
  for (const f of failed) step(f.row.name, false, clip(f.status));
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
