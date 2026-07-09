import { describe, expect, it } from "vitest";

import { compileLineMatcher } from "./match-line";

describe("compileLineMatcher", () => {
  describe("literal mode", () => {
    it("matches lines containing the pattern", () => {
      const matcher = compileLineMatcher("error", "literal");
      expect(matcher("an error occurred")).toBe(true);
      expect(matcher("all good")).toBe(false);
    });

    it("is case-sensitive", () => {
      const matcher = compileLineMatcher("Error", "literal");
      expect(matcher("an Error occurred")).toBe(true);
      expect(matcher("an error occurred")).toBe(false);
    });

    it("never matches an empty literal pattern (no match-all footgun)", () => {
      // An empty pattern would otherwise match every line via
      // String#includes(""), firing a notification per line. Defend at the
      // shared primitive; callers should treat "" as "no filter".
      const matcher = compileLineMatcher("", "literal");
      expect(matcher("anything")).toBe(false);
      expect(matcher("")).toBe(false);
    });
  });

  describe("regex mode", () => {
    it("matches lines against the regex", () => {
      const matcher = compileLineMatcher("ERR\\d+", "regex");
      expect(matcher("ERR404 not found")).toBe(true);
      expect(matcher("no error here")).toBe(false);
    });

    it("throws on invalid regex", () => {
      expect(() => compileLineMatcher("([", "regex")).toThrow();
    });

    it("never matches an empty regex pattern (no match-all footgun)", () => {
      // An empty regex otherwise matches at every position and would fire a
      // notification per line. Defend at the shared primitive; callers should
      // treat "" as "no filter".
      const matcher = compileLineMatcher("", "regex");
      expect(matcher("anything")).toBe(false);
      expect(matcher("")).toBe(false);
    });

    it("supports regex flags via pattern", () => {
      const matcher = compileLineMatcher("error(?=:)", "regex");
      expect(matcher("error: something broke")).toBe(true);
      expect(matcher("erroring out")).toBe(false);
    });
  });
});
