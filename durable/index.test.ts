import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  type FauxProviderHandle,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  type Conversation,
  createRegistry,
  Harness,
  MemoryStorage,
  type TaskId,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { assert, expect, vi } from "vitest";
import { ProcessManager } from "../src/manager";
import { test } from "../tests/e2e/fixtures";
import {
  createProcessExtension,
  type ProcessNotification,
  type ProcessParams,
  type ProcessTaskResult,
} from ".";
import { createProcessTask } from "./process-task";
import { ProcessRuntime } from "./runtime";

const context = BACKGROUND_CONTEXT;

function setup() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

async function call(
  conversation: Conversation,
  faux: FauxProviderHandle,
  params: ProcessParams,
) {
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("process", params)], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const submission = await conversation.submit(
    { type: "input", content: "run" },
    context,
  );
  const settled = await submission.wait(context);
  expect(settled.status).toBe("done");
  const entries = await conversation.entries({}, 100, undefined, context);
  const result = entries.items.find((entry) => entry.kind === "pi.tool-result")
    ?.model?.[0];
  assert(result?.role === "toolResult");
  expect(result.isError).toBeFalsy();
  return result.details as Record<string, unknown>;
}

test("tracks a background task, routes late notifications to its child, and aborts to stop", async ({
  cwd,
  addScript,
}) => {
  addScript("stdin-echo.sh");
  const notifications: ProcessNotification[] = [];
  const ready = Promise.withResolvers<void>();
  const extension = createProcessExtension({
    onNotification(notification) {
      notifications.push(notification);
      if (notification.kind === "log_match") ready.resolve();
    },
  });
  const manager = extension.manager;
  const { faux, models } = setup();
  const registry = createRegistry();
  expect(extension.tools?.[0]?.replay).toBe("unsafe");
  registry.install(extension);
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      models,
      registry,
      env: ({ cwd: dir }) => new NodeExecutionEnv({ cwd: dir ?? cwd }),
    },
    context,
  );
  try {
    const root = await harness.root(context);
    const child = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: { provider: "faux", modelId: "faux-1" }, cwd },
      },
      context,
    );
    const details = await call(child, faux, {
      action: "start",
      name: "child-repl",
      command: "./stdin-echo.sh",
      notify: { logMatches: [{ pattern: "stdin repl ready" }] },
    });
    const taskId = details.taskId as TaskId<ProcessTaskResult>;
    await ready.promise;
    const found = manager.list()[0];
    assert(found);
    const task = await harness.getTask(taskId, context);
    expect(task).toMatchObject({
      kind: "pi-processes.process",
      background: true,
      conversationId: child.id,
      input: { command: "./stdin-echo.sh", cwd, conversationId: child.id },
      state: {
        checkpoint: {
          phase: "observe",
          processId: found.id,
          stdoutFile: found.stdoutFile,
          stderrFile: found.stderrFile,
        },
      },
    });
    const output = await call(child, faux, { action: "output", id: found.id });
    expect(output).toMatchObject({ stdout: ["stdin repl ready"] });
    await harness.abortTask(taskId, context);
    const terminal = await harness.waitForTask(taskId, context);
    expect(terminal.state.outcome.status).toBe("aborted");
    expect(manager.get(found.id)?.status).toBe("killed");
    expect(notifications.map((n) => n.conversationId)).toEqual([
      child.id,
      child.id,
    ]);
    expect(notifications.at(-1)?.attention).toBe("context");
    const rootEntries = await root.entries({}, 100, undefined, context);
    expect(rootEntries.items).toHaveLength(0);
  } finally {
    await harness.close(context);
    extension.dispose();
  }
});

