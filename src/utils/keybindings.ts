/**
 * Keyboard shortcuts configuration for the Process Dock.
 */

export interface ProcessesKeybindings {
  /** Toggle dock visibility (global) */
  toggleDock: string;
  /** Scroll logs up */
  scrollUp: string;
  /** Scroll logs down */
  scrollDown: string;
  /** Focus previous process */
  prevProcess: string;
  /** Focus next process */
  nextProcess: string;
  /** Toggle focus mode */
  toggleFocus: string;
  /** Toggle follow mode */
  toggleFollow: string;
  /** Kill focused process */
  killProcess: string;
  /** Clear finished processes */
  clearFinished: string;
  /** Collapse/close dock */
  closeDock: string;
}

export const DEFAULT_KEYBINDINGS: ProcessesKeybindings = {
  toggleDock: "", // Disabled - conflicts with editor shortcuts
  scrollUp: "k",
  scrollDown: "j",
  prevProcess: "h",
  nextProcess: "l",
  toggleFocus: "f",
  toggleFollow: "Shift+F",
  killProcess: "x",
  clearFinished: "c",
  closeDock: "q",
};

/**
 * Interface for config that may contain keybindings overrides
 */
export interface ProcessesConfigKeybindings {
  toggleDock?: string;
  scrollUp?: string;
  scrollDown?: string;
  prevProcess?: string;
  nextProcess?: string;
  toggleFocus?: string;
  toggleFollow?: string;
  killProcess?: string;
  clearFinished?: string;
  closeDock?: string;
}

/**
 * Load keybindings from config, falling back to defaults.
 */
export function loadKeybindings(config: {
  keybindings?: ProcessesConfigKeybindings;
}): ProcessesKeybindings {
  const user = config.keybindings ?? {};
  return {
    toggleDock: user.toggleDock ?? DEFAULT_KEYBINDINGS.toggleDock,
    scrollUp: user.scrollUp ?? DEFAULT_KEYBINDINGS.scrollUp,
    scrollDown: user.scrollDown ?? DEFAULT_KEYBINDINGS.scrollDown,
    prevProcess: user.prevProcess ?? DEFAULT_KEYBINDINGS.prevProcess,
    nextProcess: user.nextProcess ?? DEFAULT_KEYBINDINGS.nextProcess,
    toggleFocus: user.toggleFocus ?? DEFAULT_KEYBINDINGS.toggleFocus,
    toggleFollow: user.toggleFollow ?? DEFAULT_KEYBINDINGS.toggleFollow,
    killProcess: user.killProcess ?? DEFAULT_KEYBINDINGS.killProcess,
    clearFinished: user.clearFinished ?? DEFAULT_KEYBINDINGS.clearFinished,
    closeDock: user.closeDock ?? DEFAULT_KEYBINDINGS.closeDock,
  };
}
