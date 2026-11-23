#!/usr/bin/env bash
set -euo pipefail

# Generate all Bindery web PWA, Android launcher/splash, Capacitor source, and Play Store
# icons deterministically from assets/brand/logo-icon.svg using rsvg-convert and magick.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SRC_SVG="assets/brand/logo-icon.svg"
if [[ ! -f "$SRC_SVG" ]]; then
  echo "ERROR: Missing source SVG at $SRC_SVG" >&2
  exit 1
fi

CREAM_BG="#F3ECE1"
LIGHT_BG="#fff8f5"
DARK_BG="#161412"

# Deterministic PNG encoding flags (strip all metadata & timestamp chunks)
PNG_RGB_FLAGS=(-alpha off -type TrueColor -define png:color-type=2 -strip -define png:exclude-chunk=date,time,tIME)
PNG_RGBA_FLAGS=(-define png:color-type=6 -strip -define png:exclude-chunk=date,time,tIME)

# In logo-icon.svg (viewBox 1080x1080), the visible artwork bounding box height is 996/1080.
# Compute the rsvg-convert square side so the trimmed artwork height matches the target pixel height.
svg_side_for_logo_height() {
  local target_h="$1"
  awk -v h="$target_h" 'BEGIN {
    s = int((h * 1080.0 / 996.0) + 0.5)
    if (s < 1) s = 1
    print s
  }'
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Render trimmed transparent logo at a given pixel height into $TMP_DIR/logo-<h>.png (cached)
render_logo_trimmed() {
  local target_h="$1"
  local out="$TMP_DIR/logo-${target_h}.png"
  if [[ ! -f "$out" ]]; then
    local svg_side
    svg_side="$(svg_side_for_logo_height "$target_h")"
    rsvg-convert -w "$svg_side" -h "$svg_side" "$SRC_SVG" \
      | magick png:- -trim +repage -resize "x${target_h}" "PNG32:${out}"
  fi
  printf '%s' "$out"
}

# Render transparent square canvas with centred logo at pct% of side
make_transparent_square() {
  local out="$1"
  local size="$2"
  local pct="$3"
  local logo_h
  logo_h="$(awk -v s="$size" -v p="$pct" 'BEGIN { h = int((s * p / 100.0) + 0.5); if (h < 1) h = 1; print h }')"
  local logo
  logo="$(render_logo_trimmed "$logo_h")"
  mkdir -p "$(dirname "$out")"
  magick -size "${size}x${size}" xc:none \
    "$logo" -gravity center -composite \
    "${PNG_RGBA_FLAGS[@]}" "$out"
}

# Render opaque RGB square canvas with solid colour and centred logo at pct% of side
make_opaque_square() {
  local out="$1"
  local size="$2"
  local bg="$3"
  local pct="$4"
  local logo_h
  logo_h="$(awk -v s="$size" -v p="$pct" 'BEGIN { h = int((s * p / 100.0) + 0.5); if (h < 1) h = 1; print h }')"
  local logo
  logo="$(render_logo_trimmed "$logo_h")"
  mkdir -p "$(dirname "$out")"
  magick -size "${size}x${size}" "xc:${bg}" \
    "$logo" -gravity center -composite \
    "${PNG_RGB_FLAGS[@]}" "$out"
}

# Render solid opaque RGB square (no logo)
make_solid_square() {
  local out="$1"
  local size="$2"
  local bg="$3"
  mkdir -p "$(dirname "$out")"
  magick -size "${size}x${size}" "xc:${bg}" \
    "${PNG_RGB_FLAGS[@]}" "$out"
}

# Render legacy Android rounded-square icon (corner radius 18% of side, transparent outside)
make_rounded_square_icon() {
  local out="$1"
  local size="$2"
  local bg="$3"
  local pct="$4"
  local logo_h radius max_coord
  logo_h="$(awk -v s="$size" -v p="$pct" 'BEGIN { h = int((s * p / 100.0) + 0.5); if (h < 1) h = 1; print h }')"
  radius="$(awk -v s="$size" 'BEGIN { printf "%.2f", s * 0.18 }')"
  max_coord="$(awk -v s="$size" 'BEGIN { printf "%.2f", s - 1 }')"
  local logo
  logo="$(render_logo_trimmed "$logo_h")"
  mkdir -p "$(dirname "$out")"
  magick -size "${size}x${size}" xc:none \
    -fill "$bg" -draw "roundrectangle 0,0 ${max_coord},${max_coord} ${radius},${radius}" \
    "$logo" -gravity center -composite \
    "${PNG_RGBA_FLAGS[@]}" "$out"
}

# Render legacy Android round (circle) icon (transparent outside)
make_round_icon() {
  local out="$1"
  local size="$2"
  local bg="$3"
  local pct="$4"
  local logo_h center max_coord
  logo_h="$(awk -v s="$size" -v p="$pct" 'BEGIN { h = int((s * p / 100.0) + 0.5); if (h < 1) h = 1; print h }')"
  center="$(awk -v s="$size" 'BEGIN { printf "%.2f", (s - 1) / 2.0 }')"
  max_coord="$(awk -v s="$size" 'BEGIN { printf "%.2f", s - 1 }')"
  local logo
  logo="$(render_logo_trimmed "$logo_h")"
  mkdir -p "$(dirname "$out")"
  magick -size "${size}x${size}" xc:none \
    -fill "$bg" -draw "circle ${center},${center} ${max_coord},${center}" \
    "$logo" -gravity center -composite \
    "${PNG_RGBA_FLAGS[@]}" "$out"
}

