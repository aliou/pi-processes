import { parse, type SimpleCommand } from "@aliou/sh";
import { describe, expect, it } from "vitest";

import { wordToString } from "./shell-utils";

function argsOf(source: string): string[] {
  const result = parse(source, { dialect: "bash" });
  const command = result.ast.body[0]?.command as SimpleCommand;
  if (!command.words) throw new Error(`No words parsed from: ${source}`);
  return command.words.map(wordToString);
}

describe("wordToString", () => {
  it("renders ANSI-C quoted words as their decoded value", () => {
    expect(argsOf("rm $'-rf /important'")).toEqual(["rm", "-rf /important"]);
    expect(argsOf("printf $'a\\nb\\t!~'")).toEqual(["printf", "a\nb\t!~"]);
  });

  it("renders locale translation strings from their inner parts", () => {
    expect(argsOf('echo $"hello world"')).toEqual(["echo", "hello world"]);
    expect(argsOf('echo $"hello $USER"')).toEqual(["echo", "hello $USER"]);
  });

  it("renders ANSI-C and locale parts inside composite words", () => {
    expect(argsOf("echo pre$'\\x41'$\"post\"")).toEqual(["echo", "preApost"]);
  });

  it("keeps expansions inside extglob patterns visible", () => {
    expect(argsOf("ls @(foo|$BAR)")).toEqual(["ls", "@(foo|$BAR)"]);
  });
});
