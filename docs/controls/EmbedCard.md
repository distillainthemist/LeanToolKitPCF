# EmbedCard (`EmbedCard`)

Shows an embedded page — a **Power BI report** or any https embed link — with
a **refresh button**. The frame is created once and never reloads on resize,
theme changes or unrelated re-renders; it only navigates when the embed url
genuinely changes, when ⟳ is pressed, or when **Refresh Trigger** changes
value.

- **Schema id:** — (display-only: no document)
- **Document:** ✖ · **Actions:** ✖ · **Snapshots:** ✖ (a cross-origin iframe
  cannot be captured, so `pngExport`/`svgExport` are deliberately absent)

## Inputs

| Input | Settings key | Notes |
| --- | --- | --- |
| `embedUrl` | `config.embedUrl` | The page to embed. http/https only — a schemeless url is treated as https; any other scheme (e.g. `javascript:`) is refused and the empty state shows instead. |
| `refreshTrigger` | — | Reloads the frame whenever the value **changes** (e.g. `Set(varRefresh, Text(Now()))`), same convention as `resetTrigger` elsewhere. |
| `hideFilterPane` | `config.hideFilterPane` | Power BI links only: appends `filterPaneEnabled=false`. Ignored for other urls. |
| `hidePageNav` | `config.hidePageNav` | Power BI links only: appends `navContentPaneEnabled=false`. Ignored for other urls. |
| `pageName` | `config.pageName` | Power BI links only: opens the report on this page (the `ReportSection…` id visible in the page url). |
| `readOnly` | `readOnly` | Hides the refresh button. The embedded page itself is unaffected. |

Plus the standard chrome/styling surface (`cardTitle`, `prompts` as the
empty-state text, theme colours, font, `settingsJSON`).

A url is recognised as Power BI when its host is `powerbi.com` /
`*.powerbi.com` (also `.powerbi.cn`, `.powerbigov.us`). Parameters already in
the pasted link are respected — the toggles only set their own keys.

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

## No outputs

This card emits nothing: no `outputJSON`, no actions channel, no snapshots.
It is a display surface — pair it with capture cards on the same board.
