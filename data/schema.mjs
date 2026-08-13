// LeanToolKit Data — declarative schema (the source of truth the deployer
// applies to Dataverse). Eight tables per docs/master-leanboard.md +
// docs/actions-dataverse.md + docs/code-app-plan.md. Publisher prefix
// "ben", all organization-owned, all created inside the LeanToolKitData
// solution so environments receive them by (managed) solution import.
//
// Column kinds: text {max}, memo {max}, bool, dateonly, datetime,
// file {maxKB}. key: alternate-key column list. lookups are declared
// separately (they become 1:N relationships).
//
// role: { delete: true|false } — the deployer also grants the LeanBoard
// User security role organisation-level Create/Read/Write/Append/
// AppendTo (+ Delete when asked) on that table, in whatever org it runs
// against. Declared HERE so a new table can never ship without its role
// privileges again (the 2026-08-05 stale-role trap: a table added after
// the role was authored ships with NO privileges, and the symptom is a
// silent empty read). Older tables keep their hand-authored grants —
// only tables that declare `role` are touched.

export const PUBLISHER = {
  uniquename: "benobrien",
  friendlyname: "Ben OBrien (Pechey Distilling)",
  prefix: "ben",
  optionValuePrefix: 68000,
};

export const SOLUTION = {
  uniquename: "LeanToolKitData",
  friendlyname: "LeanToolKit Data",
  version: "0.1.0",
};

const text = (max) => ({ kind: "text", max });
const memo = (max) => ({ kind: "memo", max });

