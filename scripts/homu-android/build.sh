#!/usr/bin/env bash
# Builds a signed HomuCode Android APK on a fresh boat.dev box, brings it back, and deletes the box.
# MODE=ota instead publishes REF's JS as an over-the-air update to installed APKs (see ota.sh).
# Usage: scripts/homu-android/build.sh [REF]   (default origin/main; run from pbox)
# Env: MODE (apk), VARIANT (development), APP_NAME (HomuCode), OUT (~/app/mobile),
#      SIGNING_DIR (~/credentials/android-signing), EXPO_TOKEN_FILE (~/credentials/expo/token),
#      WORK (~/hold/homu-android)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); repo=$(git -C "$here" rev-parse --show-toplevel)
MODE=${MODE:-apk}; [[ $MODE == apk || $MODE == ota ]]; VARIANT=${VARIANT:-development}; APP_NAME=${APP_NAME:-HomuCode}
OUT=${OUT:-$HOME/app/mobile}; SIGNING_DIR=${SIGNING_DIR:-$HOME/credentials/android-signing}
EXPO_TOKEN_FILE=${EXPO_TOKEN_FILE:-$HOME/credentials/expo/token}
ref=${1:-origin/main}
[[ $ref == origin/* ]] && git -C "$repo" fetch -q origin "${ref#origin/}"
rev=$(git -C "$repo" rev-parse --verify "$ref^{commit}")
suffix=$VARIANT; [[ $MODE == apk ]] || suffix+=-$MODE
work=${WORK:-$HOME/hold/homu-android}/${rev:0:10}-$suffix; mkdir -p "$work"; cd "$work"
git -C "$repo" archive --format=tar.gz -o "$work/source.tar.gz" "$rev"
B=("${T3_BUILD_BOAT_CLI:-boat}" --no-update); R=/home/user/t3-preview
"${B[@]}" new --personal --type xlarge --no-env --no-snapshots --ttl 10800 --name "homucode-android-$MODE-${rev:0:10}" > box-create.json
box=$(grep -o '"id":"bx_[a-z0-9]*"' box-create.json | head -1 | cut -d'"' -f4); echo "$box" > box-id
echo "box $box, commit $rev, $MODE, variant $VARIANT, logs in $work"
trap '"${B[@]}" delete "$box" --yes > box-deletion.json 2>&1 || echo "box $box NOT deleted"' EXIT
"${B[@]}" ssh "$box" -- "mkdir -p $R/signing && chmod 700 $R/signing"
"${B[@]}" scp source.tar.gz "$box:$R/source-$rev.tar.gz"
for f in box-setup.sh box-build.sh public.env; do "${B[@]}" scp "$here/$f" "$box:$R/$f"; done
if [[ $MODE == ota ]]; then
  "${B[@]}" scp "$EXPO_TOKEN_FILE" "$box:$R/signing/expo-token"; setup_env=NODE_SETUP_ONLY=1
else
  for f in t3-preview.p12 store-password; do "${B[@]}" scp "$SIGNING_DIR/$f" "$box:$R/signing/$f"; done; setup_env=
fi
"${B[@]}" ssh "$box" -- "chmod 600 $R/signing/* && $setup_env bash $R/box-setup.sh" > setup.log 2>&1
"${B[@]}" ssh "$box" -- "bash $R/box-build.sh $rev $VARIANT '$APP_NAME' $MODE" > build.log 2>&1
if [[ $MODE == ota ]]; then
  for f in update.json runtime-version.json config.json; do "${B[@]}" scp "$box:$R/artifacts/$f" "$f"; done
  echo "PUBLISHED $rev for runtime $(cat runtime-version.json)"; exit 0
fi
name="$APP_NAME-$VARIANT-${rev:0:10}.apk"
for f in app.apk app.apk.sha256 app.apk.badging.txt app.apk.signing.txt config.json runtime-version.json; do "${B[@]}" scp "$box:$R/artifacts/$f" "$f"; done
[ "$(cut -d' ' -f1 app.apk.sha256)" = "$(sha256sum app.apk | cut -d' ' -f1)" ]
mkdir -p "$OUT"; cp app.apk "$OUT/$name"
echo "DONE $OUT/$name (runtime $(cat runtime-version.json))"
