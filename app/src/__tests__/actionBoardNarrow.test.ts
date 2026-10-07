// The ActionBoard on a narrow pane (mobile review M4): the list stands
// in for the kanban and the Gantt, and the person's choice survives.

import { describe, expect, it } from "vitest";
import { ACTIONBOARD_NARROW_MAX, viewFor } from "../../../controls/ActionBoard/editor";

describe("viewFor", () => {
  it("is the list whenever the pane is narrow, whatever was chosen or configured", () => {
    expect(viewFor(true, "kanban", "gantt")).toBe("list");
    expect(viewFor(true, null, "kanban")).toBe("list");
  });
  it("is the person's choice over the configured default when there is room", () => {
    expect(viewFor(false, "gantt", "kanban")).toBe("gantt");
    expect(viewFor(false, null, "kanban")).toBe("kanban");
  });
  it("narrows under a width a phone's card is always below", () => {
    expect(ACTIONBOARD_NARROW_MAX).toBe(480);
  });
});
