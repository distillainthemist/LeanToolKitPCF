// Access diagnostics (5G0) — measured answers to the two questions the
// request-edit-access build rests on, runnable by ANY signed-in user
// (that is the point: the interesting run is a NON-admin's):
//
//   1. Can this user write the app-side requests LEDGER? The ledger is
//      its own row (ben_listid "__requests__") in the doc-libraries
//      table — deliberately NOT the "__app__" config row, so a request
//      write can never clobber the docs configuration.
//   2. Can this user, as an Entra OWNER of the Temporary Document
//      Editors group, add and remove a member? (Self-add, verified,
//      removed — and skipped entirely if they are ALREADY a member, so
//      a live grant is never disturbed.)
//
// Also reports plain visibility facts (roster role, group links,
// memberships) — the same facts that would have self-diagnosed the
// 2026-08-05 "documents not set up" security-role incident. Output is
// status-only: names and outcomes, never tokens or URLs.

import {
  accessGroup,
  isGroupMember,
  isGroupOwner,
} from "../store/accessGroup";
import { currentViewer } from "../runtime";
import { viewerPerson } from "../store/people";
import { appDocsConfig } from "./docsStore";
// the ledger transport lives with the request flow it carries (5G2);
// the probe exercises the REAL one, not a copy
import { AccessRequest, readLedger, writeLedger } from "./accessRequests";

