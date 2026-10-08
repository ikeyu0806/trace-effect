#!/usr/bin/env bash
# blender-worksの検査済みGLBを取り込み、meshopt圧縮して public/models へ置く。
# 名前（Object名・Material名）はゲーム側から参照するため、join/flatten系の最適化は使わない。
set -euo pipefail

BLENDER_WORKS="${BLENDER_WORKS:-$(cd "$(dirname "$0")/../../blender-works" && pwd)}"
DESTINATION="$(cd "$(dirname "$0")/.." && pwd)/public/models"
ASSETS=(trace_fighter_mk2 space_debris_set asteroid_set trace_pickups)

mkdir -p "$DESTINATION"
for asset in "${ASSETS[@]}"; do
  source_path="$BLENDER_WORKS/output/$asset/exports/$asset.glb"
  if [[ ! -f "$source_path" ]]; then
    echo "missing $source_path (run the Blender build first)" >&2
    exit 1
  fi
  npx gltf-transform meshopt "$source_path" "$DESTINATION/$asset.glb" --level medium
done
ls -la "$DESTINATION"
