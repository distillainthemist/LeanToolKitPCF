// N2 — the notify plan: who the next step is and what the message says.
// The panel only paints what these functions decide, so the decisions
// are tested here, not in a browser.

import { describe, expect, it } from "vitest";
import {
  accessRequestPlan,
  escapeHtml,
  notifyCard,
  notifyEmailHtml,
  notifyPlanFor,
} from "../docs/notifyModel";

const P = (name: string, email: string) => ({ name, email });
const LINK = "https://apps.powerapps.com/play/e/env/app/app?ltkdoc=l%3A1&ltkmode=work#/";

const ROLES = {
  owners: [P("Olive Owner", "olive@x.com")],
  approvers: [P("Andy Approver", "andy@x.com"), P("Olive Owner", "olive@x.com")],
  reviewers: [P("Rita Reviewer", "rita@x.com")],
  editors: [P("Eddy Editor", "eddy@x.com")],
};

const base = {
  docName: "Mash SOP",
  actorName: "Ben",
  roles: ROLES,
  myEmail: "ben@x.com",
  link: LINK,
};

describe("notifyPlanFor", () => {
  it("submit for review notifies the reviewers", () => {
    const plan = notifyPlanFor({ ...base, commandKey: "submitReview", to: "inReview" });
    expect(plan?.recipients.map((p) => p.email)).toEqual(["rita@x.com"]);
    expect(plan?.subject).toBe("Review requested — Mash SOP");
    expect(plan?.message).toContain("Ben has submitted");
    expect(plan?.message).toContain("Please review");
    expect(plan?.link).toBe(LINK);
  });

  it("submit for approval targets the resolved stage: approvers or owner", () => {
    const toApprovers = notifyPlanFor({ ...base, commandKey: "submitApproval", to: "inApproval" });
    expect(toApprovers?.recipients.map((p) => p.email)).toEqual(["andy@x.com", "olive@x.com"]);
    const toOwner = notifyPlanFor({ ...base, commandKey: "submitApproval", to: "inOwnerApproval" });
    expect(toOwner?.recipients.map((p) => p.email)).toEqual(["olive@x.com"]);
    expect(toOwner?.message).toContain("final step");
  });

  it("an endorsement notifies the owner; the final approve closes the loop", () => {
    const endorse = notifyPlanFor({ ...base, commandKey: "approve", to: "inOwnerApproval" });
    expect(endorse?.recipients.map((p) => p.email)).toEqual(["olive@x.com"]);
    expect(endorse?.message).toContain("endorsed");
    const final = notifyPlanFor({ ...base, commandKey: "approve", to: "approved" });
    // reviewers + approvers, deduped — a courtesy, and it says so
    expect(final?.recipients.map((p) => p.email)).toEqual([
      "rita@x.com",
      "andy@x.com",
      "olive@x.com",
    ]);
    expect(final?.message).toContain("No action needed");
  });

  it("request revision goes to the owner and any granted editors", () => {
    const plan = notifyPlanFor({ ...base, commandKey: "requestRevision", to: "draft" });
    expect(plan?.recipients.map((p) => p.email)).toEqual(["olive@x.com", "eddy@x.com"]);
  });

  it("never notifies the actor about their own step, and empty plans are null", () => {
    const own = notifyPlanFor({
      ...base,
      myEmail: "olive@x.com",
      commandKey: "approve",
      to: "inOwnerApproval",
    });
    expect(own).toBeNull(); // the owner acting: the plan collapses to nobody
    const none = notifyPlanFor({
      ...base,
      roles: { ...ROLES, reviewers: [] },
      commandKey: "submitReview",
      to: "inReview",
    });
    expect(none).toBeNull();
  });

  it("start-revision derives no plan (no next actor)", () => {
    expect(notifyPlanFor({ ...base, commandKey: "revise", to: "draft" })).toBeNull();
  });

  it("drops entries without an email and dedupes by it", () => {
    const plan = notifyPlanFor({
      ...base,
      roles: {
        ...ROLES,
        reviewers: [P("No Mail", ""), P("Rita Reviewer", "rita@x.com"), P("Rita again", "RITA@x.com")],
      },
      commandKey: "submitReview",
      to: "inReview",
    });
    expect(plan?.recipients).toEqual([{ name: "Rita Reviewer", email: "rita@x.com" }]);
  });
});

describe("accessRequestPlan (N3)", () => {
  it("a request tells the owners; decisions tell the requester", () => {
    const req = accessRequestPlan({
      kind: "requested",
      docName: "Mash SOP",
      actorName: "Marketing",
      targets: [P("", "olive@x.com")],
      myEmail: "marketing@x.com",
      link: LINK,
    });
    expect(req?.recipients).toEqual([{ name: "olive@x.com", email: "olive@x.com" }]);
    expect(req?.subject).toBe("Edit access requested — Mash SOP");
    expect(req?.message).toContain("My tasks");
    const granted = accessRequestPlan({
      kind: "granted",
      docName: "Mash SOP",
      actorName: "Olive",
      targets: [P("Marketing", "marketing@x.com")],
      myEmail: "olive@x.com",
      link: LINK,
    });
    expect(granted?.recipients.map((p) => p.email)).toEqual(["marketing@x.com"]);
    expect(granted?.message).toContain("start the revision");
    const declined = accessRequestPlan({
      kind: "declined",
      docName: "Mash SOP",
      actorName: "Olive",
      targets: [P("Marketing", "marketing@x.com")],
      myEmail: "olive@x.com",
      link: LINK,
    });
    expect(declined?.message).toContain("declined");
  });

  it("collapses to null when the actor is the only target", () => {
    const plan = accessRequestPlan({
      kind: "requested",
      docName: "Mash SOP",
      actorName: "Olive",
      targets: [P("Olive", "olive@x.com")],
      myEmail: "olive@x.com",
      link: LINK,
    });
    expect(plan).toBeNull();
  });
});

describe("message rendering", () => {
  it("escapes and paragraphs the email body, appending the work link", () => {
    const html = notifyEmailHtml("Hello <you>\n\nSecond & last", "https://x/?a=1&b=2");
    expect(html).toContain("<p>Hello &lt;you&gt;</p>");
    expect(html).toContain("<p>Second &amp; last</p>");
    expect(html).toContain('href="https://x/?a=1&amp;b=2"');
    expect(html).toContain("Open the document in LeanBoard");
  });

  it("builds a v1.2 card with the message and an Open action", () => {
    const card = notifyCard("Subject", "Body text", LINK) as {
      version: string;
      body: { text: string }[];
      actions: { type: string; url: string }[];
    };
    expect(card.version).toBe("1.2");
    expect(card.body.map((b) => b.text)).toEqual(["Subject", "Body text"]);
    expect(card.actions[0]).toMatchObject({ type: "Action.OpenUrl", url: LINK });
  });

  it("escapeHtml covers the four", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
