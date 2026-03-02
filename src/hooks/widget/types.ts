export type DockVisibility = "hidden" | "collapsed" | "open";

export interface DockState {
  visibility: DockVisibility;
  followEnabled: boolean;
  focusedProcessId: string | null;
}

export interface DockActions {
  getFocusedProcessId(): string | null;
  isFollowEnabled(): boolean;
  setFocus(id: string | null): void;
  expand(): void;
  collapse(): void;
  hide(): void;
  toggle(): void;
  toggleFollow(): void;
}

export const STATUS_WIDGET_ID = "processes-status";
export const LOG_DOCK_WIDGET_ID = "processes-dock";