export const TABLES = [
  {
    schema: "ben_LTKBoard",
    logical: "ben_ltkboard",
    display: "LTK Board",
    plural: "LTK Boards",
    primaryNameMax: 100,
    columns: {
      ben_boardid: { ...text(80), display: "Board Id", required: true },
      ben_boardkind: { ...text(20), display: "Board Kind" }, // meeting | project
      ben_category: { ...text(100), display: "Meeting category" },
      ben_occurrencesettings: { ...memo(10000), display: "Occurrence Settings (JSON)" },
      ben_peoplejson: { ...memo(100000), display: "People (JSON)" },
      ben_manifestjson: { ...memo(1048576), display: "Manifest (JSON)" },
      ben_istemplate: { kind: "bool", display: "Is Template" },
      ben_isarchived: { kind: "bool", display: "Archived", default: false },
      ben_site: { ...text(100), display: "Site" },
      ben_department: { ...text(100), display: "Department" },
    },
    key: ["ben_boardid"],
  },
  {
    schema: "ben_LTKBoardInstance",
    logical: "ben_ltkboardinstance",
    display: "LTK Board Instance",
    plural: "LTK Board Instances",
    primaryNameMax: 100,
    columns: {
      ben_boardid: { ...text(80), display: "Board Id" },
      ben_when: { kind: "datetime", display: "When" },
      ben_status: { ...text(20), display: "Status" }, // open | closed
      ben_settingsjson: { ...memo(100000), display: "Settings Snapshot (JSON)" },
      ben_isadhoc: { kind: "bool", display: "Ad hoc", default: false },
      ben_manifestjson: { ...memo(100000), display: "Instance board override (JSON)" },
    },
  },
  {
    schema: "ben_LTKCardData",
    logical: "ben_ltkcarddata",
    display: "LTK Card Data",
    plural: "LTK Card Datas",
    primaryNameMax: 100,
    columns: {
      // Instance lookup is declared in LOOKUPS; blank instance + boardid =
      // a shared card's live row (see master-leanboard.md)
      ben_boardid: { ...text(80), display: "Board Id" },
      ben_cardid: { ...text(80), display: "Card Id", required: true },
      ben_cardtype: { ...text(40), display: "Card Type" },
      ben_outputjson: { ...memo(1048576), display: "Output (JSON)" },
      ben_tilesvg: { ...memo(200000), display: "Tile SVG" },
    },
  },
  {
    schema: "ben_LTKCardCatalog",
    logical: "ben_ltkcardcatalog",
    display: "LTK Card Catalog",
    plural: "LTK Card Catalogs",
    primaryNameMax: 100,
    columns: {
      ben_cardtype: { ...text(40), display: "Card Type", required: true },
      ben_label: { ...text(100), display: "Label" },
      ben_description: { ...text(400), display: "Description" },
      ben_defaultsvg: { ...memo(200000), display: "Default Tile SVG" },
      ben_solutionversion: { ...text(20), display: "Solution Version" },
    },
    key: ["ben_cardtype"],
  },
  {
    // Column-for-column per docs/actions-dataverse.md (+ ben_boardid)
    schema: "ben_LTKAction",
    logical: "ben_ltkaction",
    display: "LTK Action",
    plural: "LTK Actions",
    primaryNameMax: 300,
    columns: {
      ben_actionid: { ...text(40), display: "Action Id", required: true },
      ben_instanceid: { ...text(80), display: "Instance Id" },
      ben_boardid: { ...text(80), display: "Board Id" },
      ben_issue: { ...text(400), display: "Issue" },
      ben_description: { ...memo(4000), display: "Description" },
      ben_assigneesjson: { ...memo(10000), display: "Assignees (JSON)" },
      ben_start: { kind: "dateonly", display: "Start" },
      ben_due: { kind: "dateonly", display: "Due" },
      ben_status: { ...text(20), display: "Status" },
      ben_commentsjson: { ...memo(100000), display: "Comments (JSON)" },
      ben_escalated: { kind: "bool", display: "Escalated" },
      ben_acknowledgedjson: { ...memo(2000), display: "Acknowledged (JSON)" },
      ben_source: { ...text(40), display: "Source" },
      ben_sourceid: { ...text(80), display: "Source Id" },
      ben_hint: { ...text(200), display: "Hint" },
    },
    key: ["ben_actionid"],
  },
  {
    // One row per site: its org subtree + protected time zones. The app
    // assembles orgJSON as [{site, departments}] across rows.
    schema: "ben_LTKSiteSettings",
    logical: "ben_ltksitesettings",
    display: "LTK Site Settings",
    plural: "LTK Site Settings",
    primaryNameMax: 100,
    columns: {
      ben_site: { ...text(100), display: "Site", required: true },
      ben_company: { ...text(100), display: "Company" },
      ben_departments: { ...memo(10000), display: "Departments (JSON)" },
      ben_protectedtimes: { ...memo(10000), display: "Protected Times (JSON)" },
      ben_timezone: { ...text(60), display: "Time zone (IANA)" },
      ben_accent: { ...text(20), display: "Accent colour" },
      ben_rosterpatterns: { ...memo(10000), display: "Roster Patterns (JSON)" },
      // [{key, label, color}] — the site state palette cards select from
      ben_statepalette: { ...memo(10000), display: "State palette (JSON)" },
      // [{key, label, color}] — title-strip association colours (branding)
      ben_titlepalette: { ...memo(10000), display: "Title palette (JSON)" },
      // app-level branding lives on the reserved "__app__" row
      ben_appname: { ...text(60), display: "App name (branding)" },
      ben_meetingcategories: { ...memo(4000), display: "Meeting categories (JSON)" },
      ben_companies: { ...memo(4000), display: "Companies (JSON)" },
      ben_accessgroup: { ...memo(2000), display: "Access group (JSON)" },
      ben_orgowners: { ...memo(20000), display: "Org owners (JSON)" },
      ben_logo: { ...memo(200000), display: "Logo (data URI)" },
    },
    key: ["ben_site"],
  },
  {
    // Rolling time-keyed card data (series cards: Conditions, SQDPC, KPI,
    // Pareto day-counts, StatusTile log). One row per datum; cards read a
    // date window derived from the meeting instance. See
    // docs/leanboard-card-series-plan.md.
    schema: "ben_LTKCardSeries",
    logical: "ben_ltkcardseries",
    display: "LTK Card Series",
    plural: "LTK Card Series",
    primaryNameMax: 200,
    columns: {
      ben_boardid: { ...text(80), display: "Board Id", required: true },
      ben_cardid: { ...text(80), display: "Card Id", required: true },
      ben_serieskey: { ...text(120), display: "Series Key", required: true },
      ben_date: { kind: "dateonly", display: "Date" },
      // "-" whole day/week, "D"/"N" shift halves. A sentinel, not blank:
      // Dataverse stores "" as null and null key columns break upserts.
      ben_shift: { ...text(4), display: "Shift (D/N, - = whole day)", required: true },
      ben_value: { ...text(400), display: "Value" },
      ben_valuejson: { ...memo(4000), display: "Value (JSON)" },
      ben_who: { ...text(80), display: "Who (Entra object id)" },
    },
    key: ["ben_boardid", "ben_cardid", "ben_serieskey", "ben_date", "ben_shift"],
  },
  {
    schema: "ben_LTKUserPrefs",
    logical: "ben_ltkuserprefs",
    display: "LTK User Prefs",
    plural: "LTK User Prefs",
    primaryNameMax: 100,
    columns: {
      ben_userid: { ...text(100), display: "User Id (whoId)", required: true },
      ben_preferences: { ...memo(4000), display: "Preferences (JSON)" },
      // Standard Documents (plan Phase 3) — the plan named a ben_ltkdocprefs
      // table, but this IS the per-user presentation-prefs table; two more
      // columns beat a whole new table + service. Presentation state only.
      ben_docfavoritesjson: { ...memo(100000), display: "Document favourites (JSON)" },
      ben_docviewsjson: { ...memo(100000), display: "Saved document views (JSON)" },
      // Vault design V1 (Ben, 2026-08-01: Dataverse over localStorage so
      // presentation state follows the person across devices): ticked
      // libraries, list/tiles, density, collapsed tree groups.
      ben_docuijson: { ...memo(20000), display: "Documents UI state (JSON)" },
    },
    key: ["ben_userid"],
  },
  {
    // The curated roster (the project's original people decision), fed by
    // Entra ID search in the app's People admin screen.
    schema: "ben_LTKPeople",
    logical: "ben_ltkpeople",
    display: "LTK Person",
    plural: "LTK People",
    primaryNameMax: 150,
    columns: {
      ben_whoid: { ...text(80), display: "Who Id (Entra object id)", required: true },
      ben_email: { ...text(200), display: "Email" },
      ben_crew: { ...text(20), display: "Crew" },
      ben_site: { ...text(100), display: "Site" },
      ben_department: { ...text(100), display: "Department" },
      ben_area: { ...text(100), display: "Area" },
      ben_role: { ...text(20), display: "Role (user|siteadmin|superadmin)" },
      ben_active: { kind: "bool", display: "Active", default: true },
    },
    key: ["ben_whoid"],
  },
  {
    // Standard Documents (docs/leanboard-standard-documents-plan.md,
    // Phase 1): one row per exposed SharePoint library. The reserved
    // ben_listid "__app__" row carries the app-level docs config (site
    // URL, term group / org term set) in its configjson — same pattern
    // as the sitesettings "__app__" branding row. Nothing here is
    // authoritative about a document: SharePoint columns are the record,
    // these rows only say how LeanBoard presents them.
    schema: "ben_LTKDocLibrary",
    logical: "ben_ltkdoclibrary",
    display: "LTK Doc Library",
    plural: "LTK Doc Libraries",
    primaryNameMax: 200,
    columns: {
      ben_listid: { ...text(80), display: "List Id (GUID; __app__ = app row)", required: true },
      ben_siteurl: { ...text(400), display: "Site URL" },
      ben_libtype: { ...text(20), display: "Type (standard|record|working|revision|template)" },
      ben_configjson: { ...memo(200000), display: "Library configuration (JSON)" },
    },
    key: ["ben_listid"],
  },
  {
    // Native-upload relay staging (doc-cards plan U0, 2026-08-08): the
    // app writes the picked file into ben_file; a deployment flow (the
    // cookbook's relay recipe) carries it on to SharePoint's staging
    // library and clears the row. Rows are TRANSIENT — anything old
    // here is a stalled relay, which is exactly what ben_status is for.
    schema: "ben_LTKUpload",
    logical: "ben_ltkupload",
    display: "LeanBoard Upload",
    plural: "LeanBoard Uploads",
    primaryNameMax: 300,
    columns: {
      ben_file: { kind: "file", maxKB: 32768, display: "File" },
      ben_targetlibrary: { ...text(200), display: "Target library" },
      ben_status: { ...text(20), display: "Status" },
    },
    // uploaders create rows and the probe (and users abandoning an
    // upload) delete their own — Delete is part of the contract
    role: { delete: true },
  },
  // ---- Issues (docs/leanboard-issues-plan.md, I0, 2026-08-12) ---------
  // In-app bug/idea reporting. Global read is a DECISION (Ben,
  // 2026-08-12): every user sees every issue, which powers
  // dedupe-at-source (+1 an existing report) and a known-issues
  // culture. Enum-ish columns follow the repo's text convention.
  {
    schema: "ben_LTKIssue",
    logical: "ben_ltkissue",
    display: "LeanBoard Issue",
    plural: "LeanBoard Issues",
    primaryNameMax: 300, // the reporter's one-liner IS the primary name
    columns: {
      ben_description: { ...memo(100000), display: "Description" },
      ben_kind: { ...text(10), display: "Kind (bug|idea)" },
      ben_area: { ...text(20), display: "Area (boards|cards|documents|settings|other)" },
      ben_status: {
        ...text(20),
        display: "Status (new|triaged|inprogress|done|declined|merged)",
      },
      ben_priority: { kind: "int", min: 0, max: 1000, display: "Priority (admin)" },
      ben_reporteremail: { ...text(200), display: "Reporter email" },
      ben_reportername: { ...text(200), display: "Reporter name" },
      ben_context: { ...memo(20000), display: "Context (JSON)" },
      ben_resolution: { ...memo(20000), display: "Resolution" },
    },
    // issues are never deleted — merged, done or declined; the row is
    // the audit trail
    role: { delete: false },
  },
  {
    // one row per attachment — pasted screenshots ride ben_file via the
    // SDK's uploadFileToRecord (the U0-proven road)
    schema: "ben_LTKIssueFile",
    logical: "ben_ltkissuefile",
    display: "LeanBoard Issue File",
    plural: "LeanBoard Issue Files",
    primaryNameMax: 300,
    columns: {
      ben_file: { kind: "file", maxKB: 8192, display: "File" },
      ben_caption: { ...text(300), display: "Caption" },
    },
    // a reporter removing their own screenshot before sending
    role: { delete: true },
  },
  {
    // the update thread; audience=internal rows never render in
    // reporter-facing surfaces
    schema: "ben_LTKIssueMessage",
    logical: "ben_ltkissuemessage",
    display: "LeanBoard Issue Message",
    plural: "LeanBoard Issue Messages",
    primaryNameMax: 300,
    columns: {
      ben_body: { ...memo(20000), display: "Body" },
      ben_authoremail: { ...text(200), display: "Author email" },
      ben_authorname: { ...text(200), display: "Author name" },
      ben_audience: { ...text(10), display: "Audience (reporter|internal)" },
    },
    role: { delete: false },
  },
  {
    // Governed hashtags (docs/leanboard-relationships-plan.md H1,
    // 2026-08-13): anyone proposes, document controllers approve —
    // approval CREATES the term in the Hashtags set (the 5F road), so
    // the term store never holds an unvetted label. Proposals are the
    // pending report; they are never deleted (the decision is the
    // record).
    schema: "ben_LTKTagProposal",
    logical: "ben_ltktagproposal",
    display: "LeanBoard Tag Proposal",
    plural: "LeanBoard Tag Proposals",
    primaryNameMax: 200, // the proposed label IS the primary name
    columns: {
      ben_note: { ...memo(4000), display: "Why this tag (proposer's note)" },
      ben_status: { ...text(10), display: "Status (pending|approved|declined)" },
      ben_proposeremail: { ...text(200), display: "Proposer email" },
      ben_proposername: { ...text(200), display: "Proposer name" },
      ben_decision: { ...memo(4000), display: "Decision note" },
      ben_termid: { ...text(40), display: "Created term id (on approve)" },
    },
    role: { delete: false },
  },
  {
    // +1/subscribe — the update fan-out audience beyond the reporter
    schema: "ben_LTKIssueWatch",
    logical: "ben_ltkissuewatch",
    display: "LeanBoard Issue Watch",
    plural: "LeanBoard Issue Watches",
    primaryNameMax: 300,
    columns: {
      ben_email: { ...text(200), display: "Watcher email" },
      ben_watchername: { ...text(200), display: "Watcher name" },
    },
    // un-+1 is a delete of your own watch row
    role: { delete: true },
  },
];