export async function runAccessProbe(log: (line: string) => void): Promise<void> {
  const viewer = currentViewer();
  if (!viewer) {
    log("FAIL — no signed-in viewer (probe needs the hosted app).");
    return;
  }
  log(`Signed in as ${viewer.name} (${viewer.email}).`);
  // what THIS boot saw — run right after following a share link on a
  // device, this line says whether the ltkdoc parameter ever arrived
  const { launchDebug, readResumeLog } = await import("../links");
  log(`INFO — launch: ${launchDebug()}`);
  // the resume TRAIL survives restarts (localStorage): scan, get stuck,
  // close the app, reopen, run this — the trail says what fired
  log(`INFO — resume trail:\n${readResumeLog()}`);

  // ---- roster + app access group (visibility facts) --------------------
  try {
    const me = await viewerPerson(viewer.objectId);
    log(
      me
        ? `OK — roster row found; app role: ${me.role}.`
        : "INFO — no roster row for this account (a super admin adds people under Settings → Users)."
    );
  } catch (e) {
    log(`FAIL — could not read the roster: ${trim(e)}`);
  }
  try {
    const ag = await accessGroup();
    if (ag) {
      const member = await isGroupMember(ag.id, viewer.objectId);
      log(`OK — app access group "${ag.name}": ${member ? "member" : "NOT a member"}.`);
    } else {
      log("INFO — no app access group configured.");
    }
  } catch (e) {
    log(`FAIL — could not read the app access group: ${trim(e)}`);
  }

  // ---- document groups (5G config) -------------------------------------
  let editorsId = "";
  let ownersId = "";
  let siteUrl = "";
  let spGroupName = "";
  try {
    const cfg = await appDocsConfig();
    const line = (label: string, id: string, name: string) =>
      log(id !== "" ? `OK — ${label} linked: ${name}.` : `INFO — ${label} not linked yet.`);
    line("Document controllers group", cfg.controllersGroupId, cfg.controllersGroupName);
    line("Owners & approvers group", cfg.ownersGroupId, cfg.ownersGroupName);
    log(
      cfg.spEditorsGroup !== ""
        ? `OK — SharePoint editors site group set: ${cfg.spEditorsGroup}.`
        : "INFO — no SharePoint editors site group set — grants cannot seat editors until it is."
    );
    editorsId = cfg.editorsGroupId;
    ownersId = cfg.ownersGroupId;
    siteUrl = cfg.siteUrl;
    spGroupName = cfg.spEditorsGroup;
  } catch (e) {
    log(`FAIL — could not read the documents configuration: ${trim(e)}`);
  }
  if (ownersId !== "") {
    try {
      const inPool = await isGroupMember(ownersId, viewer.objectId);
      log(`INFO — owners & approvers pool: ${inPool ? "member" : "not a member"}.`);
    } catch (e) {
      log(`FAIL — could not read the owners & approvers group: ${trim(e)}`);
    }
  }

  // ---- probe 1: the requests ledger ------------------------------------
  log("— Ledger probe (the request-edit-access home) —");
  const marker = `probe:${viewer.objectId}:${Date.now()}`;
  // a WELL-FORMED entry — readLedger drops shapes a request never has
  const probeEntry: AccessRequest = {
    id: marker,
    listId: "",
    itemId: 0,
    uniqueId: marker,
    name: "access probe",
    who: { id: viewer.objectId, name: viewer.name, email: viewer.email },
    owners: [],
    reason: "access diagnostics probe entry",
    when: new Date().toISOString(),
  };
  try {
    const before = await readLedger();
    log(`OK — ledger row read (${before.length} entr${before.length === 1 ? "y" : "ies"}).`);
    await writeLedger([...before, probeEntry]);
    const after = await readLedger();
    if (after.some((e) => e.id === marker)) {
      log("OK — ledger write landed and read back.");
    } else {
      log("FAIL — the write reported success but the entry did not read back.");
    }
    await writeLedger(after.filter((e) => e.id !== marker));
    log("OK — probe entry removed.");
  } catch (e) {
    log(`FAIL — ledger write refused: ${trim(e)}`);
    log("   (The request flow would need per-user rows instead — the fallback design.)");
  }

  // ---- probe 3: the SHAREPOINT editors site group (5G3b) ---------------
  // The instant-effect route: site-group membership is evaluated live,
  // so a grant works on the next click. Measures (a) resolve + member
  // read as this user, (b) add/remove executed by a pool member whose
  // standing comes only through the NESTED Entra group in the owning
  // site group, (c) which body shape this tenant's REST accepts.
  log("— Site-group probe (instant-effect grants) —");
  if (siteUrl === "" || spGroupName === "") {
    log("SKIP — set the SharePoint editors site group under Settings → Access control first.");
  } else {
    const { addSiteGroupUser, fetchSiteGroupByName, fetchSiteGroupUsers, removeSiteGroupUser } =
      await import("./sp");
    const myLogin = `i:0#.f|membership|${viewer.email.trim().toLowerCase()}`;
    const resolved = await fetchSiteGroupByName(siteUrl, spGroupName);
    const groupId = Number(
      ((resolved.data ?? {}) as { Id?: unknown }).Id ?? 0
    );
    if (!resolved.ok || groupId <= 0) {
      log(`FAIL — could not resolve site group "${spGroupName}": ${resolved.status.slice(0, 200)}`);
    } else {
      log(`OK — site group resolved (id ${groupId}).`);
      const listUsers = async (): Promise<string[]> => {
        const r = await fetchSiteGroupUsers(siteUrl, groupId);
        if (!r.ok) throw new Error(r.status);
        const rows = ((r.data ?? {}) as { value?: { LoginName?: string }[] }).value ?? [];
        return rows.map((u) => (u.LoginName ?? "").toLowerCase());
      };
      try {
        const before = await listUsers();
        log(`OK — membership readable (${before.length} member${before.length === 1 ? "" : "s"}).`);
        if (before.includes(myLogin.toLowerCase())) {
          log("SKIP — you are ALREADY a member of the site group — add/remove not attempted, a live grant is never disturbed.");
        } else {
          let how = "plain JSON";
          let added = await addSiteGroupUser(siteUrl, groupId, myLogin);
          if (!added.ok) {
            how = "verbose envelope";
            added = await addSiteGroupUser(siteUrl, groupId, myLogin, true);
          }
          if (!added.ok) {
            log(`FAIL — self-add refused (both body shapes): ${added.status.slice(0, 250)}`);
            log("   (If you expected rights: is the OWNING site group's membership — via the nested Entra pool group — reaching you?)");
          } else {
            const nowIn = (await listUsers()).includes(myLogin.toLowerCase());
            log(
              nowIn
                ? `OK — self-add landed via ${how}, read back IMMEDIATELY (the instant-effect claim holds).`
                : `FAIL — the add (${how}) answered OK but did not read back.`
            );
            const removed = await removeSiteGroupUser(siteUrl, groupId, myLogin);
            const gone = removed.ok && !(await listUsers()).includes(myLogin.toLowerCase());
            log(
              gone
                ? "OK — self-remove landed; the group is back as it was."
                : `FAIL — remove did not land: ${removed.status.slice(0, 200)} — remove yourself in SharePoint.`
            );
          }
        }
      } catch (e) {
        log(`FAIL — could not read the site group's members: ${trim(e)}`);
        log("   (Set the group's 'Who can view membership' to Everyone.)");
      }
    }
  }

}
const trim = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);
