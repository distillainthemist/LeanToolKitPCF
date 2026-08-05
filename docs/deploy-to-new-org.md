# Deploying LeanBoard to a new organisation

One managed solution carries everything: the app's Dataverse tables,
the **LeanBoard User security role**, the code app itself, and its
Office 365 Users connection reference. Every GitHub release (v0.x.y
tag) attaches **`LeanBoard_<tag>_managed.zip`**.

Releases from v0.12.1 onward no longer carry the `LeanToolKit_*.zip`
PCF controls solution — that target was retired and nothing here ever
needed it (the app mounts the card editors directly, and the controls
solution was never imported into any Pechey environment). See
[leanboard-pcf-retirement-plan.md](leanboard-pcf-retirement-plan.md).

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

## SharePoint prerequisites (only if using Standard Documents)

**Every managed metadata column must display the term LABEL, not the
path.** Site settings → Site columns → *(the column)* → Edit → **Display
value** → *Display term label in the field*. The alternative, *Display
the entire path to the term in the field*, silently breaks the folders
pane.

Measured in a production tenant 2026-08-03: folders were dead until the
setting was flipped — no app change, no re-push. It bites twice, because
the app matches on a term's **leaf label**:

- the folder tree's counts read every taxonomy value's `Label` and split
  it on `;` (`renderText` / `tallySubtreeCounts` in
  `app/src/docs/rows.ts`). A whole path is one blob that equals no
  node's label, so every folder counts zero;
- clicking a folder filters with CAML `<Eq>` on that leaf label
  (`termFilters`, same file). Against path text it matches nothing, so
  the register comes back empty.

Check it for every column the site dictionary maps to a role
(organisation, status, document type) — Settings → Documents →
Document columns lists them.

Since v0.29.0 the app checks itself: Settings → Documents → **Health**
samples a page from each library and warns *"<column> shows the whole
term path, not the term"* with this remedy in it, so a deployment that
gets this wrong says so instead of showing empty folders.

### The document access model (5G — controlled standards only)

Six groups run controlled-document access. Permissions are set ONCE per
group; the app never writes SharePoint permissions (it runs flow-free,
as the signed-in user):

| Group | Kind | Permission | Role |
| --- | --- | --- | --- |
| App access group | Entra security | app sharing | Who can open LeanBoard (the roster syncs it). |
| Document Controllers | Entra security | Full Control on the DMS site | Full document admin — merges with the app's super/site-admin roles. |
| Document Owners & Approvers | Entra security | Edit on the standards library | The eligibility POOL: owner/approver/reviewer pickers select from its members. Rights on a document come from being NAMED on it. |
| *(site)* DMSDocumentOwners | SharePoint site group | none | Holds ownership of the editors site group. Members: the two Entra groups above. |
| *(site)* DMSDocumentEditors | SharePoint site group | **Contribute on the standards library ONLY** (no site-level grant) | Grant approvals seat people here — membership takes effect **immediately** (measured 2026-08-06; the Entra route below propagates in minutes-to-an-hour). Settings: owner = DMSDocumentOwners, membership editable by *Group Owner*, viewable by *Everyone* (the app reads it). |
| Temporary Document Editors | Entra security | Contribute on the standards library | FALLBACK seat for tenants without the site group. Pool members must be seeded as its Entra OWNERS to execute grants. |
| General users | (the app access group) | Read on standards, templates and records; write on working libraries | Working libraries MUST stay writable — the working-document flows depend on it. |

Name the site editors group in **Settings → Access control → SharePoint
editors site group**; link the three Entra groups on the same tab. The
grant COLUMN ("Revision editors", a person-multi column on the standards
library mapped under Settings → Documents → Document columns) is the
AUTHORIZATION; group membership is only the physical ability — the app
gates off the column, and Settings → Documents → **Health** reports
drift in both directions (seats with no grant, grants with no seat).
**Access diagnostics** (Settings → My profile, any user) probes the
whole chain end to end.

## Install / update steps

1. Import `LeanBoard_<tag>_managed.zip` (maker portal →
   Solutions → Import, or `pac solution import`).
2. When prompted for the **Office 365 Users, Office 365 Groups and
   SharePoint connection references**, bind each to a connection in the
   target environment (create them on the spot if none exist — Users
   powers Entra people search; Groups powers the access-control group
   sync; SharePoint powers the Standard Documents area, running every
   call as the signed-in user so document visibility is exactly what
   SharePoint already grants them). An org not using Standard Documents
   still binds the reference; the app makes no SharePoint call until a
   super admin configures a site under Settings → Documents.
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
   append on ALL app tables at organisation level — including
   **ben_ltkdoclibrary** (Documents configuration) — plus delete on
   Card Data (the reset-meeting feature reseeds those rows) and on Card
   Series (unsetting a rating deletes its row).
   App-level roles (super admin / site admin / user) and meeting
   confidentiality are enforced by the app on top of this — the
   Dataverse role is deliberately flat.

   > **Trap (hit in production, 2026-08-05):** a table added AFTER the
   > role was authored ships with NO privileges on it unless the role
   > is updated in the DEV environment (the CI export's source) — a
   > role edited only in a downstream environment goes stale again at
   > the next import. The symptom is subtle because a denied read
   > resolves as an EMPTY result, not an error: a user missing read on
   > ben_ltkdoclibrary sees *"Standard documents haven't been set up
   > yet"* while everyone else sees documents fine. When a new table
   > lands in the solution, update the role beside it, in Dev.
4. Share the LeanBoard app with users. On first open each user
   approves the connection once; the card catalog self-seeds; People
   admin builds the roster.
5. **(Only if boards use Embed cards)** Allowlist the embedded domains
   in the environment's **code-app CSP**. Code apps default `frame-src`
   to `'self'`, so every external embed shows *"This content is
   blocked"* until the admin adds the origin: Admin Center →
   Environments → *(env)* → Settings → Product → Privacy + Security →
   Content security policy → **App** tab → `frame-src` → add the
   origins for whatever you embed. Per environment, admin-only:

   | Embedding | Add to `frame-src` |
   | --- | --- |
   | Power BI reports | `https://app.powerbi.com` `https://ms-pbi.pbi.microsoft.com` |
   | SharePoint / OneDrive Office docs | `https://<tenant>.sharepoint.com` `https://<tenant>-my.sharepoint.com` |
   | Public Office files (view.officeapps) | `https://view.officeapps.live.com` |
   | Another Power App | `https://apps.powerapps.com` |

   For an embedded **Power App**, the inner app must also allow being
   framed by this one — a code app's `frame-ancestors` already includes
   `https://*.powerapps.com`, so no change is usually needed; same-tenant
   users only. See [docs/controls/EmbedCard.md](controls/EmbedCard.md)
   for the two framing barriers.

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
