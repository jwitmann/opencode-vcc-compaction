#!/usr/bin/env node
// Engine sync gate: vcc-plugin/engine/ must mirror compiler/ exactly —
// every compiler/ module (except selftest.mjs) byte-identical in engine/,
// and no extra files in engine/ (extras would silently ship in the npm
// tarball). The published tarball ships engine/ (self-contained);
// compiler/ remains the reference source. Any engine fix lands in
// compiler/ first, then is re-vendored here — never edited in place.
//
// Run: `node scripts/check-engine-sync.mjs` (exit 0 = in sync).
// No dependencies, no network.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "compiler");
const DST = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "vcc-plugin",
  "engine",
);

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL: ${msg}`);
};

// selftest.mjs is a dev artifact on both sides, never vendored.
const srcFiles = readdirSync(SRC)
  .filter((f) => f !== "selftest.mjs")
  .sort();
const dstFiles = new Set(readdirSync(DST).sort());
for (const f of srcFiles) {
  let a, b;
  try {
    a = readFileSync(join(SRC, f));
  } catch {
    fail(`compiler/${f} unreadable`);
    continue;
  }
  if (!dstFiles.has(f)) {
    fail(`vcc-plugin/engine/${f} missing (re-vendor from compiler/)`);
    continue;
  }
  try {
    b = readFileSync(join(DST, f));
  } catch {
    fail(`vcc-plugin/engine/${f} unreadable`);
    continue;
  }
  if (Buffer.compare(a, b) === 0) console.log(`ok: ${f} in sync`);
  else {
    fail(
      `vcc-plugin/engine/${f} diverged from compiler/${f} (re-vendor, never hand-edit)`,
    );
  }
}
for (const f of [...dstFiles].sort()) {
  if (!srcFiles.includes(f)) {
    fail(
      `vcc-plugin/engine/${f} has no compiler/ counterpart (remove it — engine/ ships in the tarball)`,
    );
  }
}

if (failures > 0) {
  console.error(`engine-sync FAILED: ${failures} file(s)`);
  process.exit(1);
}
console.log("engine-sync passed");
