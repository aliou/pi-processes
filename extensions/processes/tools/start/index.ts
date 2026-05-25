import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import type { NotifyConfig } from "../../notifications/registry";
import { normalizeNotifyConfig } from "../notify";
import type { ProcessesParamsType } from "../schema";

export interface StartDetails {
  action: "start";
  process: ProcessInfo;
  notify: NotifyConfig;
}

export function executeStart(
  params: ProcessesParamsType,
  manager: ProcessManager,
  ctx: ExtensionContext,
): StartDetails {
  if (!params.name) {
    throw new Error("process start requires name");
  }

  if (!params.command) {
    throw new Error("process start requires command");
  }

  const notify = normalizeNotifyConfig(params.notify);

  return {
    action: "start",
    process: manager.start(params.name, params.command, ctx.cwd),
    notify,
  };
}

export function formatStartDetails(details: StartDetails): string {
  const process = details.process;
  return `Started process ${process.name} (${process.id}) with pid ${process.pid}.`;
}
