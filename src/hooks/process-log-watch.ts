import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { MESSAGE_TYPE_PROCESS_LOG_MATCH } from "../constants";
import type { ProcessManager } from "../manager";
import { formatRuntime } from "../utils";

interface ProcessLogMatchDetails {
  processId: string;
  processName: string;
  command: string;
  stream: "stdout" | "stderr";
  line: string;
  pattern: string;
  flags: string;
  matchCount: number;
  runtime: string;
}

function truncateLine(line: string, max = 200): string {
  if (line.length <= max) {
    return line;
  }
  return `${line.slice(0, max - 1)}…`;
}

export function setupProcessLogWatchHook(
  pi: ExtensionAPI,
  manager: ProcessManager,
) {
  manager.onEvent((event) => {
    if (event.type !== "process_log_matched") return;

    const runtime = formatRuntime(event.info.startTime, Date.now());
    const line = truncateLine(event.match.line);
    const pattern = `/${event.match.pattern}/${event.match.flags}`;
    const streamLabel = event.match.stream === "stderr" ? "stderr" : "stdout";
    const message = `Process '${event.info.name}' matched log watch ${pattern} on ${streamLabel}: ${line}`;

    const details: ProcessLogMatchDetails = {
      processId: event.info.id,
      processName: event.info.name,
      command: event.info.command,
      stream: event.match.stream,
      line,
      pattern: event.match.pattern,
      flags: event.match.flags,
      matchCount: event.match.matchCount,
      runtime,
    };

    pi.sendMessage(
      {
        customType: MESSAGE_TYPE_PROCESS_LOG_MATCH,
        content: message,
        display: true,
        details,
      },
      { triggerTurn: true },
    );
  });
}
