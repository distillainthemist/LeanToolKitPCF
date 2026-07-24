# EmbedCard (`EmbedCard`)

Shows an embedded page — a **Power BI report** or any https embed link — with
a **refresh button**. The frame is created once and never reloads on resize,
theme changes or unrelated re-renders; it only navigates when the embed url
genuinely changes, when ⟳ is pressed, or when **Refresh Trigger** changes
value.

- **Schema id:** `ltk/embednotes@1` (only when commentary headings are
  configured — otherwise nothing is edited and no document is written)
- **Document:** optional (the commentary notes) · **Actions:** ✔ (code app;
  card-level, on the pane or an Actions chip) · **Snapshots:** ✖ (a
  cross-origin iframe cannot be captured, so `pngExport`/`svgExport` are
  deliberately absent)

## Inputs

| Input | Settings key | Notes |
| --- | --- | --- |
| `embedUrl` | `config.embedUrl` | The page to embed. **You can paste a whole `<iframe …>` snippet** — the `src` is lifted out and `&amp;`-decoded (so the output of any *File → Share → Embed* button works as-is). http/https only — a schemeless url is treated as https; any other scheme (e.g. `javascript:`) is refused and the empty state shows instead. |
| `refreshTrigger` | — | Reloads the frame whenever the value **changes** (e.g. `Set(varRefresh, Text(Now()))`), same convention as `resetTrigger` elsewhere. |
| `hideFilterPane` | `config.hideFilterPane` | Power BI links only: appends `filterPaneEnabled=false`. Ignored for other urls. |
| `hidePageNav` | `config.hidePageNav` | Power BI links only: appends `navContentPaneEnabled=false`. Ignored for other urls. |
| `pageName` | `config.pageName` | Power BI links only: opens the report on this page (the `ReportSection…` id visible in the page url). |
| `commentaryHeadings` | `config.commentaryHeadings` | One heading per line. When set, a commentary pane appears beside the embed: a rich-text note (bold / italic / bullets) under each heading plus the card's actions list. Empty = no pane. |
| `disableActions` | `config.disableActions` | Hides the raise-action affordances; existing actions stay visible and completable. |
| `readOnly` | `readOnly` | Hides the refresh button and makes the commentary pane read-only. The embedded page itself is unaffected. |

Plus the standard chrome/styling surface (`cardTitle`, `prompts` as the
empty-state text, theme colours, font, `settingsJSON`).

A url is recognised as Power BI when its host is `powerbi.com` /
`*.powerbi.com` (also `.powerbi.cn`, `.powerbigov.us`). Parameters already in
the pasted link are respected — the toggles only set their own keys.

## "This content is blocked" / a blank frame — two barriers

An embed only appears if it clears **both** of these. They are independent,
and neither can be worked around from app code — an iframe cannot override
either one.

**1. The environment's code-app CSP (`frame-src`) must allow the domain.**
Power Apps **code apps** ship a strict Content-Security-Policy whose default
`frame-src` is `'self'` — so by default the app can only frame
`apps.powerapps.com`, and every external embed shows *"This content is
blocked. Contact the site owner to fix the issue."* This is set per
**environment**, not per app, and only an environment admin can change it:

> Power Platform Admin Center → **Environments** → *(the environment)* →
> **Settings** → **Product** → **Privacy + Security** → **Content security
> policy** → **App** tab → `frame-src` → add the origin(s) → **Save**.

