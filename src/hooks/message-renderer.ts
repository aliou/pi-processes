import type {
  ExtensionAPI,
  MessageRenderOptions,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { MESSAGE_TYPE_PROCESS_UPDATE } from "../constants";

interface ProcessLifecycleDetails {
  kind?: "lifecycle";
  processId: string;
  processName: string;
  command: string;
  status: "exited" | "killed";
  exitCode: number | null;
  success: boolean;
  runtime: string;
}

interface ProcessWatchMatchDetails {
  kind: "watch_matched";
  processId: string;
  processName: string;
  command: string;
  source: "stdout" | "stderr";
  line: string;
  watch: {
    index: number;
    pattern: string;
    stream: "stdout" | "stderr" | "both";
    repeat: boolean;
  };
}

interface ProcessUpdateMessage {
  customType: string;
  content: string | Array<{ type: string; text?: string }>;
  details?: ProcessLifecycleDetails | ProcessWatchMatchDetails;
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
  pi.registerMessageRenderer<
    ProcessLifecycleDetails | ProcessWatchMatchDetails
  >(
    MESSAGE_TYPE_PROCESS_UPDATE,
    (
      message: ProcessUpdateMessage,
      _options: MessageRenderOptions,
      theme: Theme,
    ) => {
      const details = message.details;

      if (!details) {
        return new Text(getContentText(message.content), 0, 0);
      }

      if (details.kind === "watch_matched") {
        const streamColor = details.source === "stderr" ? "warning" : "accent";
        const text =
          theme.fg("success", "* ") +
          theme.fg("accent", `"${details.processName}"`) +
          theme.fg("muted", ` (${details.processId}) `) +
          theme.fg("success", "watch matched ") +
          theme.fg("muted", `/${details.watch.pattern}/ `) +
          theme.fg(streamColor, `[${details.source}]`) +
          theme.fg("muted", ` ${details.line}`);

        return new Text(text, 0, 0);
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
}
