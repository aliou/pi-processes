import { describe, expect, it } from "vitest";
import { trimToBudget } from "./line-buffer";

const line = (text: string) => ({ text });

describe("trimToBudget", () => {
  it("bounds by line count", () => {
    expect(
      trimToBudget([line("one"), line("two"), line("three")], 2, 100),
    ).toEqual([line("two"), line("three")]);
  });

  it("bounds by text budget", () => {
    expect(
      trimToBudget([line("1234"), line("5678"), line("90")], 10, 6),
    ).toEqual([line("5678"), line("90")]);
  });

  it("measures UTF-8 bytes", () => {
    expect(trimToBudget([line("old"), line("€€")], 10, 5)).toEqual([
      line("€€"),
    ]);
  });

  it("applies both bounds", () => {
    expect(
      trimToBudget([line("old"), line("1234"), line("5678"), line("90")], 3, 6),
    ).toEqual([line("5678"), line("90")]);
  });

  it("keeps one oversized newest line", () => {
    expect(trimToBudget([line("old"), line("oversized")], 10, 2)).toEqual([
      line("oversized"),
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(trimToBudget([], 10, 10)).toEqual([]);
  });
});
