import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), "pi-processes-package-"));

function run(
  command: string,
  args: string[],
  cwd: string,
  env = process.env,
): void {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
    );
}

function probe(cwd: string, source: string): void {
  const file = join(cwd, "probe.mjs");
  writeFileSync(file, source);
  run(process.execPath, [file], cwd);
}

try {
  run("pnpm", ["pack", "--pack-destination", temporary], root);
  const archive = readdirSync(temporary).find((name) => name.endsWith(".tgz"));
  assert(archive);
  const app = join(temporary, "app");
  mkdirSync(app);
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run(
    "npm",
    [
      "install",
      join(temporary, archive),
      "--ignore-scripts",
      "--omit=optional",
      "--no-audit",
      "--no-fund",
    ],
    app,
  );
  run(
    "npm",
    [
      "install",
      "typescript@5.9.3",
      "@types/node@25.0.10",
      "--ignore-scripts",
      "--omit=optional",
      "--no-audit",
      "--no-fund",
    ],
    app,
  );
  const typecheck = [
    "--noEmit",
    "--strict",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
  ];
  const tsc = join(app, "node_modules/typescript/bin/tsc");
  const installed = join(app, "node_modules/@aliou/pi-processes");
  const agentDir = join(temporary, "agent");
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
  const cli = fileURLToPath(
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  ).replace(/index\.js$/, "cli.js");
  run(process.execPath, [cli, "install", installed], app, env);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const loader = new DefaultResourceLoader({ cwd: app, agentDir });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const extensions = loaded.extensions.filter((extension) =>
    extension.resolvedPath.startsWith(installed),
  );
  assert.equal(extensions.length, 3);
  const commands = extensions.flatMap((extension) => [
    ...extension.commands.keys(),
  ]);
  for (const command of [
    "ps",
    "ps:logs",
    "ps:dock",
    "ps:pin",
    "ps:kill",
    "ps:clear",
    "ps:settings",
  ])
    assert(commands.includes(command));
  assert(extensions.some((extension) => extension.tools.has("process")));
  assert(
    loader.getSkills().skills.some((skill) => skill.name === "pi-processes"),
  );
  console.log(
    "pi install discovers and loads three extensions, commands, and the skill.",
  );

  run(
    "npm",
    [
      "install",
      "@earendil-works/pi-durable@1.0.1",
      "--ignore-scripts",
      "--omit=optional",
      "--no-audit",
      "--no-fund",
    ],
    app,
  );
  probe(
    app,
    `
    import assert from "node:assert/strict";
    import { createProcessExtension } from "@aliou/pi-processes/durable";
    import { createRegistry } from "@earendil-works/pi-durable";
    for (const name of ["pi-coding-agent", "pi-tui"]) {
      assert.throws(() => import.meta.resolve("@earendil-works/" + name));
    }
    assert.throws(() => import.meta.resolve("@aliou/pi-processes/core"));
    const registry = createRegistry();
    const extension = createProcessExtension();
    registry.install(extension);
    assert.equal(registry.snapshot().extension("pi-processes"), extension);
    assert.equal(extension.tools[0].replay, "unsafe");
    assert.equal(extension.tasks[0].definition.name, "pi-processes.process");
    extension.dispose();
  `,
  );
  writeFileSync(
    join(app, "consumer.mts"),
    'import { createProcessExtension } from "@aliou/pi-processes/durable"; import { createRegistry } from "@earendil-works/pi-durable"; const extension = createProcessExtension(); createRegistry().install(extension); extension.dispose();',
  );
  run(
    process.execPath,
    [tsc, ...typecheck, "--skipLibCheck", "consumer.mts"],
    app,
  );
  const example = join(app, "durable.ts");
  copyFileSync(join(installed, "examples/durable.ts"), example);
  run(process.execPath, ["--experimental-strip-types", example], app);
  console.log(
    "Packed /durable installs its native extension and ProcessTask in a registry.",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
