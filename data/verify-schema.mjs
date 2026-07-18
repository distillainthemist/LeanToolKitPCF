// Read-back verification for deploy-schema.mjs: every table + its keys,
// and the LeanToolKitData solution's component count.
//
// Usage: node data/verify-schema.mjs <env-url> <token-file>

import { readFileSync } from "node:fs";
import { TABLES } from "./schema.mjs";

const [envUrl, tokenFile] = process.argv.slice(2);
const t = JSON.parse(readFileSync(tokenFile, "utf8")).access_token;
const api = `${envUrl.replace(/\/$/, "")}/api/data/v9.2`;
const get = async (p) => {
  const res = await fetch(`${api}/${p}`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${p} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

for (const table of TABLES) {
  const d = await get(`EntityDefinitions(LogicalName='${table.logical}')?$select=LogicalName,EntitySetName`);
  const keys = await get(`EntityDefinitions(LogicalName='${table.logical}')/Keys?$select=SchemaName`);
  console.log(`${table.logical} ok  set=${d.EntitySetName}  keys=[${keys.value.map((k) => k.SchemaName).join(",")}]`);
}
const sol = await get("solutions?$select=solutionid,uniquename,version&$filter=uniquename eq 'LeanToolKitData'");
console.log("solution:", sol.value[0]?.uniquename, sol.value[0]?.version);
const comps = await get(`solutioncomponents?$select=componenttype&$filter=_solutionid_value eq ${sol.value[0].solutionid}`);
console.log("solution components:", comps.value.length);
