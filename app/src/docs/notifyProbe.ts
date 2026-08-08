// Notification probe (N0) — measures the two notification transports
// through the connector door before any feature code rides them
// (docs/leanboard-notifications-plan.md). Runnable by any signed-in
// user from Settings → My profile.
//
//   1. EMAIL: Office 365 Outlook SendEmailV2 — sent to YOURSELF, so the
//      probe can never spam. Measures: does the operation execute
//      through executeAsync, and does an HTML body with a link land.
//   2. TEAMS: CreateChat with a colleague you name (skipped entirely
//      when no target is given) + PostMessageToConversation into it.
//      Measures: chat creation and id readback, which poster/location
//      values this tenant's connector accepts, and the message body
//      shape ({recipient, messageBody} — the swagger calls it dynamic,
//      so only a run answers).
//
// Output is status-only: outcomes and parameter names, never message
// bodies, ids or tokens.

import { Office365OutlookService } from "../generated/services/Office365OutlookService";
import { MicrosoftTeamsService } from "../generated/services/MicrosoftTeamsService";
import { currentViewer } from "../runtime";

interface OpResult {
  success?: boolean;
  data?: unknown;
  error?: unknown;
}

const outcome = (r: OpResult): { ok: boolean; why: string } => {
  if (r && r.success === false) {
    const e = r.error as { message?: unknown; code?: unknown } | string | null | undefined;
    const msg =
      typeof e === "string"
        ? e
        : typeof e?.message === "string"
          ? e.message
          : JSON.stringify(e ?? "refused");
    return { ok: false, why: msg.slice(0, 300) };
  }
  return { ok: true, why: "" };
};

export async function runNotifyProbe(
  log: (line: string) => void,
  teamsTarget: string
): Promise<void> {
  const viewer = currentViewer();
  if (!viewer || viewer.email === "") {
    log("FAIL — no signed-in viewer (the probe needs the hosted app).");
    return;
  }
  log(`Signed in as ${viewer.name} (${viewer.email}).`);

  // ---- leg 1: email to self --------------------------------------------
  log("— Email probe (Office 365 Outlook, SendEmailV2) —");
  try {
    const r = (await Office365OutlookService.SendEmailV2({
      To: viewer.email,
      Subject: "LeanBoard notification probe",
      Body:
        "<p>This is LeanBoard's notification probe — sent by you, to you.</p>" +
        "<p>If the <a href=\"https://apps.powerapps.com\">link renders as a link</a>, " +
        "HTML bodies work and notification emails can carry document permalinks.</p>",
    })) as OpResult;
    const o = outcome(r);
    log(
      o.ok
        ? "OK — SendEmailV2 executed. Check your inbox: subject \"LeanBoard notification probe\", and whether the link is clickable."
        : `FAIL — SendEmailV2 refused: ${o.why}`
    );
  } catch (e) {
    log(`FAIL — SendEmailV2 threw: ${trim(e)}`);
  }

  // ---- leg 2: Teams chat + message -------------------------------------
  log("— Teams probe (CreateChat + PostMessageToConversation) —");
  const target = teamsTarget.trim().toLowerCase();
  if (target === "") {
    log("SKIP — no colleague named. Enter a colleague's email to run the Teams leg (it sends them ONE probe message).");
    return;
  }
  if (target === viewer.email.trim().toLowerCase()) {
    log("SKIP — the Teams leg needs a colleague, not yourself (1:1 self-chats are not creatable via the connector).");
    return;
  }
  let chatId = "";
  try {
    // members = the OTHER participants only: the connector adds the
    // caller itself, and including yourself is refused as "Duplicate
    // chat members" (measured, Ben 2026-08-07). No topic — the
    // connector only accepts topics on group chats. Creating a chat
    // that already exists returns the existing one, which is exactly
    // the idempotence the feature relies on.
    const r = (await MicrosoftTeamsService.CreateChat({
      members: target,
    })) as OpResult;
    const o = outcome(r);
    chatId = String(((r.data ?? {}) as { id?: unknown }).id ?? "");
    if (!o.ok) {
      log(`FAIL — CreateChat refused: ${o.why}`);
      return;
    }
    log(
      chatId !== ""
        ? "OK — CreateChat executed and returned the chat's id."
        : "FAIL — CreateChat answered OK but returned no chat id (the post leg cannot run)."
    );
    if (chatId === "") return;
  } catch (e) {
    log(`FAIL — CreateChat threw: ${trim(e)}`);
    return;
  }
  const html =
    "<p>This is LeanBoard's notification probe — a one-off test message. " +
    "Nothing is expected of you; sorry for the noise!</p>";
  // the flow UI's "Post in: Group chat" is the first candidate; some
  // surfaces name the location differently, so the probe measures
  let posted = false;
  for (const location of ["Group chat", "Chat"]) {
    try {
      const r = (await MicrosoftTeamsService.PostMessageToConversation(
        { recipient: chatId, messageBody: html },
        "User",
        location
      )) as OpResult;
      const o = outcome(r);
      if (o.ok) {
        log(`OK — message posted (poster "User", location "${location}"). Ask ${target} to confirm it arrived.`);
        posted = true;
        break;
      }
      log(`INFO — location "${location}" refused: ${o.why.slice(0, 160)}`);
    } catch (e) {
      log(`INFO — location "${location}" threw: ${trim(e)}`);
    }
  }
  if (!posted) {
    log("FAIL — no location value landed the post. The chat exists but the message shape needs a different recipe — send me these lines.");
    return;
  }

  // ---- leg 3: the Adaptive Card (N2 rides it when it lands) ------------
  // The card body is dynamic in the swagger, so both plausible
  // carriages are measured: the card JSON as a STRING, then as an
  // OBJECT. The feature falls back to plain text when neither lands.
  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.2",
    body: [
      { type: "TextBlock", text: "LeanBoard notification probe", weight: "Bolder", wrap: true },
      { type: "TextBlock", text: "A card test — nothing is expected of you.", wrap: true },
    ],
    actions: [
      { type: "Action.OpenUrl", title: "Open in LeanBoard", url: "https://apps.powerapps.com" },
    ],
  };
  for (const [how, messageBody] of [
    ["string", JSON.stringify(card)],
    ["object", card],
  ] as const) {
    try {
      const r = (await MicrosoftTeamsService.PostCardToConversation(
        { recipient: chatId, messageBody } as Record<string, unknown>,
        "User",
        "Group chat"
      )) as OpResult;
      const o = outcome(r);
      if (o.ok) {
        log(`OK — Adaptive Card posted (card carried as ${how}). Check it renders with its Open button.`);
        return;
      }
      log(`INFO — card as ${how} refused: ${o.why.slice(0, 160)}`);
    } catch (e) {
      log(`INFO — card as ${how} threw: ${trim(e)}`);
    }
  }
  log("INFO — the Adaptive Card did not land in either carriage; notifications will use plain Teams messages (which DID land).");
}

const trim = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);
