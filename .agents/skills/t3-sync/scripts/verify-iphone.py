#!/usr/bin/env python3
"""Verify Jake's signed, self-contained device app without dumping profiles."""

import argparse
import datetime
import hashlib
import json
import plistlib
import subprocess
import sys
from pathlib import Path


def run(*command):
    result = subprocess.run(command, capture_output=True, check=False)
    if result.returncode:
        raise ValueError(f"{command[0]} failed for {command[-1]}")
    return result.stdout


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_bundle(bundle, bundle_id, team_id, device_id, app_group):
    with (bundle / "Info.plist").open("rb") as source:
        info = plistlib.load(source)
    require(info["CFBundleIdentifier"] == bundle_id, f"Wrong bundle identity: {bundle}")
    architectures = run("/usr/bin/lipo", "-archs", str(bundle / info["CFBundleExecutable"]))
    require(b"arm64" in architectures.split(), f"Missing arm64 executable: {bundle}")
    signed = plistlib.loads(run("/usr/bin/codesign", "-d", "--entitlements", ":-", str(bundle)))
    profile = plistlib.loads(run("/usr/bin/security", "cms", "-D", "-i", str(bundle / "embedded.mobileprovision")))
    granted = profile["Entitlements"]
    require(team_id in profile["TeamIdentifier"], f"Wrong profile team: {bundle_id}")
    require(device_id.upper() in {value.upper() for value in profile.get("ProvisionedDevices", [])},
            f"Physical iPhone missing from profile: {bundle_id}")
    expiry = profile["ExpirationDate"].replace(tzinfo=datetime.timezone.utc)
    require(expiry > datetime.datetime.now(datetime.timezone.utc), f"Expired profile: {bundle_id}")
    for label, entitlements in [("signature", signed), ("profile", granted)]:
        require(entitlements.get("application-identifier") == f"{team_id}.{bundle_id}",
                f"Wrong application identifier in {label}: {bundle_id}")
        require(entitlements.get("com.apple.developer.team-identifier") == team_id,
                f"Wrong signing team in {label}: {bundle_id}")
        require(entitlements.get("aps-environment") == "development",
                f"Expected development APNs in {label}: {bundle_id}")
        require(app_group in entitlements.get("com.apple.security.application-groups", []),
                f"Missing shared App Group in {label}: {bundle_id}")
    return {
        "bundle": bundle_id,
        "version": info["CFBundleShortVersionString"],
        "profile": profile["UUID"],
        "profileExpiresAt": expiry.isoformat(),
        "apns": signed["aps-environment"],
        "appGroups": signed["com.apple.security.application-groups"],
        "deviceIncluded": True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["app", "bundle-id", "team-id", "device-id", "source-sha", "nightly-version", "output"]:
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    app = Path(args.app).resolve()
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", str(app))
    javascript = app / "main.jsbundle"
    require(javascript.is_file() and javascript.stat().st_size > 0, "Missing embedded main.jsbundle")
    with (app / "Info.plist").open("rb") as source:
        require(plistlib.load(source).get("NSSupportsLiveActivities") is True,
                "Main app lacks Live Activity support")
    widget_id = args.bundle_id + ".widgets"
    widgets = []
    for extension in (app / "PlugIns").glob("*.appex"):
        with (extension / "Info.plist").open("rb") as source:
            if plistlib.load(source).get("CFBundleIdentifier") == widget_id:
                widgets.append(extension)
    require(len(widgets) == 1, "Expected one widget extension with Jake's bundle identity")
    app_group = "group." + args.bundle_id
    signing = [verify_bundle(bundle, identity, args.team_id, args.device_id, app_group)
               for bundle, identity in [(app, args.bundle_id), (widgets[0], widget_id)]]
    receipt = {
        "source": args.source_sha,
        "nightlyVersion": args.nightly_version,
        "app": str(app),
        "embeddedJavaScriptSha256": hashlib.sha256(javascript.read_bytes()).hexdigest(),
        "signing": signing,
    }
    Path(args.output).write_text(json.dumps(receipt, indent=2) + "\n")
    print("Verified signed arm64 app and widget, embedded JavaScript, and physical-device profiles.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, plistlib.InvalidFileException) as error:
        print(f"iPhone artifact verification failed: {error}", file=sys.stderr)
        sys.exit(1)
