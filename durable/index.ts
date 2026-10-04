import {
  defineExtension,
  type Extension,
  section,
} from "@earendil-works/pi-durable";
import type { ProcessManager } from "../src/manager";
import { createProcessTask } from "./process-task";
import { ProcessRuntime, type RuntimeOptions } from "./runtime";
import { createProcessTool } from "./tool";

export { ProcessManager } from "../src/manager";
export type { ProcessNotification } from "./notifications";
export type {
  ProcessTaskInput,
  ProcessTaskResult,
  ProcessTaskState,
} from "./process-task";
export type { ProcessParams } from "./schema";

export type ProcessExtensionOptions = RuntimeOptions;

export interface ProcessExtension extends Extension {
  readonly manager: ProcessManager;
  dispose(): void;
  [Symbol.dispose](): void;
}

export function createProcessExtension(
  options: ProcessExtensionOptions = {},
): ProcessExtension {
  const runtime = new ProcessRuntime(options);
  const ProcessTask = createProcessTask(runtime);
  const extension = defineExtension({
    name: "pi-processes",
    tools: [createProcessTool(runtime, ProcessTask)],
    tasks: [ProcessTask],
    sections: [
      section("processes", () =>
        [
          "Use process for long-running local commands instead of &, nohup, or setsid. Check process list to avoid duplicates.",
          "process start creates a background lifecycle task and returns immediately. Do not sleep or poll. Notifications go to the host with the initiating conversation and task address; the host controls delivery.",
          "Use process update to change log watches without restarting. Failures always notify; intentional stops use context attention.",
          "Processes and watches are in memory only. Recovery never repeats a spawn or stdin write. A lost task does not prove that the command stopped; inspect external state before starting another.",
        ].join("\n"),
      ),
    ],
  });
  return Object.assign(extension, {
    manager: runtime.manager,
    dispose: () => runtime.dispose(),
    [Symbol.dispose]: () => runtime.dispose(),
  });
}
