# Deploying LeanToolKit to a new organisation

One managed solution carries everything: the eight Dataverse tables,
the code app itself, and its Office 365 Users connection reference.
Every GitHub release (v0.x.y tag) attaches
**`LeanToolKitData_<tag>_managed.zip`** alongside the PCF solution zips.

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

1. Import `LeanToolKitData_<tag>_managed.zip` (maker portal →
   Solutions → Import, or `pac solution import`).
2. When prompted for the **Office 365 Users connection reference**,
   bind it to a connection in the target environment (create one on
   the spot if none exists — it powers Entra people search).
3. Share the LeanToolKit app with users. On first open each user
   approves the connection once; the card catalog self-seeds; People
   admin builds the roster.

Updates are the same import — managed upgrades apply tables and the
app in place, and all data (boards, meetings, cards, actions, people)
lives in the tables, untouched by app updates.

## Fallback: pac CLI install (no solution import for the app)

Releases also attach **`LeanToolKitApp_<tag>.zip`** (built bundle +
templated `power.config.json`). If importing the app via solution is
ever blocked, the app can be pushed directly:

```sh
pac auth create --deviceCode          # maker in the target environment
pac solution import --path LeanToolKitData_<tag>_managed.zip
# unzip LeanToolKitApp_<tag>.zip, set environmentId + the O365
# connection id in power.config.json, then:
pac code push
```

The pushed app is identical; it just lives outside the solution until
someone does the portal Add-existing step there.
