# Document-control notifications — design of record

**Intent (Ben, 2026-08-07):** when someone completes a document-control
step, they are presented the option to send a Teams message (preferred)
or an email (alternative) to the next person(s) in the chain — politely,
with context (what was just done, what the recipient needs to do), and a
permalink that opens the app on that document's overlay so they can act.

Both standard connections (Office 365 Outlook, Microsoft Teams) already
exist in the environment. Nothing sends automatically and nothing sends
silently: the actor sees recipients and message before anything goes,
and every message is sent **as the acting user** — no service account,
honest provenance, and the recipient can simply reply.

## The moments and their recipients

Each lifecycle done-state knows the document, the actor and the stage it
just moved to — the "next person(s)" derive from the same columns the
gates already read (RLDAS person emails; `grantEmails` for revision
editors). Recipients are shown as a prefilled, editable to-line.

| Step just completed | Next actor(s) prefilled | Message gist |
| --- | --- | --- |
| Submit for review | Reviewers | "…submitted *X* for review — please review it." |
| Submit for approval → awaiting approval | Approvers | "…submitted *X* for approval — please review and approve." |
| Submit for approval → awaiting owner approval | Owner | "…submitted *X* — it needs your final approval." |
| Approve (endorsement) | Owner | "…endorsed *X* — it now needs your final approval." |
| Approve (final) | Reviewers + approvers (courtesy) | "*X* is now approved and published." |
| Request revision | Owner + revision editors | "…requested a revision of *X*: ‹reason›. Please pick it up." |
| Mark superseded / obsolete / reinstate | Owner (when actor is a controller) | "…marked *X* superseded: ‹reason›." |
| **5G**: request edit access | Document owner(s) | "…asked for edit access to *X*: ‹reason›. Approve or decline in LeanBoard." |
| **5G**: access granted / declined | Requester | "…granted you edit access to *X* — you can start the revision." |

Rules:
- The actor is never their own recipient (self rows drop out).
- A step with no derivable next actor (e.g. final approval of a document
  with no reviewers/approvers) simply shows no notify panel.
- The typed reason (request revision, retirement) rides into the message
  — the context IS the reason.

## The task permalink (not the kiosk)

The existing `ltkdoc` link opens the chrome-free kiosk — pure preview,
no actions — which is wrong for "come do your step." Notifications need
a **work link**: full app, Documents screen, the document's overlay
open with details expanded and the lifecycle buttons live.

Design: the notification link carries `ltkdoc=<listId:itemId>&ltkmode=work`.
`launchTarget` routes `work` mode to the hub (`#/`) like a docview link;
the Documents screen consumes the pending doc on mount and calls the
existing `onRowOpen(row, {details: true})`. The kiosk route is untouched
— mode absent keeps today's behaviour, so printed QR codes never change
meaning. Link is the https player URL (recipients are at a desk when
they act on approvals; the mobile ms-apps variant stays a share-dialog
concern).

## The notify panel (UX)

Lives in the **done-state** of the existing command dialogs (the moment
that already relabels Cancel → Close). After the write verifies:

- "Let the next step know" section with:
  - recipient line — prefilled chips, removable; an add field
    restricted to the pool picker where the pool applies;
  - message — a prefilled, editable multiline text (polite template per
    the table above, link appended automatically);
  - buttons: **Send Teams message** (primary), **Send email**
    (secondary), and Close (skips — sending is never required).
- One send per action; after a successful send the panel collapses to
  "✓ Sent to N people" and Close remains.
- Send failures report per-recipient and honestly (a declined consent
  or missing licence names itself); the document write ALREADY
  SUCCEEDED and the dialog must keep saying so — notification failure
  never reads as command failure.

## Transport

Same executeAsync door as the SharePoint connector, so N0 measures it
before any feature code:

- **Email**: Office 365 Outlook `SendEmailV2` (to, subject, HTML body).
  One call; body carries the message + a link.
- **Teams (preferred)**: two-step — `CreateAChat` with the recipients
  (1:1 or group chat; creating an existing chat returns the existing
  one — idempotent) then `PostMessageToConversation` (poster: user,
  location: the chat id) with an HTML body. Multi-recipient = ONE group
  chat, not N separate chats — the follow-up conversation is the point.
- Both connectors are added to the code app as data sources
  (`pac code add-data-source`), generated services imported lazily from
  the docs chunk only (import-gate rule: no static chain from the board
  path).

## N0 build notes (2026-08-08)

- Data sources added: `shared_office365` (connection ab0bb…) and
  `shared_teams` (connection 40277…) via `pac code add-data-source`.
