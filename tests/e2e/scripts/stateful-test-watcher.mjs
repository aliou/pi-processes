import { existsSync } from "node:fs";

const steps = [
  ["01-migrated", "missing table: customers"],
  ["02-seeded", "missing seed data: orders"],
  ["03-shipping", "missing shipping calculator"],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const [marker, failure] of steps) {
  console.log(`FAIL ${failure}`);

  while (!existsSync(marker)) {
    await sleep(50);
  }

  console.log(`PASS ${marker}`);
}

console.log("PASS all watched tests");

while (true) {
  await sleep(1000);
}
