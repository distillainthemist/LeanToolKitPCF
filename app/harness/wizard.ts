import { MeetingWizardView } from "../../controls/MeetingWizard/editor";
import { emptyDraft } from "../../controls/MeetingWizard/types";

const ed = new MeetingWizardView(document.getElementById("w")!, { onChange: () => undefined, onSubmit: () => undefined });
ed.setOrgTree([
  { site: "Bendigo", departments: [{ department: "Packaging", areas: ["Line 1", "Line 2"] }, { department: "Distillery", areas: [] }] },
  { site: "Melbourne", departments: [{ department: "Sales", areas: [] }] },
]);
const d = emptyDraft();
d.title = "Daily packaging huddle";
d.org = { site: "Bendigo", department: "Packaging", area: "" };
d.alsoOrgs = [{ site: "Bendigo", department: "Distillery", area: "" }];
ed.setDraft(d);
(window as unknown as { ed: MeetingWizardView }).ed = ed;
