#!/usr/bin/env bash
# Regenerates docs/api-endpoints.txt: all internal /api/v2/ paths the vendor
# SPA calls, extracted from the controller web jar shipped in lib/.
# Run from repo root: bash web/scripts/extract-endpoints.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
JAR="$REPO_ROOT/lib/omada-web-5.15.6.7-local.jar"
OUT="$REPO_ROOT/web/docs/api-endpoints.txt"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ -f "$JAR" ] || { echo "jar not found: $JAR" >&2; exit 1; }

unzip -qo "$JAR" -d "$TMP"
grep -rhoaE '/api/v2/[a-zA-Z0-9/${}._-]+' "$TMP/static" \
  | sed -E 's:\$\{[^}]*\}:{id}:g; s:/[0-9]{4,}:/{num}:g' \
  | sort -u > "$OUT"

echo "wrote $OUT ($(wc -l < "$OUT") endpoints)"
