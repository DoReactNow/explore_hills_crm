import { describe, expect, it } from "vitest";
import { formatPhone, initialsOf } from "../Avatar";

describe("initialsOf", () => {
  it("takes two initials from a Latin name and one letter with its vowel sign from Devanagari", () => {
    expect(initialsOf("Riya Mehta")).toBe("RM");
    expect(initialsOf("anil")).toBe("A");
    expect(initialsOf("सुनीता अग्रवाल")).toBe("सु");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("formatPhone", () => {
  it("spaces an Indian mobile and hides an erased number", () => {
    expect(formatPhone("+919000000001")).toBe("+91 90000 00001");
    expect(formatPhone("+447700900123")).toBe("+447700900123");
    expect(formatPhone("erased-abc")).toBe("Number erased");
  });
});