For Power BI add `https://app.powerbi.com` (and `https://ms-pbi.pbi.microsoft.com`).
For any other site add its exact origin. See Microsoft's
[Configure CSP for Code Apps](https://learn.microsoft.com/en-us/power-apps/developer/code-apps/how-to/content-security-policy).

**2. The target site must not forbid framing.** A page that sends
`X-Frame-Options: DENY`/`SAMEORIGIN` or CSP `frame-ancestors 'none'` refuses
to be framed by anyone, and only *that site's* owner can change it. Most
public marketing sites do this (e.g. `www.pecheydistilling.com.au` sends
`frame-ancestors 'none'`), so they can never be embedded — the card's
**↗ open-in-new-tab** button is the answer for those. Power BI **secure
embed** links deliberately allow Microsoft/Power Apps hosts, so they pass
barrier 2 and only need barrier 1 lifted.

## Office documents (Excel / Word / PowerPoint)

Put the file in **SharePoint or OneDrive for Business**, open it in the
browser, and use **File → Share → Embed** — copy the whole `<iframe>` code
it gives you and paste it into the card. Viewers see it in place, signed in
with their own M365 account, and the file's own permissions are respected.
Allowlist your tenant host in `frame-src` (e.g.
`https://pecheydistilling.sharepoint.com`, and the `-my` host for OneDrive).

The card also rewrites a classic `…/_layouts/15/Doc.aspx?sourcedoc=…` link
to its read-only embed view (`action=embedview`) automatically. It does
**not** try to convert a modern short share link (`/:x:/r/…`) — that form
lacks the `UniqueId` the embed url needs, so use the *File → Share → Embed*
snippet for those. (Microsoft has reported `action=embedview` sometimes
still prompting a one-off sign-in inside the frame; the Embed snippet is the
most reliable path.)

`https://view.officeapps.live.com/op/embed.aspx?src=…` renders Office files
too, but only when the source file is at a **public, unauthenticated** url —
it can't reach tenant-protected storage. Use it only for genuinely public
documents.

## Embedding another Power App

Point the card at the app's play url:

- Code app: `https://apps.powerapps.com/play/e/{environmentId}/app/{appId}?tenantId={tenantId}`
- Canvas app: `https://apps.powerapps.com/play/{appId}?tenantId={tenantId}&source=iframe`

Two requirements, both admin-side:

1. Add `https://apps.powerapps.com` to this environment's code-app
   `frame-src` (barrier 1, as for any embed).
2. The **embedded** app must permit being framed by this app's origin —
   a code app's `frame-ancestors` defaults to `'self' https://*.powerapps.com`,
   so an apps.powerapps.com-hosted app is already allowed; a stricter inner
   CSP would need the origin added.

Caveats worth knowing: iframe embedding of Power Apps is **same-tenant users
only** (guests get a sign-in wall), and nesting one Power App inside another
is **not an officially supported pattern** — it works through the two
barriers above but may hit nested-auth edge cases, so test the specific pair
before relying on it. When in doubt, the **↗ open-in-new-tab** button gives a
clean full-screen launch instead.

## Which Power BI link to use

| Link type | Behaviour |
| --- | --- |
| **Secure embed** (File → Embed report → Website or portal) | Viewer signs in with their own M365 account; respects report permissions and RLS. On Safari/iOS and the Power Apps mobile app, third-party cookie blocking may require one "Sign in" click inside the frame per session. |
| **Publish to web** (`…/view?r=…`) | No sign-in, but **public to anyone with the link** — most organisations disable it. |

## What "refresh" means

Reloading the frame re-renders the report against the dataset **as it
currently stands in the Power BI service**:

- **DirectQuery / live-connection** datasets genuinely re-query on reload.
- **Import-mode** datasets only move when the dataset itself refreshes
  (schedule or REST API) — the button will not force that. Trigger the
  dataset refresh from Power Automate, then pulse `refreshTrigger` when it
  completes.

## Commentary & actions

With **Commentary headings** configured, a 300px pane appears beside the
frame: a rich-text note (bold / italic / bullet list, sanitized to that
whitelist — pasted markup is scrubbed before it touches the page) under each
heading, and the card's actions listed at the bottom with **＋ Add action**.
Notes are stored per heading in the card document; a heading removed from
config keeps its note in the document, so renaming it back restores the text.

Without headings the embed stays full width and actions ride an **Actions**
chip beside ⟳/↗ (hidden when there are none and raising is disabled).
Actions are card-level, land in the central actions table like every other
card's, and use the participants-first assignee picker. In a closed meeting
the pane is read-only. There are still no snapshot outputs — the board tile
stays the catalog art.
