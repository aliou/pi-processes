export type DockVisibility = "closed" | "collapsed" | "expanded";

export interface DockState {
  visibility: DockVisibility;
  followEnabled: boolean;
  focusedProcessId: string | null;
}

export interface DockActions {
  getFocusedProcessId: () => string | null;
  isFollowEnabled: () => boolean;
  setFocus: (processId: string | null) => void;
  expand: () => void;
  collapse: () => void;
  close: () => void;
}
