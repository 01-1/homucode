"""Verify the Expo project, channel and runtime embedded in a signed APK."""

import json
import re
import subprocess
import sys
from pathlib import Path

aapt, apk, env_path, runtime = sys.argv[1:]
env = dict(line.split("=", 1) for line in Path(env_path).read_text().splitlines() if "=" in line)
manifest = subprocess.check_output([aapt, "dump", "xmltree", apk, "--file", "AndroidManifest.xml"], text=True)
metadata = dict(re.findall(
    r'android:name\([^)]*\)="expo\.modules\.updates\.([^"]+)"[^\n]*\n'
    r'\s+A: [^\n]*android:value\([^)]*\)=([^\n]+)', manifest
))


def value(key):
    return metadata.get(key, "").split(" (Raw: ", 1)[0].removeprefix('"').removesuffix('"')


def verify(condition, field):
    if not condition:
        sys.exit(f"Signed APK has incorrect Expo Updates {field}.")


verify(value("ENABLED") == "true", "enablement")
verify(value("EXPO_UPDATE_URL") == f"https://u.expo.dev/{env['T3CODE_EAS_PROJECT_ID']}", "project URL")
headers = json.loads(value("UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY") or "{}")
verify(headers.get("expo-channel-name") == env["T3CODE_MOBILE_UPDATES_CHANNEL"], "channel")
runtime_reference = value("EXPO_RUNTIME_VERSION")
if runtime_reference.startswith("@"):
    resources = subprocess.check_output([aapt, "dump", "resources", apk], text=True)
    match = re.search(rf'^\s*resource {re.escape(runtime_reference[1:])} [^\n]+\n\s*\(\) "([^"]+)"', resources, re.M)
    runtime_reference = match.group(1) if match else ""
verify(runtime_reference == runtime, "runtime")
print(f"Verified signed APK OTA channel {headers['expo-channel-name']}, runtime {runtime}.")
