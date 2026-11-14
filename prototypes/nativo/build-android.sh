#!/usr/bin/env bash
# Compila o protótipo nativo e gera o APK (docs/design/NATIVO.md). Precisa de: Rust com o alvo aarch64-linux-android,
# cargo-ndk, Android SDK e NDK (ANDROID_HOME, ANDROID_NDK_HOME) e Java 21. No dia a dia, o GitHub faz isso (prototype-apk.yml).
set -euo pipefail
cd "$(dirname "$0")"
cargo ndk -t arm64-v8a -P 26 -o android/app/src/main/jniLibs build --release
cd android
./gradlew assembleDebug --no-daemon "$@"
echo "APK: $(pwd)/app/build/outputs/apk/debug/app-debug.apk"
