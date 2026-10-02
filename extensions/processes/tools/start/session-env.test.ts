import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildSessionEnv } from "./session-env";

function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    sessionManager: {
      getSessionId: () => "session-123",
      getSessionFile: () => "/tmp/session-123.jsonl",
    },
    model: { provider: "neuralwatt", id: "glm-5.3-flash-flex" },
    thinkingLevel: "high",
    ...overrides,
  } as unknown as ExtensionContext;
}

describe("buildSessionEnv", () => {
  it("injects the same PI_* session variables as pi's bash tool", () => {
    const env = buildSessionEnv(makeCtx());

    expect(env.PI_SESSION_ID).toBe("session-123");
    expect(env.PI_SESSION_FILE).toBe("/tmp/session-123.jsonl");
    expect(env.PI_PROVIDER).toBe("neuralwatt");
    expect(env.PI_MODEL).toBe("glm-5.3-flash-flex");
    expect(env.PI_REASONING_LEVEL).toBe("high");
  });

  it("copies the parent environment instead of mutating process.env", () => {
    const before = { ...process.env };
    const env = buildSessionEnv(makeCtx());

    env.PI_SESSION_ID = "changed";
    expect({ ...process.env }).toEqual(before);
    expect(env.PI_CODING_AGENT).toBe(process.env.PI_CODING_AGENT);
  });

  it("leaves PI_SESSION_FILE to the ambient env when the session has no file", () => {
    const env = buildSessionEnv(
      makeCtx({
        sessionManager: {
          getSessionId: () => "session-123",
          getSessionFile: () => undefined,
        },
      } as unknown as Partial<ExtensionContext>),
    );

    expect(env.PI_SESSION_ID).toBe("session-123");
    // Passthrough: an ambient value is not ours to replace.
    expect(env.PI_SESSION_FILE).toBe(process.env.PI_SESSION_FILE);
  });

  it("leaves provider, model, and reasoning level to the ambient env when no model is set", () => {
    const env = buildSessionEnv(
      makeCtx({ model: undefined, thinkingLevel: undefined }),
    );

    expect(env.PI_SESSION_ID).toBe("session-123");
    expect(env.PI_PROVIDER).toBe(process.env.PI_PROVIDER);
    expect(env.PI_MODEL).toBe(process.env.PI_MODEL);
    expect(env.PI_REASONING_LEVEL).toBe(process.env.PI_REASONING_LEVEL);
  });
});
