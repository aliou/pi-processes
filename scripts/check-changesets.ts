#!/usr/bin/env node
// Validates .changeset/*.md files: frontmatter shape, package names, bump types.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const changesetDir = join(root, ".changeset");
const validBumps = new Set(["major", "minor", "patch"]);

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
};
const pkgName = pkg.name;
const knownPackages = new Set([pkgName]);

const files = readdirSync(changesetDir)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort();

const errors: string[] = [];

for (const file of files) {
  const path = join(".changeset", file);
  const content = readFileSync(join(changesetDir, file), "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    errors.push(`${path}: missing or malformed frontmatter block`);
    continue;
  }

  const [, frontmatter, body] = match;
  const lines = frontmatter.split(/\r?\n/).filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    errors.push(`${path}: frontmatter lists no packages`);
  }

  for (const line of lines) {
    const entry = line.match(
      /^\s*(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(.+?)\s*$/,
    );
    if (!entry) {
      errors.push(`${path}: cannot parse frontmatter line: ${line.trim()}`);
      continue;
    }

    const name = entry[1] ?? entry[2] ?? entry[3];
    const bump = entry[4].replace(/^["']|["']$/g, "");

    if (!knownPackages.has(name)) {
      errors.push(
        `${path}: unknown package "${name}" (expected one of: ${[...knownPackages].join(", ")})`,
      );
    }
    if (!validBumps.has(bump)) {
      errors.push(
        `${path}: invalid bump "${bump}" for "${name}" (expected major, minor or patch)`,
      );
    }
  }

  if (body.trim() === "") {
    errors.push(`${path}: empty changeset description`);
  }
}

if (errors.length > 0) {
  console.error("Invalid changesets:\n");
  for (const error of errors) {
    console.error(`  ${error}`);
  }
  console.error("");
  process.exit(1);
}

console.log(
  `Checked ${files.length} changeset${files.length === 1 ? "" : "s"}.`,
);
