#!/usr/bin/env node
// Evidence gate for opencode-vcc-port: the repo's verification standard is
// committed JSONL evidence plus parseable configs (there is no other test
// suite). Fails nonzero with a message per violation.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL: ${msg}`);
};
const ok = (msg) => console.log(`ok: ${msg}`);

// Strip // and /* */ comments outside string literals (JSONC).
function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

for (const f of [
  "probe-project/opencode.jsonc",
  "probe-plugin/package.json",
  ".markdownlint-cli2.jsonc",
]) {
  try {
    JSON.parse(stripJsonc(readFileSync(join(root, f), "utf8")));
    ok(`${f} parses`);
  } catch (e) {
    fail(`${f} does not parse: ${e.message}`);
  }
}

let jsonlFiles = [];
try {
  jsonlFiles = readdirSync(join(root, "probe-results")).filter((n) => n.endsWith(".jsonl"));
} catch (e) {
  fail(`probe-results unreadable: ${e.message}`);
}
if (jsonlFiles.length === 0) fail("probe-results holds no .jsonl evidence files");
for (const name of jsonlFiles) {
  let lines;
  try {
    lines = readFileSync(join(root, "probe-results", name), "utf8").split("\n");
  } catch (e) {
    fail(`${name} unreadable: ${e?.message ?? e}`);
    continue;
  }
  let n = 0;
  for (const [idx, line] of lines.entries()) {
    if (line.trim() === "") continue;
    n += 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch (e) {
      fail(`${name}:${idx + 1} is not JSON: ${e?.message ?? e}`);
      continue;
    }
    if (typeof record !== "object" || record === null) {
      fail(`${name}:${idx + 1} is not a JSON object`);
      continue;
    }
    for (const key of ["opencodeVersion", "pluginVersion", "branch"]) {
      if (typeof record[key] !== "string" || record[key] === "") {
        fail(`${name}:${idx + 1} missing non-empty string "${key}"`);
      }
    }
  }
  if (n === 0) fail(`${name} holds no result lines`);
  else ok(`${name}: ${n} version-tagged result lines`);
}

if (failures > 0) {
  console.error(`${failures} violation(s)`);
  process.exit(1);
}
console.log("evidence gate passed");
