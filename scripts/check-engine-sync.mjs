// Engine sync gate: vcc-plugin/engine/*.mjs must stay byte-identical to
// compiler/*.mjs. The published tarball ships engine/ (self-contained);
// compiler/ remains the reference source. Any engine fix lands in
// compiler/ first, then is re-vendored here — never edited in place.
//
// Run: `node scripts/check-engine-sync.mjs` (exit 0 = in sync).
// No dependencies, no network.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../compiler/", import.meta.url);
const DST = new URL("../vcc-plugin/engine/", import.meta.url);

const files = readdirSync(SRC).filter((f) => f.endsWith(".mjs") && f !== "selftest.mjs").sort();
let failures = 0;
for (const f of files) {
  let a, b;
  try {
    a = readFileSync(join(SRC.pathname, f));
  } catch {
    console.log(`FAIL: compiler/${f} missing`);
    failures += 1;
    continue;
  }
  try {
    b = readFileSync(join(DST.pathname, f));
  } catch {
    console.log(`FAIL: vcc-plugin/engine/${f} missing (re-vendor from compiler/)`);
    failures += 1;
    continue;
  }
  if (Buffer.compare(a, b) === 0) console.log(`ok: ${f} in sync`);
  else {
    console.log(`FAIL: vcc-plugin/engine/${f} diverged from compiler/${f} (re-vendor, never hand-edit)`);
    failures += 1;
  }
}

if (failures > 0) {
  console.log(`engine-sync FAILED: ${failures} file(s)`);
  process.exit(1);
}
console.log("engine-sync passed");
