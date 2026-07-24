# Deploying LeanBoard to a new organisation

One managed solution carries everything: the eight Dataverse tables,
the **LeanBoard User security role**, the code app itself, and its
Office 365 Users connection reference. Every GitHub release (v0.x.y
tag) attaches **`LeanBoard_<tag>_managed.zip`** alongside the PCF
solution zips.

How the app rides along: code apps live in the Power Apps service and
gain a Dataverse `canvasapp` row (type 4) only when **added to a
solution in the maker portal** (Solutions → LeanToolKitData → Add
existing → App). That registration was done 2026-07-18 and persists —
every subsequent `pac code push` updates the same app, and every
export snapshots the latest pushed bundle. Note `pac code push
--solutionName` does NOT perform this registration (verified inert);
the portal add is the one-time bridge.

## Prerequisites in the target organisation

1. A Dataverse environment, and someone with maker/admin rights in it.
2. **Power Apps Code Apps enabled**: Power Platform admin centre →
   environment → Settings → Product → Features → "Power Apps Code
   Apps" → On (allow ~20–25 minutes to propagate).
3. Users need Power Apps premium licences (code apps requirement).

## Install / update steps

1. Import `LeanBoard_<tag>_managed.zip` (maker portal →
   Solutions → Import, or `pac solution import`).
2. When prompted for the **Office 365 Users and Office 365 Groups
   connection references**, bind each to a connection in the target
   environment (create them on the spot if none exist — Users powers
   Entra people search; Groups powers the access-control group sync).
3. **Assign the "LeanBoard User" security role** to everyone who will
   use the app (Power Platform admin centre → environment → Users, or
   better: map an Entra group to a Dataverse group team and give the
   team the role — then app access is just group membership). The app
   can then manage that group's membership itself: a super admin picks
   a Microsoft group they own under Settings → Users → Access control
   (security or security-enabled M365), and from then on people added
   to the roster join the group automatically, super/site admins also
   become owners, revoking removes them, and Sync now reconciles. The
   group-team mapping and app sharing remain this one-time admin step.
   The app runs in each user's own security context, so without the
   role every Dataverse call fails. The role grants create/read/write/
   append on the eight app tables at organisation level, plus delete
   on Card Data only (the reset-meeting feature reseeds those rows).
   App-level roles (super admin / site admin / user) and meeting
   confidentiality are enforced by the app on top of this — the
   Dataverse role is deliberately flat.
4. Share the LeanBoard app with users. On first open each user
   approves the connection once; the card catalog self-seeds; People
   admin builds the roster.
5. **(Only if boards use Embed cards)** Allowlist the embedded domains
   in the environment's **code-app CSP**. Code apps default `frame-src`
   to `'self'`, so every external embed shows *"This content is
   blocked"* until the admin adds the origin: Admin Center →
   Environments → *(env)* → Settings → Product → Privacy + Security →
   Content security policy → **App** tab → `frame-src` → add e.g.
   `https://app.powerbi.com` (+ `https://ms-pbi.pbi.microsoft.com` for
   Power BI). Per environment, admin-only. See
   [docs/controls/EmbedCard.md](controls/EmbedCard.md) for the two
   framing barriers.

Updates are the same import — managed upgrades apply tables, the role
and the app in place, and all data (boards, meetings, cards, actions,
people) lives in the tables, untouched by app updates.

## Fallback: pac CLI install (no solution import for the app)

Releases also attach **`LeanBoardApp_<tag>.zip`** (built bundle +
templated `power.config.json`). If importing the app via solution is
ever blocked, the app can be pushed directly:

```sh
pac auth create --deviceCode          # maker in the target environment
pac solution import --path LeanBoard_<tag>_managed.zip
# unzip LeanBoardApp_<tag>.zip, set environmentId + the O365
# connection id in power.config.json, then:
pac code push
```

The pushed app is identical; it just lives outside the solution until
someone does the portal Add-existing step there.
