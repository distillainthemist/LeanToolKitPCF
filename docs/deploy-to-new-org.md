# Deploying LeanToolKit to a new organisation

Every GitHub release (v0.x.y tag) carries two LeanToolKit board-app
artifacts alongside the PCF solution zips:

- **`LeanToolKitData_<tag>_managed.zip`** — the eight Dataverse tables
  as a managed solution.
- **`LeanToolKitApp_<tag>.zip`** — the built code app + `power.config`
  + these instructions.

Code apps are **not** Dataverse solution components (verified 2026-07-18:
even a create-time `pac code push --solutionName` registers nothing
exportable), so the app cannot ride inside the managed zip — it is
pushed into the target environment with the pac CLI instead. That is a
one-time, five-minute step.

## Prerequisites in the target organisation

1. A Dataverse environment, and someone with maker/admin rights in it.
2. **Power Apps Code Apps enabled**: Power Platform admin centre →
   environment → Settings → Product → Features → "Power Apps Code
   Apps" → On. Allow **~20–25 minutes** to propagate (pushes 403 with
   `CodeAppOperationNotAllowedInEnvironment` until then).
3. pac CLI 2.9.3+ on the installing machine
   (`dotnet tool install --global Microsoft.PowerApps.CLI.Tool`).
4. Users need Power Apps premium licences (code apps requirement).

## Install steps

```sh
# 1. Sign in as a maker in the target environment
pac auth create --deviceCode
pac org who        # confirm the right environment

# 2. Import the tables
pac solution import --path LeanToolKitData_<tag>_managed.zip

# 3. Create an Office 365 Users connection (for Entra people search)
#    make.powerapps.com → Connections → + New connection →
#    Office 365 Users → Create, then note its id:
pac connection list

# 4. Unzip LeanToolKitApp_<tag>.zip and, inside that folder:
#    - edit power.config.json: set "environmentId" to the target
#      environment's GUID (pac org who shows it)
#    - rebind the connection: either run
#        pac code add-data-source -a shared_office365users -c <connection id>
#      or replace the GUID key under "connectionReferences" with the id.
# 5. Push the app (creates it; prints the play URL):
pac code push --solutionName LeanToolKitData
```

Then share the app with users from make.powerapps.com → Apps. On first
open each user approves the Office 365 Users connection once; the card
catalog self-seeds; People admin (Entra search or manual) builds the
roster.

## Updates

- **Tables**: import the newer `LeanToolKitData_*_managed.zip` (managed
  upgrades in place).
- **App**: in the unzipped newer app package, copy the previous
  `power.config.json`'s `appId`, `environmentId`, and
  `connectionReferences` over the template values, then
  `pac code push` — it updates the existing app in place (without the
  appId a push would collide on the display name).

## Notes

- The app is created **inside** the LeanToolKitData solution where the
  platform supports it; today that has no export effect (see above) but
  is forward-compatible if code-app solution ALM lands.
- All app data (boards, meetings, cards, actions, people) lives in the
  imported tables; the app itself is stateless and can be deleted and
  re-pushed at any time without data loss.
