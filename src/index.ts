import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MARKER_DIR = join(homedir(), ".pi", "agent", "extensions", "migrations");
const MARKER_FILE = join(MARKER_DIR, "processes-moved");

export default async function (pi: ExtensionAPI) {
  if (existsSync(MARKER_FILE)) return;

  pi.on("session_start", async (_event, ctx) => {
    if (existsSync(MARKER_FILE)) return;

    if (ctx.hasUI) {
      ctx.ui.notify(
        "@aliou/pi-processes has moved to its own repo. " +
          "Run: pi install npm:@aliou/pi-processes -- " +
          "then remove it from the pi-extensions package config.",
        "warning",
      );
    }

    mkdirSync(MARKER_DIR, { recursive: true });
    writeFileSync(MARKER_FILE, new Date().toISOString());
  });
}
