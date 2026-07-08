import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import { executeClear, formatClearDetails } from ".";

describe("executeClear", () => {
  it("clears finished processes", () => {
    const clearFinished = vi.fn(() => 2);
    const manager = { clearFinished } as unknown as ProcessManager;

    const details = executeClear(manager);

    expect(clearFinished).toHaveBeenCalledOnce();
    expect(details).toEqual({ action: "clear", cleared: 2 });
  });
});

describe("formatClearDetails", () => {
  it("formats no-op clears", () => {
    expect(formatClearDetails({ action: "clear", cleared: 0 })).toBe(
      "No finished background processes to clear.",
    );
  });

  it("formats singular clears", () => {
    expect(formatClearDetails({ action: "clear", cleared: 1 })).toBe(
      "Cleared 1 finished background process.",
    );
  });

  it("formats plural clears", () => {
    expect(formatClearDetails({ action: "clear", cleared: 3 })).toBe(
      "Cleared 3 finished background processes.",
    );
  });
});