test("records immediate spawn failure and its configured notification address", async ({
  cwd,
}) => {
  const notice = Promise.withResolvers<ProcessNotification>();
  const extension = createProcessExtension({ onNotification: notice.resolve });
  const { faux, models } = setup();
  const registry = createRegistry();
  registry.install(extension);
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry },
    context,
  );
  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    const result = await call(root, faux, {
      action: "start",
      name: "missing",
      command: "true",
      cwd: join(cwd, "missing"),
      notify: { onFailure: "ignore" },
    });
    const taskId = result.taskId as TaskId<ProcessTaskResult>;
    const notification = await notice.promise;
    expect(notification).toMatchObject({
      kind: "crash",
      attention: "context",
      conversationId: root.id,
      taskId,
    });
    const task = await harness.waitForTask(taskId, context);
    expect(task.state.outcome).toMatchObject({
      status: "completed",
      result: { status: "ended", process: { success: false } },
    });
  } finally {
    await harness.close(context);
    extension.dispose();
  }
});

test("reports lost manager state on reopen without spawning again", async ({
  cwd,
  addScript,
}) => {
  addScript("stdin-echo.sh");
  let extension = createProcessExtension();
  const { faux, models } = setup();
  const registry = createRegistry();
  registry.install(extension);
  const open = async () =>
    Harness.open(
      await openNodeJsonlStorage(join(cwd, "storage"), context),
      { models, registry },
      context,
    );
  let harness = await open();
  const ready = Promise.withResolvers<void>();
  extension.manager.onEvent((event) => {
    if (event.type === "process_started") ready.resolve();
  });
  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" }, cwd },
    });
    const result = await call(root, faux, {
      action: "start",
      name: "repl",
      command: "./stdin-echo.sh",
    });
    await ready.promise;
    const taskId = result.taskId as TaskId<ProcessTaskResult>;
    await harness.close(context);
    extension.dispose();
    const lost = Promise.withResolvers<ProcessNotification>();
    extension = createProcessExtension({ onNotification: lost.resolve });
    let spawns = 0;
    extension.manager.onEvent((event) => {
      if (event.type === "process_started") spawns++;
    });
    registry.install(extension);
    harness = await open();
    const terminal = await harness.waitForTask(taskId, context);
    expect(terminal.state.outcome).toMatchObject({
      status: "completed",
      result: { status: "lost", reason: "manager_state_lost" },
    });
    const notification = await lost.promise;
    expect(notification).toMatchObject({
      kind: "tracking_lost",
      conversationId: root.id,
      taskId,
      attention: "context",
    });
    expect(spawns).toBe(0);
  } finally {
    await harness.close(context);
    extension.dispose();
  }
});

test("does not spawn from an uncertain checkpoint", async ({ cwd }) => {
  const processes = new ProcessRuntime({});
  const { models } = setup();
  const registry = createRegistry();
  const ProcessTask = createProcessTask(processes);
  const interrupted = {
    ...ProcessTask,
    definition: {
      ...ProcessTask.definition,
      initial: () => ({
        phase: "observe" as const,
        processId: null,
        stdoutFile: null,
        stderrFile: null,
      }),
    },
  };
  registry.install({ name: "test-process-task", tasks: [interrupted] });
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry },
    context,
  );
  try {
    const root = await harness.root(context);
    const taskId = await root.commit(
      (tx) =>
        tx.createTask(
          interrupted,
          {
            conversationId: root.id,
            runtimeId: processes.id,
            command: "true",
            name: "uncertain",
            cwd,
            notify: {},
          },
          { ownership: { kind: "conversation" }, background: true },
        ),
      context,
    );
    const terminal = await harness.waitForTask(taskId, context);
    expect(terminal.state.outcome).toMatchObject({
      status: "completed",
      result: { status: "lost", reason: "spawn_outcome_unknown" },
    });
    expect(processes.manager.list()).toEqual([]);
  } finally {
    await harness.close(context);
    processes.dispose();
  }
});

