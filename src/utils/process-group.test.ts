import { describe, expect, it } from "vitest";
import { isProcessGroupAlive, killProcessGroup } from "./process-group";

describe("process-group helpers with non-positive pgids", () => {
  it("isProcessGroupAlive(0) returns false", () => {
    expect(isProcessGroupAlive(0)).toBe(false);
  });

  it("isProcessGroupAlive(-1) returns false", () => {
    expect(isProcessGroupAlive(-1)).toBe(false);
  });

  it("killProcessGroup(0, ...) throws RangeError", () => {
    expect(() => killProcessGroup(0, "SIGTERM")).toThrow(RangeError);
  });

  it("killProcessGroup(-1, ...) throws RangeError", () => {
    expect(() => killProcessGroup(-1, "SIGTERM")).toThrow(RangeError);
  });
});
