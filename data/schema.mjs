// LeanToolKit Data — declarative schema (the source of truth the deployer
// applies to Dataverse). Eight tables per docs/master-leanboard.md +
// docs/actions-dataverse.md + docs/code-app-plan.md. Publisher prefix
// "ben", all organization-owned, all created inside the LeanToolKitData
// solution so environments receive them by (managed) solution import.
//
// Column kinds: text {max}, memo {max}, bool, dateonly, datetime.
// key: alternate-key column list. lookups are declared separately (they
// become 1:N relationships).

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
      ben_occurrencesettings: { ...memo(10000), display: "Occurrence Settings (JSON)" },
      ben_peoplejson: { ...memo(100000), display: "People (JSON)" },
      ben_manifestjson: { ...memo(1048576), display: "Manifest (JSON)" },
      ben_istemplate: { kind: "bool", display: "Is Template" },
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
      ben_departments: { ...memo(10000), display: "Departments (JSON)" },
      ben_protectedtimes: { ...memo(10000), display: "Protected Times (JSON)" },
    },
    key: ["ben_site"],
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
];