for (const action of ["start", "write"] as const) {
  test(`does not replay an interrupted ${action} tool`, async ({
    cwd,
    addScript,
  }) => {
    addScript("stdin-echo.sh");
    const extension = createProcessExtension({ cwd });
    const manager = extension.manager;
    const { faux, models } = setup();
    const registry = createRegistry();
    const tool = extension.tools?.[0];
    assert(tool);
    const reached = Promise.withResolvers<void>();
    const spawned = Promise.withResolvers<void>();
    manager.onEvent((event) => {
      if (event.type === "process_started") spawned.resolve();
    });
    let executions = 0;
    registry.install({
      ...extension,
      tools: [
        {
          ...tool,
          async execute(params, api, callContext) {
            executions++;
            const result = await tool.execute(params, api, callContext);
            if (result.details !== undefined)
              await api.details(result.details, callContext);
            reached.resolve();
            const signal = callContext.abortSignal;
            assert(signal);
            await new Promise((_resolve, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              }),
            );
            return result;
          },
        },
      ],
    });
    const open = async () =>
      Harness.open(
        await openNodeJsonlStorage(join(cwd, "storage"), context),
        { models, registry },
        context,
      );
    let harness = await open();
    try {
      const root = await harness.root(context, {
        agent: { model: { provider: "faux", modelId: "faux-1" }, cwd },
      });
      let params: ProcessParams = {
        action: "start",
        name: "repl",
        command: "./stdin-echo.sh",
      };
      if (action === "write") {
        const started = manager.start("repl", "./stdin-echo.sh", cwd);
        params = { action: "write", id: started.id, input: "hello\n" };
      }
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("process", params)], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("recovered"),
      ]);
      const submission = await root.submit(
        { type: "input", content: "run" },
        context,
      );
      await reached.promise;
      await spawned.promise;
      await harness.close(context);
      harness = await open();
      const resumed = await harness.submission(submission.id, context);
      assert(resumed);
      const settled = await resumed.wait(context);
      expect(settled.status).toBe("done");
      expect(executions).toBe(1);
      expect(manager.list()).toHaveLength(1);
      const conversation = await harness.root(context);
      const entries = await conversation.entries({}, 100, undefined, context);
      const result = entries.items.find(
        (entry) => entry.kind === "pi.tool-result",
      )?.model?.[0];
      assert(result?.role === "toolResult");
      expect(result.isError).toBe(true);
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining("interrupted"),
          }),
        ]),
      );
    } finally {
      await harness.close(context);
      extension.dispose();
    }
  });
}

test("supports list, watch updates, stdin, bounded output, stop, and clear", async ({
  cwd,
  addScript,
}) => {
  addScript("stdin-echo.sh");
  const ready = Promise.withResolvers<void>();
  const extension = createProcessExtension({
    onNotification(note) {
      if (note.kind === "log_match") ready.resolve();
    },
  });
  const { faux, models } = setup();
  const registry = createRegistry();
  registry.install(extension);
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry },
    context,
  );
  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" }, cwd },
    });
    const started = await call(root, faux, {
      action: "start",
      name: "repl",
      command: "./stdin-echo.sh",
      notify: {
        onSuccess: "ignore",
        logMatches: [{ pattern: "stdin repl ready" }],
      },
    });
    await ready.promise;
    const info = extension.manager.list()[0];
    assert(info);
    const listed = await call(root, faux, {
      action: "list",
      statuses: ["running"],
    });
    expect(listed).toMatchObject({
      processes: [{ id: info.id, taskId: started.taskId }],
    });
    for (const mode of ["append", "replace", "remove", "clear"] as const) {
      const items = mode === "remove" ? [{ index: 0 }] : [{ pattern: "echo:" }];
      const updated = await call(root, faux, {
        action: "update",
        id: info.id,
        name: "renamed",
        watches: { mode, items },
      });
      expect(updated).toMatchObject({ name: "renamed" });
    }
    const written = await call(root, faux, {
      action: "write",
      id: info.id,
      input: "hello\n",
      end: true,
    });
    expect(written).toMatchObject({ ok: true, bytes: 6 });
    await harness.waitForTask(
      started.taskId as TaskId<ProcessTaskResult>,
      context,
    );
    const output = await call(root, faux, {
      action: "output",
      id: info.id,
      pattern: "hello",
    });
    expect(output.stdout).toEqual(
      expect.arrayContaining([expect.stringContaining("hello")]),
    );
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(50 * 1024);
    const cleared = await call(root, faux, { action: "clear" });
    expect(cleared).toMatchObject({ cleared: 1 });
    const restarted = await call(root, faux, {
      action: "start",
      name: "repl",
      command: "./stdin-echo.sh",
    });
    const running = Promise.withResolvers<void>();
    const stopListening = extension.manager.onEvent(() => {
      if (extension.manager.list().length) running.resolve();
    });
    if (extension.manager.list().length) running.resolve();
    await running.promise;
    stopListening();
    const second = extension.manager.list()[0];
    assert(second);
    const stopped = await call(root, faux, { action: "stop", id: second.id });
    expect(stopped).toMatchObject({ results: [{ ok: true }] });
    const terminal = await harness.waitForTask(
      restarted.taskId as TaskId<ProcessTaskResult>,
      context,
    );
    expect(terminal.state.outcome.status).toBe("completed");
  } finally {
    await harness.close(context);
    extension.dispose();
  }
});

