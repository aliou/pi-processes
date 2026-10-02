import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Env for a spawned process: the parent env plus the same PI_* session
 * variables pi's bash tool exposes.
 */
export function buildSessionEnv(ctx: ExtensionContext): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (sessionFile) env.PI_SESSION_FILE = sessionFile;
  if (ctx.model) {
    env.PI_PROVIDER = ctx.model.provider;
    env.PI_MODEL = ctx.model.id;
  }
  if (ctx.thinkingLevel) env.PI_REASONING_LEVEL = ctx.thinkingLevel;
  return env;
}
