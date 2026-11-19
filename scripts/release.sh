#!/usr/bin/env bash
# Release script for opencode-vcc-compaction.
# Modeled on opencode-dev-framework's scripts/release.sh, adapted to this
# repo: no root package.json and no build, so the version lives in
# vcc-plugin/package.json (bumped with node, not `npm version`) and
# validation is the project's own gate commands.
#
# Usage:
#   ./scripts/release.sh [patch|minor|major]
#
# Defaults to `patch` if no bump type is given.
#
# First release (v0.1.0, version + CHANGELOG section already seeded):
# do NOT run this script — it would bump to v0.1.1 and skip v0.1.0.
# Commit, push, tag v0.1.0 directly (`git tag -a v0.1.0 -m "Release
# v0.1.0" && git push origin main v0.1.0`); the tag push triggers the
# publish workflow. This script is for every release after that.
#
# What it does:
#   1. Runs the full validation suite (typecheck, both selftests,
#      engine-sync, markdown lint).
#   2. Bumps the version in vcc-plugin/package.json.
#   3. Prepends a CHANGELOG.md section (full history on the first release,
#      tag range afterwards).
#   4. Commits and creates an annotated git tag.
#   5. Prints the push command (does NOT push automatically).
set -euo pipefail

BUMP="${1:-patch}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: $0 [patch|minor|major]" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree dirty — commit or stash unrelated changes, then re-run." >&2
  exit 1
fi

echo "==> Running validation..."
node --check vcc-plugin/index.ts
node compiler/selftest.mjs
node vcc-plugin/selftest.mjs
node scripts/check-engine-sync.mjs
npx --yes markdownlint-cli2 "**/*.md"

echo ""
echo "==> Bumping version (vcc-plugin/package.json)..."
node -e '
// Targeted version-line replacement (not a full re-serialize) so the
// bump never reformats the rest of package.json.
const fs = require("fs");
const f = "vcc-plugin/package.json";
const current = JSON.parse(fs.readFileSync(f, "utf8")).version.split(".").map(Number);
const bump = process.argv[1];
if (bump === "major") { current[0] += 1; current[1] = 0; current[2] = 0; }
else if (bump === "minor") { current[1] += 1; current[2] = 0; }
else { current[2] += 1; }
const next = current.join(".");
const content = fs.readFileSync(f, "utf8").replace(/("version":\s*")[^"]+(")/, `$1${next}$2`);
fs.writeFileSync(f, content);
' "$BUMP"

NEW_VERSION=$(node -p "require('./vcc-plugin/package.json').version")
TAG="v$NEW_VERSION"

echo ""
echo "==> Generating changelog..."
PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
./scripts/changelog.sh "$PREV_TAG" "$NEW_VERSION"

echo ""
echo "==> Committing and tagging..."
git add vcc-plugin/package.json CHANGELOG.md
git commit -m "Release $TAG"
git tag -a "$TAG" -m "Release $TAG"

echo ""
echo "==> Done! Current plugin version: $NEW_VERSION"
echo ""
echo "To publish, push the tag (publishing itself is your action):"
echo "  git push origin main \"$TAG\""
echo ""
echo "A tag push triggers the publish workflow (.github/workflows/ci.yml),"
echo "which publishes from ./vcc-plugin with --provenance and cuts the"
echo "GitHub release from this version's CHANGELOG section."
