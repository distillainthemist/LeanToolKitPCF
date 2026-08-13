// Governed hashtags (relationships plan H1, 2026-08-13) — the proposal
// ledger. Anyone proposes from the tagging editor; DOCUMENT CONTROLLERS
// decide in Settings → Documents. Approval CREATES the term (the 5F
// road) so the term store never holds an unvetted label; declining
// carries a message to the proposer (the issues pattern — never
// silent). Proposals are never deleted: the decision is the record.

import { currentViewer } from "../runtime";
import { Ben_ltktagproposalsService } from "../generated/services/Ben_ltktagproposalsService";
import { tagLabelProblems } from "./model";
import { createTerm, fetchTermStoreLanguage, invalidateTermPaths } from "./sp";

export interface TagProposal {
  id: string;
  label: string;
  note: string;
  status: string;
  proposerEmail: string;
  proposerName: string;
  decision: string;
  termId: string;
  when: string;
}

type Row = Awaited<ReturnType<typeof Ben_ltktagproposalsService.getAll>> extends {
  data?: (infer T)[] | undefined;
}
  ? T
  : never;

const shape = (r: Row): TagProposal => ({
  id: (r as { ben_ltktagproposalid?: string }).ben_ltktagproposalid ?? "",
  label: r.ben_name ?? "",
  note: r.ben_note ?? "",
  status: r.ben_status ?? "",
  proposerEmail: r.ben_proposeremail ?? "",
  proposerName: r.ben_proposername ?? "",
  decision: r.ben_decision ?? "",
  termId: r.ben_termid ?? "",
  when: (r as { createdon?: string }).createdon ?? "",
});

/** File a proposal. "" = filed; otherwise the plain-words refusal. */
export async function submitTagProposal(label: string, note: string): Promise<string> {
  const t = label.trim().replace(/^#/, "");
  const problems = tagLabelProblems(t);
  if (problems.length > 0) return `this tag cannot be minted: ${problems.join("; ")}`;
  const dupe = await Ben_ltktagproposalsService.getAll({
    filter: `ben_name eq '${t.replace(/'/g, "''")}' and (ben_status eq 'pending' or ben_status eq 'approved')`,
    top: 1,
  });
  if (dupe.success !== false && (dupe.data ?? []).length > 0) {
    const st = (dupe.data ?? [])[0].ben_status;
    return st === "approved"
      ? "this tag was already approved — it should be in the picker"
      : "this tag is already proposed and awaiting review";
  }
  const me = currentViewer();
  const r = await Ben_ltktagproposalsService.create({
    ben_name: t,
    ben_note: note.trim(),
    ben_status: "pending",
    ben_proposeremail: (me?.email ?? "").toLowerCase(),
    ben_proposername: me?.name ?? "",
  } as Parameters<typeof Ben_ltktagproposalsService.create>[0]);
  return r.success === false ? (r.error?.message ?? "the proposal was refused").slice(0, 200) : "";
}

export async function listProposals(status: string): Promise<TagProposal[]> {
  const r = await Ben_ltktagproposalsService.getAll({
    ...(status !== "" ? { filter: `ben_status eq '${status}'` } : {}),
    top: 200,
  });
  const rows = (r.success === false ? [] : (r.data ?? [])).map(shape);
  rows.sort((a, b) => Date.parse(a.when) - Date.parse(b.when)); // oldest first — the queue
  return rows;
}

/** Approve: mint the term at the set root, record the decision.
 *  "" = done; otherwise the refusal (the proposal stays pending). */
export async function approveProposal(
  p: TagProposal,
  site: string,
  setId: string
): Promise<string> {
  const problems = tagLabelProblems(p.label);
  if (problems.length > 0) return `cannot mint: ${problems.join("; ")}`;
  const langRes = await fetchTermStoreLanguage(site);
  const lang =
    ((langRes.data ?? {}) as { defaultLanguageTag?: string }).defaultLanguageTag ?? "en-US";
  const made = await createTerm(site, setId, "", p.label, lang);
  if (!made.ok) return `the term store refused it: ${made.status.slice(0, 200)}`;
  const termId = String(((made.data ?? {}) as { id?: unknown }).id ?? "");
  invalidateTermPaths(); // pickers must see the new term without a reload
  const upd = await Ben_ltktagproposalsService.update(p.id, {
    ben_status: "approved",
    ben_termid: termId,
    ben_decision: "Approved",
  });
  return upd.success === false
    ? `the term was created but the ledger update was refused: ${upd.error?.message ?? ""}`
    : "";
}

/** Decline with the controller's message (required — never silent).
 *  Returns {error, warn}: warn = the ledger updated but the Teams
 *  message did not go. */
export async function declineProposal(
  p: TagProposal,
  message: string
): Promise<{ error: string; warn: string }> {
  const upd = await Ben_ltktagproposalsService.update(p.id, {
    ben_status: "declined",
    ben_decision: message.trim(),
  });
  if (upd.success === false) {
    return { error: (upd.error?.message ?? "the decline was refused").slice(0, 200), warn: "" };
  }
  const me = currentViewer();
  const myEmail = (me?.email ?? "").toLowerCase();
  if (p.proposerEmail === "" || p.proposerEmail === myEmail) {
    return { error: "", warn: "" }; // nothing to deliver, or self
  }
  try {
    const { sendNotifyTeams } = await import("./notify");
    const { appLinkUrl } = await import("../links");
    const r = await sendNotifyTeams(
      [{ email: p.proposerEmail, name: p.proposerName || p.proposerEmail }],
      `About your tag proposal: #${p.label}`,
      message.trim(),
      appLinkUrl()
    );
    return { error: "", warn: r.error };
  } catch (e) {
    return { error: "", warn: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}
