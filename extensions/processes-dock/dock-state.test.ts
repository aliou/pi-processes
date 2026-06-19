import { describe, expect, it } from "vitest";
import { createDockState } from "./dock-state";

describe("createDockState", () => {
  it("uses defaults", () => {
    const { getState } = createDockState();

    expect(getState()).toEqual({
      visibility: "closed",
      followEnabled: true,
      focusedProcessId: null,
    });
  });

  it("sets focus and expands when closed", () => {
    const { getState, actions } = createDockState();

    actions.setFocus("proc_1");

    expect(getState().focusedProcessId).toBe("proc_1");
    expect(getState().visibility).toBe("expanded");
  });

  it("sets explicit visibility", () => {
    const { getState, actions } = createDockState();

    actions.expand();
    expect(getState().visibility).toBe("expanded");

    actions.collapse();
    expect(getState().visibility).toBe("collapsed");

    actions.close();
    expect(getState().visibility).toBe("closed");
  });
});
