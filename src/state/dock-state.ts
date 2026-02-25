/**
 * Centralized dock state management for the Process Dock UX.
 *
 * Manages visibility (hidden/collapsed/open), follow mode, and focus state.
 */

export type DockVisibility = "hidden" | "collapsed" | "open";

export interface DockState {
  visibility: DockVisibility;
  followEnabled: boolean;
  focusedProcessId: string | null;
}

export class DockStateManager {
  private state: DockState;
  private listeners: Set<(state: DockState) => void> = new Set();

  constructor(initialFollowEnabled: boolean = true) {
    this.state = {
      visibility: "hidden",
      followEnabled: initialFollowEnabled,
      focusedProcessId: null,
    };
  }

  getState(): DockState {
    return { ...this.state };
  }

  setState(updates: Partial<DockState>): void {
    const hasChanges =
      (updates.visibility !== undefined &&
        updates.visibility !== this.state.visibility) ||
      (updates.followEnabled !== undefined &&
        updates.followEnabled !== this.state.followEnabled) ||
      (updates.focusedProcessId !== undefined &&
        updates.focusedProcessId !== this.state.focusedProcessId);

    if (!hasChanges) return;

    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  subscribe(listener: (state: DockState) => void): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  // Convenience methods
  toggleVisibility(): void {
    const current = this.state.visibility;
    if (current === "hidden") {
      this.state = { ...this.state, visibility: "collapsed" };
    } else if (current === "collapsed") {
      this.state = { ...this.state, visibility: "open" };
    } else {
      this.state = { ...this.state, visibility: "collapsed" };
    }
    this.notifyListeners();
  }

  expand(): void {
    this.setState({ visibility: "open" });
  }

  collapse(): void {
    this.setState({ visibility: "collapsed" });
  }

  hide(): void {
    this.setState({ visibility: "hidden" });
  }

  toggleFollow(): void {
    this.setState({ followEnabled: !this.state.followEnabled });
  }

  setFocus(processId: string | null): void {
    this.setState({
      focusedProcessId: processId,
      // Auto-expand when focusing
      visibility: processId ? "open" : this.state.visibility,
    });
  }

  /**
   * Cycle focus between processes.
   * @param processIds List of all process IDs (including finished)
   * @param direction Direction to cycle ("next" or "prev")
   */
  cycleFocus(processIds: string[], direction: "next" | "prev"): void {
    if (processIds.length === 0) return;

    const current = this.state.focusedProcessId;

    // If no current focus, start at first/last based on direction
    if (current === null) {
      const target =
        direction === "next"
          ? processIds[0]
          : processIds[processIds.length - 1];
      this.setFocus(target);
      return;
    }

    const currentIndex = processIds.indexOf(current);
    if (currentIndex === -1) {
      // Current focus not in list, start at first/last
      const target =
        direction === "next"
          ? processIds[0]
          : processIds[processIds.length - 1];
      this.setFocus(target);
      return;
    }

    let newIndex: number;
    if (direction === "next") {
      newIndex = (currentIndex + 1) % processIds.length;
    } else {
      newIndex = (currentIndex - 1 + processIds.length) % processIds.length;
    }

    this.setFocus(processIds[newIndex]);
  }

  /**
   * Auto-show dock when follow is enabled and first process starts.
   * Only transitions from hidden -> collapsed.
   */
  autoShow(): void {
    if (this.state.followEnabled && this.state.visibility === "hidden") {
      this.setState({ visibility: "collapsed" });
    }
  }

  /**
   * Auto-hide dock when all processes finish and follow is enabled.
   */
  autoHide(): void {
    if (this.state.followEnabled && this.state.visibility !== "hidden") {
      this.setState({ visibility: "hidden" });
    }
  }

  /**
   * Handle process exit - auto-unfocus if the focused process ended.
   * @param endedProcessId The process that just ended
   * @returns true if the dock state changed
   */
  handleProcessExit(endedProcessId: string): boolean {
    if (this.state.focusedProcessId === endedProcessId) {
      this.setState({ focusedProcessId: null });
      return true;
    }
    return false;
  }
}
