import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockStateManager } from "./src/state/dock-state";

describe("DockStateManager", () => {
  let manager: DockStateManager;

  beforeEach(() => {
    manager = new DockStateManager(true);
  });

  describe("constructor", () => {
    it("initializes with default values", () => {
      const state = manager.getState();
      expect(state.visibility).toBe("hidden");
      expect(state.followEnabled).toBe(true);
      expect(state.focusedProcessId).toBeNull();
    });

    it("accepts custom followEnabled value", () => {
      const managerWithFollowDisabled = new DockStateManager(false);
      expect(managerWithFollowDisabled.getState().followEnabled).toBe(false);
    });
  });

  describe("setState", () => {
    it("updates visibility", () => {
      manager.setState({ visibility: "collapsed" });
      expect(manager.getState().visibility).toBe("collapsed");
    });

    it("updates followEnabled", () => {
      manager.setState({ followEnabled: false });
      expect(manager.getState().followEnabled).toBe(false);
    });

    it("updates focusedProcessId", () => {
      manager.setState({ focusedProcessId: "test-process" });
      expect(manager.getState().focusedProcessId).toBe("test-process");
    });

    it("does not notify listeners when no changes", () => {
      const listener = vi.fn();
      manager.subscribe(listener);
      listener.mockClear();

      // Set same values
      manager.setState({ followEnabled: true });
      expect(listener).not.toHaveBeenCalled();
    });

    it("notifies listeners on changes", () => {
      const listener = vi.fn();
      manager.subscribe(listener);
      listener.mockClear();

      manager.setState({ visibility: "open" });
      expect(listener).toHaveBeenCalled();
    });
  });

  describe("subscribe", () => {
    it("calls listener immediately with current state", () => {
      const listener = vi.fn();
      manager.subscribe(listener);
      expect(listener).toHaveBeenCalledWith(manager.getState());
    });

    it("returns unsubscribe function", () => {
      const listener = vi.fn();
      const unsubscribe = manager.subscribe(listener);
      // Clear the initial call from subscribe()
      listener.mockClear();
      unsubscribe();
      manager.setState({ visibility: "collapsed" });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("convenience methods", () => {
    describe("toggleVisibility", () => {
      it("cycles from hidden to collapsed", () => {
        manager.toggleVisibility();
        expect(manager.getState().visibility).toBe("collapsed");
      });

      it("cycles from collapsed to open", () => {
        manager.setState({ visibility: "collapsed" });
        manager.toggleVisibility();
        expect(manager.getState().visibility).toBe("open");
      });

      it("cycles from open to collapsed", () => {
        manager.setState({ visibility: "open" });
        manager.toggleVisibility();
        expect(manager.getState().visibility).toBe("collapsed");
      });
    });

    describe("expand", () => {
      it("sets visibility to open", () => {
        manager.expand();
        expect(manager.getState().visibility).toBe("open");
      });
    });

    describe("collapse", () => {
      it("sets visibility to collapsed", () => {
        manager.setState({ visibility: "open" });
        manager.collapse();
        expect(manager.getState().visibility).toBe("collapsed");
      });
    });

    describe("hide", () => {
      it("sets visibility to hidden", () => {
        manager.setState({ visibility: "open" });
        manager.hide();
        expect(manager.getState().visibility).toBe("hidden");
      });
    });

    describe("toggleFollow", () => {
      it("toggles followEnabled from true to false", () => {
        manager.toggleFollow();
        expect(manager.getState().followEnabled).toBe(false);
      });

      it("toggles followEnabled from false to true", () => {
        manager.setState({ followEnabled: false });
        manager.toggleFollow();
        expect(manager.getState().followEnabled).toBe(true);
      });
    });

    describe("setFocus", () => {
      it("sets focusedProcessId", () => {
        manager.setFocus("my-process");
        expect(manager.getState().focusedProcessId).toBe("my-process");
      });

      it("auto-expands when focusing", () => {
        manager.setState({ visibility: "hidden" });
        manager.setFocus("my-process");
        expect(manager.getState().visibility).toBe("open");
      });

      it("keeps current visibility when unfocusing", () => {
        manager.setState({ visibility: "open" });
        manager.setFocus(null);
        expect(manager.getState().focusedProcessId).toBeNull();
        expect(manager.getState().visibility).toBe("open");
      });
    });

    describe("cycleFocus", () => {
      const processIds = ["proc-1", "proc-2", "proc-3"];

      it("cycles to first process when no focus", () => {
        manager.cycleFocus(processIds, "next");
        expect(manager.getState().focusedProcessId).toBe("proc-1");
      });

      it("cycles to last process when no focus and direction is prev", () => {
        manager.cycleFocus(processIds, "prev");
        expect(manager.getState().focusedProcessId).toBe("proc-3");
      });

      it("cycles next through processes", () => {
        manager.setFocus("proc-1");
        manager.cycleFocus(processIds, "next");
        expect(manager.getState().focusedProcessId).toBe("proc-2");
      });

      it("cycles prev through processes", () => {
        manager.setFocus("proc-2");
        manager.cycleFocus(processIds, "prev");
        expect(manager.getState().focusedProcessId).toBe("proc-1");
      });

      it("wraps around from last to first", () => {
        manager.setFocus("proc-3");
        manager.cycleFocus(processIds, "next");
        expect(manager.getState().focusedProcessId).toBe("proc-1");
      });

      it("wraps around from first to last", () => {
        manager.setFocus("proc-1");
        manager.cycleFocus(processIds, "prev");
        expect(manager.getState().focusedProcessId).toBe("proc-3");
      });

      it("does nothing with empty process list", () => {
        manager.setFocus("proc-1");
        manager.cycleFocus([], "next");
        expect(manager.getState().focusedProcessId).toBe("proc-1");
      });

      it("handles focus not in list", () => {
        manager.setFocus("unknown-process");
        manager.cycleFocus(processIds, "next");
        expect(manager.getState().focusedProcessId).toBe("proc-1");
      });
    });

    describe("autoShow", () => {
      it("shows dock when follow enabled and hidden", () => {
        manager.autoShow();
        expect(manager.getState().visibility).toBe("collapsed");
      });

      it("does not show dock when follow disabled", () => {
        manager.setState({ followEnabled: false });
        manager.autoShow();
        expect(manager.getState().visibility).toBe("hidden");
      });

      it("does not show dock when already visible", () => {
        manager.setState({ visibility: "open" });
        manager.autoShow();
        expect(manager.getState().visibility).toBe("open");
      });
    });

    describe("autoHide", () => {
      it("hides dock when follow enabled and not hidden", () => {
        manager.setState({ visibility: "open" });
        manager.autoHide();
        expect(manager.getState().visibility).toBe("hidden");
      });

      it("does not hide dock when follow disabled", () => {
        manager.setState({ followEnabled: false, visibility: "open" });
        manager.autoHide();
        expect(manager.getState().visibility).toBe("open");
      });
    });

    describe("handleProcessExit", () => {
      it("unfocuses when focused process exits", () => {
        manager.setFocus("proc-1");
        const changed = manager.handleProcessExit("proc-1");
        expect(changed).toBe(true);
        expect(manager.getState().focusedProcessId).toBeNull();
      });

      it("does not unfocus when different process exits", () => {
        manager.setFocus("proc-1");
        const changed = manager.handleProcessExit("proc-2");
        expect(changed).toBe(false);
        expect(manager.getState().focusedProcessId).toBe("proc-1");
      });
    });
  });
});
