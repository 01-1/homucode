#!/usr/bin/env bash
# Publishes REF's JS (default origin/main) as an over-the-air update to installed HomuCode APKs.
# Only APKs whose native fingerprint matches REF's pick it up; native changes still need build.sh.
MODE=ota exec "$(dirname "$0")/build.sh" "$@"
