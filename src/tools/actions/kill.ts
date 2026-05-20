import { ToolCallHeader } from "@aliou/pi-utils-ui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ExecuteResult } from "../../constants";
import { t } from "../../i18n";
import type { ProcessManager } from "../../manager";

interface KillParams {
  id?: string;
}

export function renderKillCall(args: KillParams, theme: Theme): ToolCallHeader {
  return new ToolCallHeader(
    {
      toolName: "Process",
      action: "kill",
      mainArg: args.id,
    },
    theme,
  );
}

export async function executeKill(
  params: KillParams,
  manager: ProcessManager,
): Promise<ExecuteResult> {
  if (!params.id) {
    return {
      content: [{ type: "text", text: t("kill.missingId") }],
      details: {
        action: "kill",
        success: false,
        message: t("kill.missingId"),
      },
    };
  }

  const proc = manager.get(params.id);
  if (!proc) {
    const message = t("kill.notFound", { id: params.id });
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "kill",
        success: false,
        message,
      },
    };
  }

  const result = await manager.kill(proc.id, {
    signal: "SIGTERM",
    timeoutMs: 3000,
  });

  if (result.ok) {
    const message = t("kill.terminated", { name: proc.name, id: proc.id });
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "kill",
        success: true,
        message,
      },
    };
  }

  if (result.reason === "timeout") {
    const message = t("kill.timeout", { name: proc.name, id: proc.id });
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "kill",
        success: false,
        message,
      },
    };
  }

  const message = t("kill.failed", { name: proc.name, id: proc.id });
  return {
    content: [{ type: "text", text: message }],
    details: {
      action: "kill",
      success: false,
      message,
    },
  };
}
