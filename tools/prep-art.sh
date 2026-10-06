#!/bin/bash
# Turns the supplied reference pack (Spinblade_Arena_CORRECTED_HIGH_RES_PACK) into the web-sized art the UI uses.
#   tools/prep-art.sh /path/to/Spinblade_Arena_CORRECTED_HIGH_RES_PACK
# Needs ImageMagick (`convert`). Outputs JPEGs into src/assets/art/. The renders keep their cream paper
# background on purpose: the UI multiplies them onto cream cards, so no cut-out edge is needed.
set -euo pipefail
SRC="${1:?path to the reference pack}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/src/assets/art"
CREAM='#F3F0EA'
mkdir -p "$OUT/blades" "$OUT/arenas"

# --- blades: paint out the baked-in logo / name / class text, crop to the blade, shrink
convert "$SRC/BLADES/01_RAVOK.png" -fill "$CREAM" -draw "rectangle 30,25 410,155" -draw "rectangle 870,35 1254,150" -draw "rectangle 1010,150 1254,255" \
  -crop 1170x1100+40+85 +repage -resize 760x -quality 86 "$OUT/blades/ravok.jpg"
convert "$SRC/BLADES/02_BLAZEFANG.png" -fill "$CREAM" -draw "rectangle 25,20 360,112" -draw "rectangle 25,125 565,258" -draw "rectangle 960,85 1254,212" \
  -crop 1170x930+70+195 +repage -resize 760x -quality 86 "$OUT/blades/blazefang.jpg"
convert "$SRC/BLADES/03_RIFTCLAW.png" -crop 690x470+118+292 +repage -resize 760x -quality 86 "$OUT/blades/riftclaw.jpg"
convert "$SRC/BLADES/09_IRON_WARDEN.png" -crop 540x440+192+296 +repage -resize 560x -quality 86 "$OUT/blades/iron-warden.jpg"

# --- arenas: crop the letter-boxed art out of the 1200x1200 canvases
for f in 01_CORE_ARENA:core-pit 02_ELEVATION:elevation-ring 03_MAGNETIC_RING:magnetic-core 05_SHIFT_ARENA:shift-floor 06_WIND_TUNNEL:wind-tunnel 07_LAVA_CORE:lava-ring 08_GRAVITY_WELL:gravity-well; do
  convert "$SRC/ARENAS/${f%%:*}_1200x1200.png" -crop 1090x748+55+230 +repage -resize 720x -quality 84 "$OUT/arenas/${f##*:}.jpg"
done
convert "$SRC/ARENAS/04_CRYSTAL_FIELD_1200x1200.png" -crop 1090x748+55+230 +repage -resize 720x -quality 84 "$OUT/arenas/crystal-arena.jpg"
ls -la "$OUT/blades" "$OUT/arenas"
