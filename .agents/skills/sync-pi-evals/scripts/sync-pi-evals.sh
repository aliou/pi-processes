#!/usr/bin/env bash
#
# Vendor the unpublished pi-evals harness into tests/evals/vendor/pi-evals.
#
# @earendil-works/pi-evals is private:true and not on npm, so it is copied from
# the pi repo at a pinned ref and patched. See the sync-pi-evals skill for ref
# selection and dependency reconciliation, which this script does NOT do.
#
# Usage:
#   sync-pi-evals.sh [--ref <tag|branch|sha>] [--repo <url>]
#
# Env:
#   PI_EVALS_REF   same as --ref
#   PI_EVALS_REPO  same as --repo

set -euo pipefail

DEFAULT_REF="v0.84.1"
DEFAULT_REPO="https://github.com/earendil-works/pi"

ref="${PI_EVALS_REF:-$DEFAULT_REF}"
repo="${PI_EVALS_REPO:-$DEFAULT_REPO}"

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) ref="${2:?--ref needs a value}"; shift 2 ;;
    --repo) repo="${2:?--repo needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Repo root is three levels up: scripts/ -> sync-pi-evals/ -> skills/ -> .agents/
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"

vendor_dir="$repo_root/tests/evals/vendor/pi-evals"
patch_dir="$repo_root/tests/evals/patches"

for cmd in git rsync; do
  command -v "$cmd" >/dev/null || { echo "missing required command: $cmd" >&2; exit 1; }
done

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

echo "==> Cloning $repo at $ref"
if ! git clone --depth 1 --branch "$ref" --quiet "$repo" "$tmp" 2>/dev/null; then
  # --branch only accepts tags and branches; fall back to a full clone for SHAs.
  echo "    (not a tag or branch, retrying as a commit SHA)"
  git clone --quiet "$repo" "$tmp"
  git -C "$tmp" checkout --quiet "$ref"
fi

resolved_sha="$(git -C "$tmp" rev-parse HEAD)"

src="$tmp/packages/evals/src"
[ -f "$src/pi-harness.ts" ] || { echo "no pi-harness.ts at $ref: upstream layout changed" >&2; exit 1; }

echo "==> Copying harness into tests/evals/vendor/pi-evals"
mkdir -p "$vendor_dir"
# No trailing slash on vitest-evals: it must stay a subdirectory, because
# pi-harness.ts imports ./vitest-evals/artifacts.ts.
rsync -a --delete "$src/pi-harness.ts" "$src/vitest-evals" "$vendor_dir/"
cp "$tmp/packages/evals/package.json" "$vendor_dir/upstream-package.json"

echo "==> Applying patches"
shopt -s nullglob
patches=("$patch_dir"/*.patch)
shopt -u nullglob
[ ${#patches[@]} -gt 0 ] || { echo "no patches found in $patch_dir" >&2; exit 1; }

for patch in "${patches[@]}"; do
  echo "    $(basename "$patch")"
  if ! git apply --directory=tests/evals/vendor/pi-evals "$patch" 2>/dev/null; then
    cat >&2 <<EOF

Patch failed to apply: $patch
Upstream moved. Re-derive it by hand against the newly vendored pi-harness.ts,
regenerate with 'diff -u', and commit the updated patch. Do not skip it:
tests/evals/harness.ts depends on the options it adds.
EOF
    exit 1
  fi
done

cat > "$repo_root/tests/evals/vendor/SYNC.json" <<EOF
{
  "ref": "$ref",
  "sha": "$resolved_sha",
  "syncedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "==> Synced $ref ($resolved_sha)"
echo "    Next: pnpm typecheck:evals (free), then reconcile deps per the skill."
