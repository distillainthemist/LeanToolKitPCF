// Device-code sign-in for the Dataverse Web API (admin scripting — schema
// deploys, seeds). Uses the Microsoft first-party Azure CLI public client,
// so no app registration is needed. Writes {access_token, refresh_token}
// to the given file — keep that file OUT of the repo (a temp dir).
//
// Usage: node data/get-token.mjs <env-url> <token-file>

import { writeFileSync } from "node:fs";

const CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46"; // Azure CLI (first party)
const AUTHORITY = "https://login.microsoftonline.com/organizations";

const [envUrl, tokenFile] = process.argv.slice(2);
if (!envUrl || !tokenFile) {
  console.error("usage: node data/get-token.mjs <env-url> <token-file>");
  process.exit(1);
}
const scope = `${envUrl.replace(/\/$/, "")}/.default offline_access`;

const form = (o) => new URLSearchParams(o).toString();
const post = async (path, body) => {
  const res = await fetch(`${AUTHORITY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form(body),
  });
  return { status: res.status, json: await res.json() };
};

const dc = await post("/oauth2/v2.0/devicecode", { client_id: CLIENT_ID, scope });
if (!dc.json.device_code) {
  console.error("devicecode request failed:", dc.json);
  process.exit(1);
}
console.log(dc.json.message); // "To sign in, use ... enter the code ..."

const started = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, (dc.json.interval ?? 5) * 1000));
  const tok = await post("/oauth2/v2.0/token", {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: CLIENT_ID,
    device_code: dc.json.device_code,
  });
  if (tok.json.access_token) {
    writeFileSync(tokenFile, JSON.stringify(tok.json), { mode: 0o600 });
    console.log(`token written to ${tokenFile}`);
    process.exit(0);
  }
  if (tok.json.error !== "authorization_pending") {
    console.error("token error:", tok.json.error, tok.json.error_description?.slice(0, 200));
    process.exit(1);
  }
  if (Date.now() - started > (dc.json.expires_in ?? 900) * 1000) {
    console.error("device code expired");
    process.exit(1);
  }
}
