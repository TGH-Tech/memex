#!/usr/bin/env bash
# scaffold-wiki.sh — create an engineering-memory wiki vault.
#
# Usage: scaffold-wiki.sh <project-name> [target-dir]
#   project-name : slug for the project, e.g. "e-commerce". Used in templates.
#   target-dir   : where the vault goes. Default: ./<project-name>-wiki
#
# Safe + idempotent: bails if <target>/CLAUDE.md already exists (won't clobber
# a real vault); otherwise fills in any missing dirs/files so an interrupted
# scaffold can be completed by re-running.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES="$SCRIPT_DIR/../templates"

# ── Args ──────────────────────────────────────────────────────────────────
PROJECT="${1:-}"
if [ -z "$PROJECT" ]; then
  echo "error: project name required" >&2
  echo "usage: scaffold-wiki.sh <project-name> [target-dir]" >&2
  exit 1
fi
if ! printf '%s' "$PROJECT" | grep -qE '^[A-Za-z0-9._-]+$'; then
  echo "error: project name must be [A-Za-z0-9._-]+ (got: '$PROJECT')" >&2
  exit 1
fi

TARGET="${2:-./$PROJECT-wiki}"
DATE="$(date +%F)"

if [ ! -d "$TEMPLATES" ]; then
  echo "error: templates dir not found at $TEMPLATES" >&2
  exit 1
fi

# ── Safety: don't clobber an existing vault ───────────────────────────────
if [ -e "$TARGET/CLAUDE.md" ]; then
  echo "error: $TARGET/CLAUDE.md already exists — refusing to overwrite an existing vault" >&2
  echo "       (delete it first, or pick a different target dir)" >&2
  exit 1
fi

# ── Directory tree ────────────────────────────────────────────────────────
RAW_DIRS=(features sessions slack linear notes transcripts)
WIKI_DIRS=(decisions bugs flows concepts)

mkdir -p "$TARGET/.obsidian"
for d in "${RAW_DIRS[@]}"; do mkdir -p "$TARGET/raw/$d"; done
for d in "${WIKI_DIRS[@]}"; do mkdir -p "$TARGET/wiki/$d"; done

# ── File writers ──────────────────────────────────────────────────────────
# write_subst <template-rel> <dest-rel> : copy with {{PROJECT}}/{{DATE}} substitution
# write_raw   <template-rel> <dest-rel> : copy verbatim
# Both skip if the dest already exists (idempotent re-runs).

created=()
skipped=()

write_subst() {
  local src="$TEMPLATES/$1" dest="$TARGET/$2"
  if [ -e "$dest" ]; then skipped+=("$2"); return; fi
  sed -e "s|{{PROJECT}}|$PROJECT|g" -e "s|{{DATE}}|$DATE|g" "$src" > "$dest"
  created+=("$2")
}

write_raw() {
  local src="$TEMPLATES/$1" dest="$TARGET/$2"
  if [ -e "$dest" ]; then skipped+=("$2"); return; fi
  cp "$src" "$dest"
  created+=("$2")
}

write_subst README.md     README.md
write_subst CLAUDE.md     CLAUDE.md
write_subst APPROACH.md   APPROACH.md
write_subst WORKFLOWS.md  WORKFLOWS.md
write_subst index.md      index.md
write_subst log.md        log.md
write_raw   wiki.schema.json wiki.schema.json
write_raw   gitignore     .gitignore
write_raw   obsidian/app.json          .obsidian/app.json
write_raw   obsidian/appearance.json   .obsidian/appearance.json
write_raw   obsidian/core-plugins.json .obsidian/core-plugins.json
write_raw   obsidian/graph.json        .obsidian/graph.json

# ── .gitkeep in every leaf dir so git tracks the empty structure ──────────
for d in "${RAW_DIRS[@]}"; do
  [ -e "$TARGET/raw/$d/.gitkeep" ] || : > "$TARGET/raw/$d/.gitkeep"
done
for d in "${WIKI_DIRS[@]}"; do
  [ -e "$TARGET/wiki/$d/.gitkeep" ] || : > "$TARGET/wiki/$d/.gitkeep"
done

# ── git init (the vault is meant to be its own repo) ──────────────────────
git_status="skipped (already a git repo)"
if [ ! -d "$TARGET/.git" ]; then
  if command -v git >/dev/null 2>&1; then
    git -C "$TARGET" init -q
    git_status="initialized"
  else
    git_status="skipped (git not found)"
  fi
fi

# ── Report ────────────────────────────────────────────────────────────────
ABS_TARGET="$(cd "$TARGET" && pwd)"
echo "Wiki vault scaffolded: $ABS_TARGET"
echo "  project name : $PROJECT"
echo "  files created: ${#created[@]}"
if [ "${#skipped[@]}" -gt 0 ]; then
  echo "  files skipped: ${#skipped[@]} (already existed: ${skipped[*]})"
fi
echo "  git          : $git_status"
echo
echo "Tree:"
echo "  $PROJECT-wiki/"
echo "  ├── README.md  CLAUDE.md  APPROACH.md  WORKFLOWS.md  index.md  log.md"
echo "  ├── wiki.schema.json  .gitignore  .obsidian/"
echo "  ├── raw/   ${RAW_DIRS[*]}"
echo "  └── wiki/  ${WIKI_DIRS[*]}"
