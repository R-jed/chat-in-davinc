#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
SOURCE="$ROOT/resources/app-icon-source.png"
ICONSET="$ROOT/resources/app-icon.iconset"
OUTPUT="$ROOT/resources/app-icon.icns"
MASTER="$ROOT/resources/app-icon-1024.png"

test -f "$SOURCE"
sips -z 1024 1024 "$SOURCE" --out "$MASTER" >/dev/null
PNG="$MASTER"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$OUTPUT"
echo "Built $MASTER"
echo "Built $ICONSET"
echo "Built $OUTPUT"