# Render opaque splash screen of exact WxH with logo height = 28% of shorter side
make_splash() {
  local out="$1"
  local width="$2"
  local height="$3"
  local bg="$4"
  local short_side logo_h
  if (( width < height )); then
    short_side="$width"
  else
    short_side="$height"
  fi
  logo_h="$(awk -v s="$short_side" 'BEGIN { h = int((s * 0.28) + 0.5); if (h < 1) h = 1; print h }')"
  local logo
  logo="$(render_logo_trimmed "$logo_h")"
  mkdir -p "$(dirname "$out")"
  magick -size "${width}x${height}" "xc:${bg}" \
    "$logo" -gravity center -composite \
    "${PNG_RGB_FLAGS[@]}" "$out"
}

# 1. Web favicon.svg (derived directly from logo-icon.svg, which has transparent background + <title>Bindery</title>)
cp "$SRC_SVG" public/favicon.svg

# 2. Web PWA icons
make_transparent_square "public/pwa-192.png" 192 90
make_transparent_square "public/pwa-512.png" 512 90
make_opaque_square "public/pwa-maskable-192.png" 192 "$CREAM_BG" 60
make_opaque_square "public/pwa-maskable-512.png" 512 "$CREAM_BG" 60
make_opaque_square "public/apple-touch-icon.png" 180 "$CREAM_BG" 76

# 3. Android mipmap launcher icons
MIPMAP_SPECS=(
  "ldpi:36"
  "mdpi:48"
  "hdpi:72"
  "xhdpi:96"
  "xxhdpi:144"
  "xxxhdpi:192"
)

for spec in "${MIPMAP_SPECS[@]}"; do
  density="${spec%%:*}"
  size="${spec##*:}"
  dir="android/app/src/main/res/mipmap-${density}"
  make_transparent_square "${dir}/ic_launcher_foreground.png" "$size" 58
  make_solid_square "${dir}/ic_launcher_background.png" "$size" "$CREAM_BG"
  make_rounded_square_icon "${dir}/ic_launcher.png" "$size" "$CREAM_BG" 70
  make_round_icon "${dir}/ic_launcher_round.png" "$size" "$CREAM_BG" 62
done

# 4. Android splash screens (26 tracked files, exact dimensions preserved)
SPLASH_SPECS=(
  "android/app/src/main/res/drawable/splash.png:320:480:light"
  "android/app/src/main/res/drawable-night/splash.png:320:240:dark"
  "android/app/src/main/res/drawable-land-ldpi/splash.png:320:240:light"
  "android/app/src/main/res/drawable-land-mdpi/splash.png:480:320:light"
  "android/app/src/main/res/drawable-land-hdpi/splash.png:800:480:light"
  "android/app/src/main/res/drawable-land-xhdpi/splash.png:1280:720:light"
  "android/app/src/main/res/drawable-land-xxhdpi/splash.png:1600:960:light"
  "android/app/src/main/res/drawable-land-xxxhdpi/splash.png:1920:1280:light"
  "android/app/src/main/res/drawable-land-night-ldpi/splash.png:320:240:dark"
  "android/app/src/main/res/drawable-land-night-mdpi/splash.png:480:320:dark"
  "android/app/src/main/res/drawable-land-night-hdpi/splash.png:800:480:dark"
  "android/app/src/main/res/drawable-land-night-xhdpi/splash.png:1280:720:dark"
  "android/app/src/main/res/drawable-land-night-xxhdpi/splash.png:1600:960:dark"
  "android/app/src/main/res/drawable-land-night-xxxhdpi/splash.png:1920:1280:dark"
  "android/app/src/main/res/drawable-port-ldpi/splash.png:240:320:light"
  "android/app/src/main/res/drawable-port-mdpi/splash.png:320:480:light"
  "android/app/src/main/res/drawable-port-hdpi/splash.png:480:800:light"
  "android/app/src/main/res/drawable-port-xhdpi/splash.png:720:1280:light"
  "android/app/src/main/res/drawable-port-xxhdpi/splash.png:960:1600:light"
  "android/app/src/main/res/drawable-port-xxxhdpi/splash.png:1280:1920:light"
  "android/app/src/main/res/drawable-port-night-ldpi/splash.png:240:320:dark"
  "android/app/src/main/res/drawable-port-night-mdpi/splash.png:320:480:dark"
  "android/app/src/main/res/drawable-port-night-hdpi/splash.png:480:800:dark"
  "android/app/src/main/res/drawable-port-night-xhdpi/splash.png:720:1280:dark"
  "android/app/src/main/res/drawable-port-night-xxhdpi/splash.png:960:1600:dark"
  "android/app/src/main/res/drawable-port-night-xxxhdpi/splash.png:1280:1920:dark"
)

for spec in "${SPLASH_SPECS[@]}"; do
  IFS=':' read -r path w h mode <<< "$spec"
  if [[ "$mode" == "dark" ]]; then
    make_splash "$path" "$w" "$h" "$DARK_BG"
  else
    make_splash "$path" "$w" "$h" "$LIGHT_BG"
  fi
done

# 5. Capacitor asset sources
make_opaque_square "assets/icon-only.png" 1024 "$CREAM_BG" 70
make_transparent_square "assets/icon-foreground.png" 1024 58
make_solid_square "assets/icon-background.png" 1024 "$CREAM_BG"
make_splash "assets/splash.png" 2732 2732 "$LIGHT_BG"
make_splash "assets/splash-dark.png" 2732 2732 "$DARK_BG"

# 6. Google Play Console listing icon
make_opaque_square "assets/brand/play-store-icon-512.png" 512 "$CREAM_BG" 72

echo "Generated all Bindery brand icons and splash screens from $SRC_SVG."
