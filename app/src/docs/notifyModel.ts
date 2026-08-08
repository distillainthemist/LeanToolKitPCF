// Notifications (N2) — the PURE half: who the next step is and what a
// polite message says (docs/leanboard-notifications-plan.md). No
// connector imports here — the screen derives a plan for every command
// it opens, and only the send click loads transport bytes.

import { LifecycleCommandKey, LifecycleStage } from "./model";

export interface NotifyRecipient {
  name: string;
  email: string;
}

/** What a command dialog needs to offer the notify panel. */
export interface NotifyContext {
  recipients: NotifyRecipient[];
  /** Email subject / card title. */
  subject: string;
  /** Prefilled, editable body — the typed reason is appended by the
   *  dialog, which is the only party that has it. */
  message: string;
  /** The WORK link (N1): full app, overlay open, commands live. */
  link: string;
}

export interface NotifyRoles {
  owners: NotifyRecipient[];
  approvers: NotifyRecipient[];
  reviewers: NotifyRecipient[];
  editors: NotifyRecipient[];
}

/** Self-filtered (the actor is never their own recipient), deduped by
 *  email, empty-email entries dropped — the CreateChat lesson: the
 *  connector seats the caller itself. */
const people = (myEmail: string, ...groups: NotifyRecipient[][]): NotifyRecipient[] => {
  const me = myEmail.trim().toLowerCase();
  const seen = new Set<string>();
  const out: NotifyRecipient[] = [];
  for (const g of groups) {
    for (const p of g) {
      const email = p.email.trim().toLowerCase();
      if (email === "" || email === me || seen.has(email)) continue;
      seen.add(email);
      out.push({ name: p.name !== "" ? p.name : p.email, email: p.email.trim() });
    }
  }
  return out;
};

/**
 * The notify plan for a completed lifecycle step — recipients are the
 * NEXT actor(s), the message says what just happened and what they
 * need to do. Null = no derivable next actor, and the dialog shows no
 * panel at all (Ben's intent: an option, never a chore).
 */
export function notifyPlanFor(opts: {
  commandKey: LifecycleCommandKey;
  /** The command's RESOLVED target stage (submit-for-approval lands on
   *  the approvers' stage or the owner's — the screen already knows). */
  to: LifecycleStage;
  docName: string;
  actorName: string;
  roles: NotifyRoles;
  myEmail: string;
  link: string;
}): NotifyContext | null {
  const { commandKey, to, docName, actorName, roles, myEmail, link } = opts;
  const plan = (
    recipients: NotifyRecipient[],
    subject: string,
    message: string
  ): NotifyContext | null =>
    recipients.length === 0 ? null : { recipients, subject, message, link };
  const who = actorName !== "" ? actorName : "A colleague";
  switch (commandKey) {
    case "submitReview":
      return plan(
        people(myEmail, roles.reviewers),
        `Review requested — ${docName}`,
        `Hi — ${who} has submitted “${docName}” for review in LeanBoard. ` +
          `Please review it when you have a moment.`
      );
    case "submitApproval":
      return to === "inOwnerApproval"
        ? plan(
            people(myEmail, roles.owners),
            `Approval needed — ${docName}`,
            `Hi — ${who} has submitted “${docName}” for approval in LeanBoard. ` +
              `As the document owner, your approval is the final step.`
          )
        : plan(
            people(myEmail, roles.approvers),
            `Approval requested — ${docName}`,
            `Hi — ${who} has submitted “${docName}” for approval in LeanBoard. ` +
              `Please review and approve it when you have a moment.`
          );
    case "approve":
      return to === "inOwnerApproval"
        ? plan(
            people(myEmail, roles.owners),
            `Endorsed — ${docName} awaits your final approval`,
            `Hi — ${who} has endorsed “${docName}” in LeanBoard. ` +
              `As the document owner, your approval is the last step.`
          )
        : // the final approve: a courtesy close-the-loop to everyone
          // who took part — no action needed, and the plan says so
          plan(
            people(myEmail, roles.reviewers, roles.approvers),
            `Approved — ${docName}`,
            `Hi — “${docName}” has been approved and published in LeanBoard. ` +
              `No action needed — thank you for your part in the review.`
          );
    case "requestRevision":
      return plan(
        people(myEmail, roles.owners, roles.editors),
        `Revision requested — ${docName}`,
        `Hi — ${who} has requested a revision of “${docName}” in LeanBoard, ` +
          `so it has returned to draft. Please pick it up when you can.`
      );
    case "markSuperseded":
    case "markObsolete":
    case "reinstate": {
      const label =
        commandKey === "markSuperseded"
          ? "marked as superseded"
          : commandKey === "markObsolete"
            ? "marked as obsolete"
            : "reinstated";
      // usually the owner acts and the self-filter empties this — the
      // panel only appears when a controller retires on their behalf
      return plan(
        people(myEmail, roles.owners),
        `${docName} — ${label}`,
        `Hi — ${who} has ${label.replace(" as", "")} “${docName}” in LeanBoard.`
      );
    }
    default:
      return null; // revise and anything new: no next actor to derive
  }
}

/**
 * The notify plan for the 5G access-request moments (N3): a submitted
 * request tells the owners, a decision tells the requester. Same rules
 * as the lifecycle plans — self-filtered, deduped, null when empty.
 */
export function accessRequestPlan(opts: {
  kind: "requested" | "granted" | "declined";
  docName: string;
  actorName: string;
  /** Owners for "requested"; the requester for a decision. */
  targets: NotifyRecipient[];
  myEmail: string;
  link: string;
}): NotifyContext | null {
  const { kind, docName, actorName, targets, myEmail, link } = opts;
  const recipients = people(myEmail, targets);
  if (recipients.length === 0) return null;
  const who = actorName !== "" ? actorName : "A colleague";
  switch (kind) {
    case "requested":
      return {
        recipients,
        subject: `Edit access requested — ${docName}`,
        message:
          `Hi — ${who} has asked for edit access to “${docName}” in LeanBoard. ` +
          `Please approve or decline it from My tasks when you have a moment.`,
        link,
      };
    case "granted":
      return {
        recipients,
        subject: `Edit access granted — ${docName}`,
        message:
          `Hi — ${who} has granted you edit access to “${docName}” in LeanBoard. ` +
          `You can start the revision now.`,
        link,
      };
    case "declined":
      return {
        recipients,
        subject: `Edit access declined — ${docName}`,
        message: `Hi — ${who} has declined your edit-access request for “${docName}” in LeanBoard.`,
        link,
      };
  }
}

// ---- message rendering --------------------------------------------------

export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The email body: the (possibly edited) text as paragraphs, then the
 *  work link — plain HTML, no card (Outlook actionable messages need
 *  per-sender registration with Microsoft; not worth the yoke). */
export function notifyEmailHtml(message: string, link: string): string {
  const paras = message
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `${paras}<p><a href="${escapeHtml(link)}">Open the document in LeanBoard</a></p>`;
}

/** The Teams fallback body when the card is refused: same content as
 *  the email, minus nothing — a link in a chat message is still a link. */
export const notifyChatHtml = notifyEmailHtml;

/** The Adaptive Card (Ben, 2026-08-08): title + message + an Open
 *  button. Schema 1.2 — the floor every Teams client renders. */
export function notifyCard(subject: string, message: string, link: string): object {
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.2",
    body: [
      { type: "TextBlock", text: subject, weight: "Bolder", size: "Medium", wrap: true },
      { type: "TextBlock", text: message, wrap: true },
    ],
    actions: [{ type: "Action.OpenUrl", title: "Open in LeanBoard", url: link }],
  };
}
