import { describe, expect, it } from "vitest";
import { isOutputChangedPayload } from "./output-payload";

describe("isOutputChangedPayload", () => {
  it("accepts valid optional output fields", () => {
    expect(isOutputChangedPayload({ id: "proc_1" })).toBe(true);
    expect(
      isOutputChangedPayload({
        id: "proc_1",
        appendedText: [{ type: "stdout", text: "line" }],
        droppedLines: 2,
      }),
    ).toBe(true);
  });

  it("rejects malformed lines and drop counts", () => {
    expect(isOutputChangedPayload({ id: "proc_1", appendedText: [null] })).toBe(
      false,
    );
    expect(
      isOutputChangedPayload({ id: "proc_1", droppedLines: Infinity }),
    ).toBe(false);
    expect(isOutputChangedPayload({ id: "proc_1", droppedLines: 1.5 })).toBe(
      false,
    );
  });
});
