import { describe, expect, it } from "vitest";

import { isBackgroundCommand } from "./background-blocker";

describe("isBackgroundCommand", () => {
  it("blocks trailing ampersand", () => {
    expect(isBackgroundCommand("sleep 10 &")).toBe(true);
    expect(isBackgroundCommand("server &")).toBe(true);
  });

  it("blocks & at end of command with no trailing space", () => {
    expect(isBackgroundCommand("sleep 10&")).toBe(true);
  });

  it("blocks nohup as first command", () => {
    expect(isBackgroundCommand("nohup ./server.sh")).toBe(true);
    expect(isBackgroundCommand("nohup node app.js &")).toBe(true);
    expect(isBackgroundCommand("nohup")).toBe(true);
  });

  it("blocks nohup after shell operators", () => {
    expect(isBackgroundCommand("sleep 10; nohup ./server.sh")).toBe(true);
    expect(isBackgroundCommand("ls | nohup cat")).toBe(true);
    expect(isBackgroundCommand("true && nohup ./server.sh")).toBe(true);
    expect(isBackgroundCommand("build || nohup ./fallback.sh")).toBe(true);
  });

  it("blocks disown as first command or after operators", () => {
    expect(isBackgroundCommand("disown %1")).toBe(true);
    expect(isBackgroundCommand("disown -h %2")).toBe(true);
    expect(isBackgroundCommand("disown")).toBe(true);
    expect(isBackgroundCommand("true && disown")).toBe(true);
  });

  it("blocks setsid as first command or after operators", () => {
    expect(isBackgroundCommand("setsid ./daemon")).toBe(true);
    expect(isBackgroundCommand("setsid node watcher.js")).toBe(true);
    expect(isBackgroundCommand("setsid")).toBe(true);
    expect(isBackgroundCommand("true || setsid ./daemon")).toBe(true);
  });

  it("allows regular commands", () => {
    expect(isBackgroundCommand("echo hello")).toBe(false);
    expect(isBackgroundCommand("pnpm dev")).toBe(false);
    expect(isBackgroundCommand("ls -la")).toBe(false);
    expect(isBackgroundCommand("git status")).toBe(false);
  });

  it("allows logical AND (&&)", () => {
    expect(isBackgroundCommand("pnpm build && pnpm test")).toBe(false);
    expect(isBackgroundCommand("cd /tmp && ls")).toBe(false);
  });

  it("does not block nohup/disown/setsid as arguments to other commands", () => {
    expect(isBackgroundCommand("echo nohup")).toBe(false);
    expect(isBackgroundCommand("echo disown")).toBe(false);
    expect(isBackgroundCommand("echo setsid")).toBe(false);
  });

  it("does not block keywords as substring of file paths", () => {
    expect(isBackgroundCommand("cat /path/nohup.log")).toBe(false);
  });

  it("handles empty and whitespace-only commands", () => {
    expect(isBackgroundCommand("")).toBe(false);
    expect(isBackgroundCommand("  ")).toBe(false);
  });

  it("falls back to regex for malformed shell commands", () => {
    // This is syntactically invalid; the parser will throw and we
    // fall back to a trailing & regex.
    expect(isBackgroundCommand("something &")).toBe(true);
  });
});
