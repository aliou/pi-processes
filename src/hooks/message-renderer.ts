import type {
  ExtensionAPI,
  MessageRenderOptions,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  MESSAGE_TYPE_PROCESS_LOG_MATCH,
  MESSAGE_TYPE_PROCESS_UPDATE,
} from "../constants";

interface ProcessUpdateDetails {
  processId: string;
  processName: string;
  command: string;
  status: "exited" | "killed";
  exitCode: number | null;
  success: boolean;
  runtime: string;
}

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

interface ProcessMessage<TDetails> {
  customType: string;
  content: string | Array<{ type: string; text?: string }>;
  details?: TDetails;
}

function getContentText(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text as string)
    .join("");
}

export function setupMessageRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer<ProcessUpdateDetails>(
    MESSAGE_TYPE_PROCESS_UPDATE,
    (
      message: ProcessMessage<ProcessUpdateDetails>,
      _options: MessageRenderOptions,
      theme: Theme,
    ) => {
      const details = message.details;

      if (!details) {
        return new Text(getContentText(message.content), 0, 0);
      }

      let icon: string;
      let color: "success" | "error" | "warning";

      if (details.status === "killed") {
        icon = "\u2717"; // x mark
        color = "warning";
      } else if (details.success) {
        icon = "\u2713"; // check mark
        color = "success";
      } else {
        icon = "\u2717"; // x mark
        color = "error";
      }

      const statusText =
        details.status === "killed"
          ? "terminated"
          : details.success
            ? "completed"
            : `exited(${details.exitCode ?? "?"})`;

      const text =
        theme.fg(color, `${icon} `) +
        theme.fg("accent", `"${details.processName}"`) +
        theme.fg("muted", ` (${details.processId})`) +
        " " +
        theme.fg(color, statusText) +
        theme.fg("muted", ` ${details.runtime}`);

      return new Text(text, 0, 0);
    },
  );

  pi.registerMessageRenderer<ProcessLogMatchDetails>(
    MESSAGE_TYPE_PROCESS_LOG_MATCH,
    (
      message: ProcessMessage<ProcessLogMatchDetails>,
      _options: MessageRenderOptions,
      theme: Theme,
    ) => {
      const details = message.details;

      if (!details) {
        return new Text(getContentText(message.content), 0, 0);
      }

      const pattern = `/${details.pattern}/${details.flags}`;
      const text =
        theme.fg("warning", "! ") +
        theme.fg("accent", `"${details.processName}"`) +
        theme.fg("muted", ` (${details.processId})`) +
        " " +
        theme.fg("warning", `matched ${pattern}`) +
        theme.fg("muted", ` ${details.stream} ${details.runtime}`) +
        " " +
        details.line;

      return new Text(text, 0, 0);
    },
  );
}