- **Generator gotcha**: pac emits the Teams "sections" operations with a
  literal `If-Match` parameter identifier — invalid TypeScript, breaks
  tsc. Sanitized by hand (argument renamed `ifMatch`, wire key kept as
  a quoted `"If-Match"` property). ANY re-run of add-data-source for
  shared_teams regenerates the file and reintroduces it — re-apply the
  same fix.
- Import gate extended: `shared_teams` + `shared_office365` join
  SharePoint as docs-only services (Users/Groups stay board-side for
  the roster). Probe chunk is lazy (~72 kB, loads on button click);
  board closure unchanged.
- Generated wrappers carry everything the design needs: `SendEmailV2`
  (To/Subject/HTML Body, semicolon-separated addresses), `CreateChat`
  ({members: "a;b", topic — group chats only}), and
  `PostMessageToConversation(body, poster, location)` whose body shape
  is dynamic in the swagger — the probe tries
  `{recipient: chatId, messageBody: html}` against location values
  "Group chat" then "Chat" and reports which lands.

**Probe measurements (Ben, hosted):**
- Email leg GREEN first run: SendEmailV2 executes, HTML body lands,
  the anchor renders clickable — permalinks can ride emails.
- `CreateChat` members = the OTHER participants ONLY. The connector
  adds the caller itself; including your own address is refused with
  BadRequest "Duplicate chat members is specified in the request body"
  (measured 2026-08-07). Feature code must always self-filter.

## Build plan

- **N0 — transport probe.** Add both data sources; a "Notification
  probe" in Settings → My profile (any user): send an email to
  YOURSELF; create a chat with a typed colleague (default: none — the
  Teams leg is skipped unless a target is given, so the probe never
  spams) and post one line; report status-only (no message bodies, no
  ids). Measures: do the operations execute through executeAsync, which
  parameter shapes land, does chat-creation dedupe. Ben runs hosted.
- **N1 — the work link. (BUILT 2026-08-08)** `ltkmode=work` routing
  (own pending slot beside the kiosk's; unknown mode values fall back
  to the kiosk so old links never break) + hub fronts Documents on the
  work slot + docsScreen resolves the row (idIn query, soft errors
  NAMED in the status line, not painted as "gone") and calls
  `onRowOpen({details: true})` AFTER readStatusTerms so the lifecycle
  commands see the mapped vocabulary. `docLinkUrlWork` builds the URL.
  4 unit tests on the routing.
- **N2 — the notify panel. (BUILT 2026-08-08)** notifyModel.ts (pure,
  10 tests): notifyPlanFor per command with the resolved target stage,
  self-filter + email-dedupe + empty→null; escapeHtml/notifyEmailHtml/
  notifyCard (Adaptive Card v1.2 — Ben's ask; TEAMS ONLY, Outlook
  actionable messages need per-sender registration so email stays
  HTML). notify.ts (transport, own lazy chunk behind a send click):
  sendNotifyEmail = one SendEmailV2 to all; sendNotifyTeams = one
  CreateChat (recipients only — the caller is seated by the connector;
  topic on group chats) → PostCardToConversation card-first (string
  then object carriage) → plain-message fallback (both locations) —
  outcome reports WHICH landed. Panel in openLifecycleCommand's
  done-state: relabels Close, chips removable, dialog-added reviewers
  join the prefill, typed reason appended to the editable message,
  send failure reports in its own line and NEVER reads as command
  failure. Probe gained a card leg (both carriages, logged).
- **N3 — 5G notifications. (BUILT 2026-08-08)** The panel extracted to
  notifyPanel.ts (one builder for every done-state; lifecycleCmds
  refactored onto it); accessRequestPlan in notifyModel (requested →
  owners "approve or decline from My tasks"; granted → requester "you
  can start the revision now" with the work link landing on Start
  revision; declined → requester, typed reason riding in). Wired into
  openRequestAccess (fresh send), openApproveRequest (both the clean
  and the warned done-states — the grant DID land) and
  openDeclineRequest. 2 more tests.

Each step gated on Ben's hosted verification before the next, per
standing practice. Release after N2 (N3 can ride the same release if
verification is quick).

## Honest limits (stated up front)

- Sending as the user means a recipient sees the message from a person,
  not "LeanBoard" — by design, but it also means the ACTOR's Teams/
  Outlook licence and consent are what the send runs on; first use per
  user may prompt connection consent in the player.
- No scheduled/reminder sends here — at-action only. (Reminder push
  was briefly a cookbook add-on; removed by decision 2026-08-08 —
  rituals and reporting are the review mechanism, full stop.)
- No read-tracking; "did they see it" is Teams/Outlook's domain.
