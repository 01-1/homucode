#!/usr/bin/env bash
# Builds a signed HomuCode Android APK on a fresh boat.dev box, brings it back, and deletes the box.
# Usage: scripts/homu-android/build.sh [REF]   (default origin/main; run from pbox)
# Env: VARIANT (development), APP_NAME (HomuCode), OUT (~/app/mobile),
#      SIGNING_DIR (~/credentials/android-signing), WORK (~/hold/homu-android)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); repo=$(git -C "$here" rev-parse --show-toplevel)
VARIANT=${VARIANT:-development}; APP_NAME=${APP_NAME:-HomuCode}
OUT=${OUT:-$HOME/app/mobile}; SIGNING_DIR=${SIGNING_DIR:-$HOME/credentials/android-signing}
ref=${1:-origin/main}
[[ $ref == origin/* ]] && git -C "$repo" fetch -q origin "${ref#origin/}"
rev=$(git -C "$repo" rev-parse --verify "$ref^{commit}")
work=${WORK:-$HOME/hold/homu-android}/${rev:0:10}-$VARIANT; mkdir -p "$work"; cd "$work"
git -C "$repo" archive --format=tar.gz -o "$work/source.tar.gz" "$rev"
B="boat --no-update"; R=/home/user/t3-preview
$B new --personal --type xlarge --no-env --no-snapshots --ttl 10800 --name "homucode-android-${rev:0:10}" > box-create.json
box=$(grep -o '"id":"bx_[a-z0-9]*"' box-create.json | head -1 | cut -d'"' -f4); echo "$box" > box-id
echo "box $box, commit $rev, variant $VARIANT, logs in $work"
trap '$B delete "$box" --yes > box-deletion.json 2>&1 || echo "box $box NOT deleted"' EXIT
$B ssh "$box" -- "mkdir -p $R/signing && chmod 700 $R/signing"
$B scp source.tar.gz "$box:$R/source-$rev.tar.gz"
for f in box-setup.sh box-build.sh public.env; do $B scp "$here/$f" "$box:$R/$f"; done
for f in t3-preview.p12 store-password; do $B scp "$SIGNING_DIR/$f" "$box:$R/signing/$f"; done
$B ssh "$box" -- "chmod 600 $R/signing/* && bash $R/box-setup.sh" > setup.log 2>&1
$B ssh "$box" -- "bash $R/box-build.sh $rev $VARIANT '$APP_NAME'" > build.log 2>&1
name="$APP_NAME-$VARIANT-${rev:0:10}.apk"
for f in app.apk app.apk.sha256 app.apk.badging.txt app.apk.signing.txt config.json; do $B scp "$box:$R/artifacts/$f" "$f"; done
[ "$(cut -d' ' -f1 app.apk.sha256)" = "$(sha256sum app.apk | cut -d' ' -f1)" ]
mkdir -p "$OUT"; cp app.apk "$OUT/$name"
echo "DONE $OUT/$name"
