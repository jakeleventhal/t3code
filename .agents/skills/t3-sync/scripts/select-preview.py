#!/usr/bin/env python3
"""Resolve the latest published V2 preview without changing Git or installations."""

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


REPO = "pingdotgg/t3code"
TAG = re.compile(r"v\d+\.\d+\.\d+-preview\.\d{8}\.\d+\Z")


def api(endpoint, *flags):
    result = subprocess.run(
        ["gh", "api", endpoint, *flags], check=True, capture_output=True, text=True
    )
    return json.loads(result.stdout)


def select_release(releases):
    candidates = [
        release for release in releases
        if not release.get("draft")
        and release.get("published_at")
        and TAG.fullmatch(release.get("tag_name", ""))
    ]
    if not candidates:
        raise ValueError("No published preview release found; refusing a nightly/stable fallback.")
    return max(candidates, key=lambda release: (release["published_at"], release["id"]))


def snapshot(release, commit, desktop_arch):
    sha = commit["sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Release tag did not resolve to a full commit SHA.")
    advertised = re.search(r"Built from `([0-9a-f]{40})`", release.get("body") or "")
    if advertised and advertised.group(1) != sha:
        raise ValueError("Release body and tag disagree about the source commit.")
    version = release["tag_name"][1:]
    assets = {asset["name"] for asset in release.get("assets", [])}
    required = {"SHA256SUMS", f"T3-Code-{version}-{desktop_arch}.dmg"}
    missing = required - assets
    if missing:
        raise ValueError(f"Newest preview is incomplete: {sorted(missing)}. Do not use an older release silently.")
    return {
        "selected_at": datetime.now(timezone.utc).isoformat(),
        "repository": REPO,
        "release_id": release["id"],
        "tag": release["tag_name"],
        "version": version,
        "base_sha": sha,
        "published_at": release["published_at"],
        "url": release["html_url"],
        "assets": sorted(assets),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--desktop-arch", choices=["arm64", "x64"], default="arm64")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Snapshot already exists. Resume it, or use a new run directory.")
    pages = api(f"repos/{REPO}/releases?per_page=100", "--paginate", "--slurp")
    release = select_release([release for page in pages for release in page])
    commit = api(f"repos/{REPO}/commits/{release['tag_name']}")
    result = snapshot(release, commit, args.desktop_arch)
    # A preview label alone does not establish that this is the V2 release train.
    api(f"repos/{REPO}/contents/apps/server/src/persistence/initializeV2Database.ts?ref={result['base_sha']}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
