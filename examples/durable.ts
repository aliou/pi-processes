import { createProcessExtension } from "@aliou/pi-processes/durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createRegistry,
  Harness,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

const context = BACKGROUND_CONTEXT;
const finished = Promise.withResolvers<void>();
let delivery = Promise.resolve();
const extension = createProcessExtension({
  onNotification(notification) {
    delivery = delivery.then(async () => {
      const conversation = await harness.conversation(
        notification.conversationId,
        context,
      );
      if (!conversation) return;
      // This host records passive notes. Turn attention can submit input instead.
      await conversation.submit(
        {
          type: "write",
          entry: {
            kind: "app.process-notification",
            data: {
              summary: notification.summary,
              attention: notification.attention,
            },
          },
        },
        context,
      );
      if (notification.kind !== "log_match") finished.resolve();
    });
  },
});
const registry = createRegistry();
registry.install(extension);
const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
const harness = await Harness.open(
  new MemoryStorage(),
  {
    models,
    registry,
    env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }),
  },
  context,
);
try {
  const root = await harness.root(context, {
    agent: { model: { provider: "faux", modelId: "faux-1" } },
  });
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("process", {
          action: "start",
          name: "hello",
          command: "printf 'hello\\n'",
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("The command is scheduled."),
  ]);
  const started = await root.submit(
    { type: "input", content: "Start the hello command." },
    context,
  );
  await started.wait(context);
  await finished.promise;
  const processInfo = extension.manager.list()[0];
  if (!processInfo) throw new Error("Process missing");
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("process", { action: "output", id: processInfo.id })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("The command printed hello."),
  ]);
  const inspected = await root.submit(
    { type: "input", content: "Inspect the output." },
    context,
  );
  await inspected.wait(context);
  console.log(extension.manager.getOutput(processInfo.id));
} finally {
  await delivery
    .finally(() => harness.close(context))
    .finally(() => extension.dispose());
}