/** 1:N relationships (lookup column lives on the referencing table). */
export const LOOKUPS = [
  {
    schemaName: "ben_ltkboard_instances",
    referenced: "ben_ltkboard",
    referencing: "ben_ltkboardinstance",
    lookupSchema: "ben_Board",
    display: "Board",
  },
  {
    schemaName: "ben_ltkboardinstance_carddata",
    referenced: "ben_ltkboardinstance",
    referencing: "ben_ltkcarddata",
    lookupSchema: "ben_Instance",
    display: "Instance",
  },
  // ---- Issues (I0) ----------------------------------------------------
  {
    // merge target: a merged issue points at the issue it folded into
    schemaName: "ben_ltkissue_duplicates",
    referenced: "ben_ltkissue",
    referencing: "ben_ltkissue",
    lookupSchema: "ben_DuplicateOf",
    display: "Duplicate of",
  },
  {
    schemaName: "ben_ltkissue_files",
    referenced: "ben_ltkissue",
    referencing: "ben_ltkissuefile",
    lookupSchema: "ben_Issue",
    display: "Issue",
  },
  {
    schemaName: "ben_ltkissue_messages",
    referenced: "ben_ltkissue",
    referencing: "ben_ltkissuemessage",
    lookupSchema: "ben_Issue",
    display: "Issue",
  },
  {
    schemaName: "ben_ltkissue_watches",
    referenced: "ben_ltkissue",
    referencing: "ben_ltkissuewatch",
    lookupSchema: "ben_Issue",
    display: "Issue",
  },
];
