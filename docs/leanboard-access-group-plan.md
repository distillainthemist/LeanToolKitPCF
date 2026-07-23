# Access-control group — review & implementation plan

**Goal.** A super admin picks an Entra security group (one they own) as
the app's access-control group. The app then keeps the group in sync
with the roster: new users are added as members; super and site admins
are added as members *and* owners. Combined with the group → Dataverse
group-team mapping (which holds the LeanBoard User role) and sharing
the app with the group, roster membership becomes the single source of
app access.

## Review — what the connectors can and cannot do

**The Office365Groups connector's named actions are the wrong tool.**
Its typed operations (`ListOwnedGroupsV2/V3`, `AddMemberToGroup`,
`RemoveMemberFromGroup`) work with Microsoft 365 (unified) groups, not
pure security groups, and the connector has **no add-owner action at
all**.

**Its `HttpRequest` action is the right tool.** The connector carries a
generic "Send an HTTP request" operation that passes a Microsoft Graph
request through under the signed-in user's delegated permissions
(`Group.ReadWrite.All` is in the connector's scope set). That gives us
everything, acting *as the super admin who owns the group*:

- list owned security groups —
  `GET /v1.0/me/ownedObjects/microsoft.graph.group?$filter=securityEnabled eq true`
- add member — `POST /groups/{id}/members/$ref`
- add owner — `POST /groups/{id}/owners/$ref`
- remove member — `DELETE /groups/{id}/members/{userId}/$ref`

Because everything is delegated, no directory role and no admin-granted
application permission is needed: a group's **owner** may manage its
membership. That matches the spec exactly (only groups the super admin
owns are offered).

**Spike required (S0).** The `HttpRequest` action restricts which Graph
URL paths it accepts (documented as "the Groups endpoint"). `/groups/…`
paths are safe; `/me/ownedObjects/…` must be verified in the hosted
app. Fallback if it's refused: `ListOwnedGroupsV3` (owned unified
groups) plus a `/groups?$filter=securityEnabled eq true` query
cross-checked against `/groups/{id}/owners` — or simply accept
security-enabled M365 groups, which Dataverse group teams and app
sharing also support. Decide after the spike.

**Chicken-and-egg flow change.** Today users self-register on first
open. Once the group gates access, a user not yet in the group cannot
open the app at all — so the roster becomes admin-fed: the wizard's
directory add, the owner picker, and (new) a Users-tab "Add person"
path are the entry points, and each triggers the group add. Worth
stating in the UI ("people you add here can open the app").

**Consent & multi-admin reality.** Each admin's first group operation
prompts a one-time Office365Groups connection consent (same pattern as
Office365Users today). A super admin who does *not* own the chosen
group gets 403s from Graph — mitigated by the spec itself: admins are
added as owners, so after the first sync every admin can sync. Failures
surface as a quiet "couldn't update the access group — an owner can
run Sync" note rather than blocking the roster edit.

**What the app cannot do itself** (one-time admin-centre steps, added
to the runbook): create the Dataverse group team from the group and
give it the LeanBoard User role; share the app with the group. After
that, the app's automatic membership is the whole story.

## Plan

**S0 — spike (hosted).** Add the `shared_office365groups` data source
(`pac code add-data-source`), wire a raw `HttpRequest` helper, and
verify in the hosted app: owned-security-group listing, member add,
owner add, duplicate-add (expect 409 → treat as success), remove.
Everything after this is mechanical.

**S1 — pick & store the group.** New "Access control" card at the top
of Settings → Users (super admin only): shows the current group or
"not configured"; "Choose group…" opens an app-styled dialog listing
groups the signed-in super admin owns (name + member count), with a
search filter. Selection stores `{groupId, name}` — new
`ben_accessgroup` text column on the app-settings row (additive schema
change) — plus a "Stop managing" clear action. Store module:
`store/accessGroup.ts` with `listOwnedGroups()`, `accessGroup()`,
`saveAccessGroup()`.

**S2 — sync on roster mutations.** A `syncPersonToGroup(person)`
helper called from every roster write path: wizard directory add,
owner pick, Users-tab role change (promote to admin → also add owner;
demote → remove owner, keep member), restore access (re-add member),
revoke access (remove member — and remove owner if held). Guards:
no-op when no group is configured; treat "already a member/owner" as
success; never remove the signed-in user's own ownership; never remove
the last owner. Failures mark a "needs sync" flag on the row rather
than failing the roster edit.

**S3 — reconcile & runbook.** "Sync now" on the Access control card:
diff roster (active people) against group members/owners, apply the
delta, report "added 3, ownered 1, removed 2". This is also the
adoption path for the existing roster the day the group is first
configured. Update `docs/deploy-to-new-org.md`: choose/create the
group in the app, map it to a group team with the LeanBoard User role,
share the app with it.

**Out of scope / decisions taken.** No background jobs — sync happens
on admin actions, with Sync now as the reconciler (a code app has no
server side). Group → team mapping stays a documented admin step. The
app never creates or deletes groups.

## Open questions

1. **Revoke = removal from the group?** Plan assumes yes (revoking app
   access should revoke actual access). Alternative: leave the group
   untouched on revoke and only flag it.
2. **Pure security group vs security-enabled M365 group** — if the S0
   spike finds owned *security* groups unlistable through the
   connector, is a security-enabled M365 group acceptable? (It works
   for group teams and app sharing.)
3. **Demotion behaviour** — plan removes ownership but keeps
   membership when an admin becomes a regular user. Confirm.
