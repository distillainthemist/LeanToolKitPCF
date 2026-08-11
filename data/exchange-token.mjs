// Re-scope a device-code sign-in to a sibling resource (admin scripting —
// e.g. the Dataverse token's refresh_token exchanged for a Graph or
// SharePoint token, without a second sign-in). The companion to
// get-token.mjs: same first-party Azure CLI client, same rule that token
// files live OUTSIDE the repo (a temp dir) with owner-only mode.
//
// Usage: node data/exchange-token.mjs <resource-url> <in-token-file> <out-token-file>

import { readFileSync, writeFileSync } from "node:fs";

const CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46"; // Azure CLI (first party)
const AUTHORITY = "https://login.microsoftonline.com/organizations";

const [resource, inFile, outFile] = process.argv.slice(2);
if (!resource || !inFile || !outFile) {
  console.error("usage: node data/exchange-token.mjs <resource-url> <in-token-file> <out-token-file>");
  process.exit(1);
}

const prior = JSON.parse(readFileSync(inFile, "utf8"));
if (!prior.refresh_token) {
  console.error("the input token file carries no refresh_token");
  process.exit(1);
}

const res = await fetch(`${AUTHORITY}/oauth2/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: prior.refresh_token,
    resource: resource.replace(/\/$/, ""),
  }).toString(),
});
const json = await res.json();
if (!json.access_token) {
  console.error("exchange failed:", json.error, json.error_description?.slice(0, 200));
  process.exit(1);
}
writeFileSync(outFile, JSON.stringify(json), { mode: 0o600 });
console.log(`token for ${resource} written to ${outFile}`);
