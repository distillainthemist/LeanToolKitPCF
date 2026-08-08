// Notifications (N2) — the TRANSPORT half. Statically imports the
// generated connector services (docs-only per the import gate), and is
// itself only ever loaded by dynamic import from a send click — the
// ~70 kB of generated wrappers stay out of every chunk until someone
// actually notifies.
//
// Everything here sends AS THE ACTING USER — honest provenance, and
// the recipient can simply reply. Measured rules (probe, 2026-08-07):
// CreateChat members = the OTHER participants only (the connector
// seats the caller itself; including yourself is refused as "Duplicate
// chat members").

import { Office365OutlookService } from "../generated/services/Office365OutlookService";
import { MicrosoftTeamsService } from "../generated/services/MicrosoftTeamsService";
import { NotifyRecipient, notifyCard, notifyChatHtml, notifyEmailHtml } from "./notifyModel";

interface OpResult {
  success?: boolean;
  data?: unknown;
  error?: unknown;
}

const failText = (r: OpResult): string => {
  if (!r || r.success !== false) return "";
  const e = r.error as { message?: unknown } | string | null | undefined;
  const msg =
    typeof e === "string" ? e : typeof e?.message === "string" ? e.message : JSON.stringify(e);
  return (msg || "refused").slice(0, 300);
};

export interface NotifySendOutcome {
  /** "" = sent; otherwise the honest reason it was not. */
  error: string;
  /** How it landed, for the panel's confirmation line ("card",
   *  "message", "email"). */
  how: string;
}

/** One email to all recipients — they see each other, which is right:
 *  a notification is the start of a conversation, not a broadcast. */
export async function sendNotifyEmail(
  recipients: NotifyRecipient[],
  subject: string,
  message: string,
  link: string
): Promise<NotifySendOutcome> {
  try {
    const r = (await Office365OutlookService.SendEmailV2({
      To: recipients.map((p) => p.email).join(";"),
      Subject: subject,
      Body: notifyEmailHtml(message, link),
    })) as OpResult;
    const why = failText(r);
    return { error: why, how: "email" };
  } catch (e) {
    return { error: trim(e), how: "email" };
  }
}

/**
 * One Teams chat with all recipients (a group chat when several — the
 * follow-up conversation is the point), then the Adaptive Card; if the
 * card is refused, the measured plain-message recipe is the fallback,
 * and the outcome says which landed.
 */
export async function sendNotifyTeams(
  recipients: NotifyRecipient[],
  subject: string,
  message: string,
  link: string
): Promise<NotifySendOutcome> {
  let chatId = "";
  try {
    const r = (await MicrosoftTeamsService.CreateChat({
      // the caller is seated by the connector — recipients only
      members: recipients.map((p) => p.email).join(";"),
      ...(recipients.length > 1 ? { topic: subject } : {}),
    })) as OpResult;
    const why = failText(r);
    if (why !== "") return { error: `Could not open the chat: ${why}`, how: "" };
    chatId = String(((r.data ?? {}) as { id?: unknown }).id ?? "");
    if (chatId === "") {
      return { error: "The chat was created but no chat id came back.", how: "" };
    }
  } catch (e) {
    return { error: `Could not open the chat: ${trim(e)}`, how: "" };
  }

  // the card first (Ben, 2026-08-08) — richer in Teams, with an Open
  // button; its body shape is dynamic in the swagger, so both plausible
  // carriages are tried and a refusal falls through to plain text
  const card = notifyCard(subject, message, link);
  for (const messageBody of [JSON.stringify(card), card as unknown]) {
    try {
      const r = (await MicrosoftTeamsService.PostCardToConversation(
        { recipient: chatId, messageBody } as Record<string, unknown>,
        "User",
        "Group chat"
      )) as OpResult;
      if (failText(r) === "") return { error: "", how: "card" };
    } catch {
      /* fall through to the next carriage */
    }
  }
  for (const location of ["Group chat", "Chat"]) {
    try {
      const r = (await MicrosoftTeamsService.PostMessageToConversation(
        { recipient: chatId, messageBody: notifyChatHtml(message, link) },
        "User",
        location
      )) as OpResult;
      if (failText(r) === "") return { error: "", how: "message" };
    } catch {
      /* try the next location */
    }
  }
  return {
    error: "The chat opened but neither the card nor a plain message was accepted.",
    how: "",
  };
}

const trim = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);
