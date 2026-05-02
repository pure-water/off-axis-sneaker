#!/usr/bin/env bash
set -euo pipefail

APK_NAME="${1:-off-axis-viewer-debug-$(date +%Y%m%d-%H%M%S).apk}"

echo "[1/4] Building web assets..."
npm run build

echo "[2/4] Copying web assets into Capacitor Android project..."
npx cap copy android

echo "[3/4] Building Android debug APK..."
(
  cd android
  ./gradlew assembleDebug
)

echo "[4/4] Copying APK with a non-overwriting filename..."
mkdir -p apk-builds
cp android/app/build/outputs/apk/debug/app-debug.apk "apk-builds/${APK_NAME}"

echo "Done."
echo "APK: apk-builds/${APK_NAME}"

