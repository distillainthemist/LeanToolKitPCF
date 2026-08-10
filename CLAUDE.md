# LeanToolKit — how to work in this repo

LeanBoard is a Power Apps **code app** (`app/`) plus retired PCF controls
(`controls/`, kept for the shared model code) and a declarative Dataverse
schema (`data/`). Ben's Power Apps identity is partnership@pecheydistilling.com;
his chat identity is ben@pecheydistilling.com.

## Toolchain

Node 22 via Homebrew — every shell needs:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

## Gates — run before any push or release

From `app/`:

```bash
npx tsc --noEmit
node tools/import-gate.mjs
npx vitest run
npm run build
node tools/chunk-report.mjs
```

If the change touched `shared/` or `controls/`, ALSO run `npm run typecheck`
at the **repo root** — the app-only tsc once missed a red CI for two releases.

The import gate enforces: the board path (main.ts, cardRegistry.ts,
screens/board.ts, screens/hub.ts) must not statically reach `src/docs/`;
the docs-only connectors (`shared_sharepointonline`, `shared_teams`,
`shared_office365`) are only importable from `src/docs/`. Dynamic `import()`
is the sanctioned door.

## Deploying to the dev environment for testing

```bash
cd app && pac code push
```

This is the ONLY way changes reach the hosted dev app. Rules learned the
hard way:

- `git push` does NOT deploy anything. Never tell Ben a change is testable
  until `pac code push` has actually run and its output says
  "App pushed successfully" — report from the command output, not intention.
- The player caches the bundle: after every push, Ben must **close and
  reopen the player** before testing.
- `pac` is already authenticated as partnership@pecheydistilling.com. If
  auth has expired, do not attempt an interactive login yourself — tell Ben,
  he runs `pac auth create` and completes the sign-in.

## Verification split

- Everything pure (model, parsing, grouping, date math) is verified by the
  vitest suite — add tests there.
- Hosted behaviour (SharePoint writes, connector responses, Dataverse,
  moderation, permissions) is **Ben's check in the player**. Hand him a
  short, concrete check list; never claim hosted behaviour verified.
- The in-app browser pane has no Power Apps session. Never enter or handle
  credentials there — or anywhere. Ben performs ALL sign-ins himself
  (browser sign-ins, device-code completions, MFA).

## Dataverse auth (device code) and schema deploys

Tokens come from `data/get-token.mjs` — a device-code flow using the Azure
CLI public client (04b07795-8ddb-461a-bbee-02f9e1bf7b46). Operating rules:

- Start the flow, give Ben the code/URL, and **Ben signs in** — never
  handle his credentials or MFA.
- Tokens live only in the session scratchpad (mode 0600, umask 077) —
  never in the repo, never printed to the transcript. The same applies to
  presigned URLs: probe output reports status/host/parameter names only.

Schema changes go through the repo's own apparatus — do NOT hand-write
ad-hoc Web API scripts (the established tools are also what the safety
tooling permits):

- `data/schema.mjs` — the declarative schema (tables, columns incl. `file`
  kind, role grants like `role: {delete: true}`).
- `data/deploy-schema.mjs` — idempotent deploy via the Dataverse Web API,
  stamping MSCRM.SolutionUniqueName=LeanToolKitData.

Use table **logical names** (`ben_ltkupload`) with pac commands, not
entity-set names. A schema change makes the next release SCHEMA-CARRYING:
prod then needs the managed LeanToolKitData solution imported, plus any
SharePoint site steps repeated (see docs/deploy-to-new-org.md).

## Releases

Only on Ben's explicit "cut the release":

```bash
./release.sh <x.y.z>
git push origin main --tags
```

The tag triggers the GitHub Actions Release workflow (builds the code-app
package, exports the managed LeanToolKitData solution, attaches both to a
GitHub Release). Watch it with `gh run list` / `gh run watch <id>`.
Version lives in the tag alone — nothing is stamped into files.

## Key docs

- docs/sharepoint-writes.md — the SP write cookbook (VULI vs connector
  patch, moderation, dates-in-locale vs ISO).
- docs/deployment-cookbook.md — adopted operational recipes.
- docs/deploy-to-new-org.md — full new-org/prod setup incl. permission
  levels and content-approval site steps.
- docs/leanboard-phase5-plan.md — the DMS lifecycle + date model record.
