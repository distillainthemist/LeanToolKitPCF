// Replace a person across documents (C1, feedback round 1 — "owners /
// roles leave the business": a bulk find-and-replace of document
// ownership). Opened from the health report by a document admin. One
// person out, one in, on the roles chosen, over the scanned documents
// that name them; each write rides the edit-properties bracket (check-out
// → ValidateUpdateListItem with claims → minor check-in, published on a
// moderated library when the document is reader-facing). Progress and
// failures are said per document; nothing is silent.

import { clear, el } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import { poolPeopleSource } from "./accessGates";
import { checkInFile, checkOutFile, fetchListModeration, validateUpdateListItem } from "./sp";
import { spErrorText, validateItemErrors } from "./model";

export interface ReassignDoc {
  listId: string;
  itemId: number;
  name: string;
  libName: string;
  serverUrl: string;
  /** Approved: a moderated library's check-in is published too. */
  readerFacing: boolean;
  people: { role: "owner" | "approvers" | "reviewers"; col: string; names: string[]; emails: string[] }[];
}

const ROLE_WORDS: Record<ReassignDoc["people"][number]["role"], string> = { owner: "Owner", approvers: "Approvers", reviewers: "Reviewers" };

export function openReplacePerson(opts: {
  host: HTMLElement;
  site: string;
  docs: ReassignDoc[];
  /** How many documents were changed. */
  onDone: (changed: number) => void;
}): void {
  // everyone named anywhere, by email
  const named = new Map<string, string>();
  for (const d of opts.docs) for (const p of d.people) p.emails.forEach((e, i) => named.set(e, p.names[i] ?? e));
  let changed = 0;
  let running = false;
  const dlg = openDialog({
    host: opts.host,
    title: "Replace a person",
    maxWidth: 560,
    buttons: [
      { label: "Close", kind: "secondary", onClick: () => dlg.close() },
      { label: "Replace", kind: "primary", onClick: () => void run() },
    ],
    onClose: () => opts.onDone(changed),
  });
  const goBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;
  const body = dlg.body;
  body.appendChild(
    el(
      "div",
      "app-field-hint",
      "Every scanned document that names the first person in the ticked roles gets the second person instead. Each write is a minor version with a check-in comment; approved documents on a moderated library publish as part of it."
    )
  );
  // from
  const fromSel = el("select", "app-input") as HTMLSelectElement;
  const none = el("option", "", "Choose who is leaving…") as HTMLOptionElement;
  none.value = "";
  fromSel.appendChild(none);
  for (const [email, name] of [...named.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
    const o = el("option", "", `${name} <${email}>`) as HTMLOptionElement;
    o.value = email;
    fromSel.appendChild(o);
  }
  body.appendChild(fieldRow("Replace", fromSel));
  // to — the pool (owners & approvers group), searched
  let to: { email: string; name: string } | null = null;
  const toBox = el("div", "app-docs-ppl");
  const toChip = el("div", "app-docs-pplchips");
  const toSearch = el("input", "app-input") as HTMLInputElement;
  toSearch.placeholder = "Search the owners & approvers group…";
  const toHits = el("div", "app-docs-pplhits");
  toBox.append(toChip, toSearch, toHits);
  const paintTo = () => {
    clear(toChip);
    if (to === null) {
      toChip.style.display = "none";
      return;
    }
    toChip.style.display = "";
    const chip = el("span", "app-docs-pplchip");
    chip.appendChild(el("span", "", to.name));
    const off = el("button", "app-docs-pplchipx", "✕") as HTMLButtonElement;
    off.addEventListener("click", () => {
      to = null;
      paintTo();
      paintPreview();
    });
    chip.appendChild(off);
    toChip.appendChild(chip);
  };
  paintTo();
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  toSearch.addEventListener("input", () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      const mine = ++seq;
      void poolPeopleSource().then((src) =>
        src.search(toSearch.value).then((hits) => {
          if (mine !== seq) return;
          clear(toHits);
          for (const h of hits.filter((x) => x.mail !== "").slice(0, 8)) {
            const row = el("button", "app-docs-pplhit") as HTMLButtonElement;
            row.type = "button";
            row.append(el("span", "app-docs-pplhitname", h.displayName), el("span", "app-field-hint", h.mail));
            row.addEventListener("click", () => {
              to = { email: h.mail.toLowerCase(), name: h.displayName };
              toSearch.value = "";
              clear(toHits);
              paintTo();
              paintPreview();
            });
            toHits.appendChild(row);
          }
        })
      );
    }, 300);
  });
  body.appendChild(fieldRow("With", toBox));
  // roles
  const roles = new Set<ReassignDoc["people"][number]["role"]>(["owner", "approvers", "reviewers"]);
  const rolesRow = el("div", "app-docs-fpills");
  for (const r of ["owner", "approvers", "reviewers"] as const) {
    const lab = el("label", "app-docs-check") as HTMLLabelElement;
    const box = el("input", "") as HTMLInputElement;
    box.type = "checkbox";
    box.checked = true;
    box.addEventListener("change", () => {
      if (box.checked) roles.add(r);
      else roles.delete(r);
      paintPreview();
    });
    lab.append(box, document.createTextNode(` ${ROLE_WORDS[r]}`));
    rolesRow.appendChild(lab);
  }
  body.appendChild(fieldRow("Roles", rolesRow));
  const preview = el("div", "app-field-hint");
  body.appendChild(preview);
  const status = el("div", "app-docs-addstatus");
  body.appendChild(status);
  const log = el("div", "app-docs-hrdocs");
  body.appendChild(log);

  const affected = (): ReassignDoc[] => {
    const from = fromSel.value;
    if (from === "") return [];
    return opts.docs.filter((d) => d.people.some((p) => roles.has(p.role) && p.emails.includes(from)));
  };
  const paintPreview = () => {
    const n = affected().length;
    preview.textContent = fromSel.value === "" ? "" : n === 0 ? "No scanned document names this person in the ticked roles." : `${n} document${n === 1 ? "" : "s"} will change.`;
    goBtn.disabled = running || n === 0 || to === null;
  };
  fromSel.addEventListener("change", paintPreview);
  paintPreview();

  const claims = (emails: string[]) => JSON.stringify(emails.map((e) => ({ Key: `i:0#.f|membership|${e}` })));
  const moderationCache = new Map<string, Promise<boolean>>();
  const moderated = (listId: string): Promise<boolean> => {
    let hit = moderationCache.get(listId);
    if (!hit) {
      hit = fetchListModeration(opts.site, listId).then(
        (mod) => mod.ok && ((mod.data ?? {}) as { EnableModeration?: unknown }).EnableModeration === true,
        () => false
      );
      moderationCache.set(listId, hit);
    }
    return hit;
  };

  const run = async () => {
    if (running || to === null) return;
    const from = fromSel.value;
    const dest = to;
    const docs = affected();
    if (from === "" || docs.length === 0) return;
    running = true;
    goBtn.disabled = true;
    fromSel.disabled = true;
    clear(log);
    let failed = 0;
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      status.textContent = `Replacing on ${i + 1} of ${docs.length}: ${d.name}…`;
      const row = el("div", "app-docs-hrdoc");
      row.append(el("span", "app-docs-hrdocname", d.name), el("span", "app-field-hint", d.libName));
      log.appendChild(row);
      const err = await replaceOn(d, from, dest);
      if (err === "") {
        changed++;
        row.appendChild(el("span", "app-field-hint", " · ✓ replaced"));
      } else {
        failed++;
        row.appendChild(el("span", "app-field-hint app-docs-addstatus-warn", ` · ${err}`));
      }
    }
    status.textContent = `Done: ${changed} replaced${failed > 0 ? `, ${failed} refused — see the list` : ""}.`;
    status.classList.toggle("app-docs-addstatus-warn", failed > 0);
    running = false;
    goBtn.style.display = "none";
  };

  const replaceOn = async (d: ReassignDoc, from: string, dest: { email: string; name: string }): Promise<string> => {
    const formValues: { FieldName: string; FieldValue: string }[] = [];
    for (const p of d.people) {
      if (!roles.has(p.role) || !p.emails.includes(from)) continue;
      const next = [...new Set(p.emails.map((e) => (e === from ? dest.email : e)))];
      formValues.push({ FieldName: p.col, FieldValue: claims(next) });
    }
    if (formValues.length === 0) return "";
    const out = await checkOutFile(opts.site, d.serverUrl);
    const alreadyOut = !out.ok && /checked out/i.test(spErrorText(out.status));
    if (!out.ok && !alreadyOut) return `check-out refused: ${spErrorText(out.status).slice(0, 120)}`;
    if (alreadyOut) return "checked out by someone else — skipped";
    const res = await validateUpdateListItem(opts.site, d.listId, d.itemId, formValues, false);
    const errs = validateItemErrors(res.data);
    if (!res.ok || errs.length > 0) {
      return `write refused: ${(errs.map((x) => `${x.field}: ${x.message}`).join("; ") || spErrorText(res.status)).slice(0, 160)} (left checked out)`;
    }
    const cin = await checkInFile(opts.site, d.serverUrl, `Role reassigned: ${from} → ${dest.email}`, false);
    if (!cin.ok && !/not checked out/i.test(spErrorText(cin.status))) return `check-in refused: ${spErrorText(cin.status).slice(0, 120)}`;
    if (d.readerFacing && (await moderated(d.listId))) {
      const pub = await validateUpdateListItem(opts.site, d.listId, d.itemId, [{ FieldName: "_ModerationStatus", FieldValue: "0" }], false);
      const perrs = validateItemErrors(pub.data);
      if (!pub.ok || perrs.length > 0) return "replaced, but the publish was refused — it awaits content approval";
    }
    return "";
  };
}

function fieldRow(label: string, control: HTMLElement): HTMLElement {
  const row = el("div", "app-field");
  row.appendChild(el("span", "app-field-label", label));
  row.appendChild(control);
  return row;
}
