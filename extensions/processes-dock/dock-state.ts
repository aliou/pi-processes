import type { DockActions, DockState, DockVisibility } from "./widget/types";

export function createDockState(initial: Partial<DockState> = {}): {
  getState: () => DockState;
  actions: DockActions;
} {
  const state: DockState = {
    visibility: initial.visibility ?? "closed",
    followEnabled: initial.followEnabled ?? true,
    focusedProcessId: initial.focusedProcessId ?? null,
  };

  const setVisibility = (visibility: DockVisibility) => {
    state.visibility = visibility;
  };

  return {
    getState: () => ({ ...state }),
    actions: {
      getFocusedProcessId: () => state.focusedProcessId,
      isFollowEnabled: () => state.followEnabled,
      setFocus: (processId) => {
        state.focusedProcessId = processId;
        if (processId && state.visibility === "closed") {
          state.visibility = "expanded";
        }
      },
      expand: () => setVisibility("expanded"),
      collapse: () => setVisibility("collapsed"),
      close: () => setVisibility("closed"),
    },
  };
}