test("disposes only integration state for a borrowed manager", async ({
  cwd,
  addScript,
}) => {
  addScript("stdin-echo.sh");
  const manager = new ProcessManager();
  const extension = createProcessExtension({ manager });
  const info = manager.start("borrowed", "./stdin-echo.sh", cwd);
  try {
    extension.dispose();
    extension.dispose();
    expect(manager.get(info.id)?.status).toBe("running");
    const stopped = await manager.kill(info.id);
    expect(stopped.ok).toBe(true);
  } finally {
    manager.cleanup();
  }
});

test("uses explicit execution settings and native text limits without unbounded JSON details", async ({
  cwd,
  addFile,
  addScript,
}) => {
  addScript("wait-for-file.sh");
  addFile("payload", `${'"\\\u0001'.repeat(32_000)}\n`);
  const env = { PATH: process.env.PATH, PROCESS_FIXTURE_ENV: "configured" };
  const extension = createProcessExtension({ cwd, env });
  const spawn = vi.spyOn(extension.manager, "start");
  const { faux, models } = setup();
  const registry = createRegistry();
  registry.install(extension);
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry },
    context,
  );
  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    const command =
      'printf "%s\\n" "$PROCESS_FIXTURE_ENV"; ./wait-for-file.sh released; cat payload';
    const started = await call(root, faux, {
      action: "start",
      name: "bounded",
      command,
    });
    addFile("released");
    const task = await harness.waitForTask(
      started.taskId as TaskId<ProcessTaskResult>,
      context,
    );
    expect(spawn).toHaveBeenCalledExactlyOnceWith("bounded", command, cwd, env);
    expect(task.input).not.toHaveProperty("env");
    const info = extension.manager.list()[0];
    assert(info);
    expect(extension.manager.getOutput(info.id)?.stdout[0]).toBe("configured");
    const output = await call(root, faux, { action: "output", id: info.id });
    expect(output.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(50 * 1024);
    const entries = await root.entries({}, 100, undefined, context);
    const entry = entries.items.find((item) => item.kind === "pi.tool-result");
    assert(entry);
    expect(entry.data).toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "truncated" }),
      ]),
    });
    const message = entry.model?.[0];
    assert(message?.role === "toolResult");
    const bytes = message.content.reduce(
      (total, block) =>
        total + (block.type === "text" ? Buffer.byteLength(block.text) : 0),
      0,
    );
    expect(bytes).toBeLessThan(50 * 1024 + 4096);
  } finally {
    await harness.close(context);
    extension.dispose();
  }
});
