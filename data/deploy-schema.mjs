// Applies data/schema.mjs to a Dataverse environment via the Web API —
// idempotent (safe to re-run; only missing pieces are created), and every
// component is created inside the LeanToolKitData solution so downstream
// environments receive schema by (managed) solution import.
//
// Usage:
//   node data/get-token.mjs <env-url> <token-file>   # device-code sign-in
//   node data/deploy-schema.mjs <env-url> <token-file>

import { readFileSync } from "node:fs";
import { LOOKUPS, PUBLISHER, SOLUTION, TABLES } from "./schema.mjs";

const [envUrl, tokenFile] = process.argv.slice(2);
if (!envUrl || !tokenFile) {
  console.error("usage: node data/deploy-schema.mjs <env-url> <token-file>");
  process.exit(1);
}
const API = `${envUrl.replace(/\/$/, "")}/api/data/v9.2`;
const token = JSON.parse(readFileSync(tokenFile, "utf8")).access_token;

const label = (text) => ({
  "@odata.type": "Microsoft.Dynamics.CRM.Label",
  LocalizedLabels: [
    { "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: text, LanguageCode: 1033 },
  ],
});

async function call(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json",
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 600)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const inSolution = { "MSCRM.SolutionUniqueName": SOLUTION.uniquename };

function attributeMetadata(logical, def) {
  const schema = logical; // lower-case schema names keep logical == schema
  const base = {
    SchemaName: schema,
    DisplayName: label(def.display),
    RequiredLevel: { Value: def.required ? "ApplicationRequired" : "None" },
  };
  if (def.kind === "text") {
    return {
      ...base,
      "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
      MaxLength: def.max,
      FormatName: { Value: "Text" },
    };
  }
  if (def.kind === "memo") {
    return {
      ...base,
      "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
      MaxLength: def.max,
    };
  }
  if (def.kind === "bool") {
    return {
      ...base,
      "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
      DefaultValue: def.default === true,
      OptionSet: {
        "@odata.type": "Microsoft.Dynamics.CRM.BooleanOptionSetMetadata",
        TrueOption: { Value: 1, Label: label("Yes") },
        FalseOption: { Value: 0, Label: label("No") },
      },
    };
  }
  if (def.kind === "dateonly" || def.kind === "datetime") {
    return {
      ...base,
      "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
      Format: def.kind === "dateonly" ? "DateOnly" : "DateAndTime",
      DateTimeBehavior: { Value: "TimeZoneIndependent" },
    };
  }
  if (def.kind === "file") {
    // U0 (2026-08-08): file columns carry bytes via the SDK's
    // uploadFileToRecord door, not as a record attribute
    return {
      ...base,
      "@odata.type": "Microsoft.Dynamics.CRM.FileAttributeMetadata",
      MaxSizeInKB: def.maxKB,
    };
  }
  throw new Error(`unknown column kind for ${logical}`);
}

async function ensurePublisher() {
  const q = await call(
    "GET",
    `publishers?$select=publisherid&$filter=customizationprefix eq '${PUBLISHER.prefix}'`
  );
  if (q.value?.length) {
    console.log(`publisher prefix '${PUBLISHER.prefix}' exists`);
    return q.value[0].publisherid;
  }
  const res = await fetch(`${API}/publishers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      uniquename: PUBLISHER.uniquename,
      friendlyname: PUBLISHER.friendlyname,
      customizationprefix: PUBLISHER.prefix,
      customizationoptionvalueprefix: PUBLISHER.optionValuePrefix,
    }),
  });
  if (!res.ok) throw new Error(`create publisher → ${res.status}: ${await res.text()}`);
  const created = await res.json();
  console.log("publisher created");
  return created.publisherid;
}

async function ensureSolution(publisherId) {
  const q = await call(
    "GET",
    `solutions?$select=solutionid&$filter=uniquename eq '${SOLUTION.uniquename}'`
  );
  if (q.value?.length) {
    console.log(`solution ${SOLUTION.uniquename} exists`);
    return;
  }
  await call("POST", "solutions", {
    uniquename: SOLUTION.uniquename,
    friendlyname: SOLUTION.friendlyname,
    version: SOLUTION.version,
    "publisherid@odata.bind": `/publishers(${publisherId})`,
  });
  console.log(`solution ${SOLUTION.uniquename} created`);
}

async function ensureTable(t) {
  const existing = await call(
    "GET",
    `EntityDefinitions(LogicalName='${t.logical}')?$select=LogicalName`
  );
  if (!existing.notFound) {
    console.log(`table ${t.logical} exists`);
    return;
  }
  await call(
    "POST",
    "EntityDefinitions",
    {
      "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
      SchemaName: t.schema,
      DisplayName: label(t.display),
      DisplayCollectionName: label(t.plural),
      Description: label(`LeanToolKit — ${t.display}`),
      OwnershipType: "OrganizationOwned",
      HasNotes: false,
      HasActivities: false,
      Attributes: [
        {
          "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
          SchemaName: "ben_name",
          IsPrimaryName: true,
          MaxLength: t.primaryNameMax,
          FormatName: { Value: "Text" },
          RequiredLevel: { Value: "None" },
          DisplayName: label("Name"),
        },
      ],
    },
    inSolution
  );
  console.log(`table ${t.logical} created`);
}

async function ensureColumn(t, logical, def) {
  const existing = await call(
    "GET",
    `EntityDefinitions(LogicalName='${t.logical}')/Attributes(LogicalName='${logical}')?$select=LogicalName`
  );
  if (!existing.notFound) return false;
  await call(
    "POST",
    `EntityDefinitions(LogicalName='${t.logical}')/Attributes`,
    attributeMetadata(logical, def),
    inSolution
  );
  console.log(`  column ${t.logical}.${logical} created`);
  return true;
}

async function ensureKey(t) {
  if (!t.key) return;
  const keyName = `${t.logical}_key`;
  const existing = await call(
    "GET",
    `EntityDefinitions(LogicalName='${t.logical}')/Keys?$select=SchemaName`
  );
  if (existing.value?.some((k) => k.SchemaName === keyName)) return;
  await call(
    "POST",
    `EntityDefinitions(LogicalName='${t.logical}')/Keys`,
    {
      SchemaName: keyName,
      DisplayName: label(`${t.display} key`),
      KeyAttributes: t.key,
    },
    inSolution
  );
  console.log(`  key ${keyName} created (${t.key.join(", ")})`);
}

async function ensureLookup(rel) {
  const q = await call(
    "GET",
    `RelationshipDefinitions/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?$select=SchemaName&$filter=SchemaName eq '${rel.schemaName}'`
  );
  if (q.value?.length) {
    console.log(`lookup ${rel.schemaName} exists`);
    return;
  }
  await call(
    "POST",
    "RelationshipDefinitions",
    {
      "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
      SchemaName: rel.schemaName,
      ReferencedEntity: rel.referenced,
      ReferencingEntity: rel.referencing,
      Lookup: {
        "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
        SchemaName: rel.lookupSchema,
        DisplayName: label(rel.display),
        RequiredLevel: { Value: "None" },
      },
    },
    inSolution
  );
  console.log(`lookup ${rel.schemaName} created`);
}

/**
 * Grant the LeanBoard User role this table's privileges at organisation
 * level — in the SAME run that creates the table, so the 2026-08-05
 * stale-role trap (new table, no privileges, silent empty reads) cannot
 * recur for tables that declare `role`. Tables without the flag are
 * untouched: their grants stay exactly as hand-authored.
 */
async function ensureRolePrivileges(t) {
  if (!t.role) return;
  const bu = await call(
    "GET",
    "businessunits?$select=businessunitid&$filter=_parentbusinessunitid_value eq null"
  );
  const buId = bu.value[0].businessunitid;
  const roles = await call(
    "GET",
    `roles?$select=roleid&$filter=name eq 'LeanBoard User' and _businessunitid_value eq ${buId}`
  );
  if (!roles.value?.length) {
    throw new Error("role 'LeanBoard User' not found in the root business unit");
  }
  const ops = ["Create", "Read", "Write", "Append", "AppendTo"];
  if (t.role.delete === true) ops.push("Delete");
  const privileges = [];
  for (const op of ops) {
    const name = `prv${op}${t.logical}`;
    const p = await call("GET", `privileges?$select=privilegeid&$filter=name eq '${name}'`);
    if (!p.value?.length) throw new Error(`privilege ${name} not found`);
    privileges.push({
      Depth: "Global",
      PrivilegeId: p.value[0].privilegeid,
      BusinessUnitId: buId,
      PrivilegeName: name,
    });
  }
  try {
    await call(`POST`, `roles(${roles.value[0].roleid})/Microsoft.Dynamics.CRM.AddPrivilegesRole`, {
      Privileges: privileges,
    });
    console.log(`  role privileges granted on ${t.logical} (${ops.join("/")}, org level)`);
  } catch (e) {
    // idempotence: an already-granted privilege refuses — that IS the
    // desired end state
    if (/already exist|duplicate/i.test(String(e.message))) {
      console.log(`  role privileges on ${t.logical}: already present`);
    } else {
      throw e;
    }
  }
}

const publisherId = await ensurePublisher();
await ensureSolution(publisherId);
for (const t of TABLES) {
  await ensureTable(t);
  for (const [logical, def] of Object.entries(t.columns)) {
    await ensureColumn(t, logical, def);
  }
  await ensureKey(t);
  await ensureRolePrivileges(t);
}
for (const rel of LOOKUPS) {
  await ensureLookup(rel);
}
console.log("schema deploy complete");
