import { describe, expect, it } from "vitest";
import { initialsFor } from "../../../shared/schema/people";

describe("initialsFor", () => {
  it("takes the given name and the surname", () => {
    expect(initialsFor("Ben O'Brien")).toBe("BO");
    expect(initialsFor("Jane Mary Smith")).toBe("JS");
  });
  it("reads 'Surname, Given' in that order", () => {
    expect(initialsFor("O'Brien, Ben")).toBe("BO");
    expect(initialsFor("Smith, Jane Mary")).toBe("JS");
  });
  it("drops a bracketed suffix", () => {
    expect(initialsFor("O'Brien, Ben (Pechey Distilling)")).toBe("BO");
    expect(initialsFor("Ben O'Brien (Contractor)")).toBe("BO");
    expect(initialsFor("Ben O'Brien [ext]")).toBe("BO");
  });
  it("falls back for one word and nothing", () => {
    expect(initialsFor("Ben")).toBe("BE");
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("(Shared mailbox)")).toBe("?");
  });
});
