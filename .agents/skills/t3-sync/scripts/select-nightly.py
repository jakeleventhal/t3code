#!/usr/bin/env python3
"""Snapshot a main source SHA and its newest reachable published Nightly version."""

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


REPO = "pingdotgg/t3code"
TAG = re.compile(r"v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+\Z")


def git(*args):
    return subprocess.run(
        ["git", *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def select(releases, base_sha):
    candidates = sorted(
        (release for release in releases
         if not release.get("draft") and release.get("published_at")
         and TAG.fullmatch(release.get("tag_name", ""))),
        key=lambda release: (release["published_at"], release["id"]), reverse=True,
    )
    for release in candidates:
        # Fetch upstream tags before selection. Missing tags are an error rather
        # than permission to silently stamp an older version.
        release_sha = git("rev-parse", "--verify", f"refs/tags/{release['tag_name']}^{{commit}}")
        result = subprocess.run(
            ["git", "merge-base", "--is-ancestor", release_sha, base_sha],
            capture_output=True, text=True,
        )
        if result.returncode == 1:
            continue
        result.check_returncode()
        return {
            "selected_at": datetime.now(timezone.utc).isoformat(),
            "repository": REPO,
            "release_id": release["id"],
            "tag": release["tag_name"],
            "version": release["tag_name"][1:],
            "base_sha": base_sha,
            "release_sha": release_sha,
            "published_at": release["published_at"],
            "url": release["html_url"],
        }
    raise ValueError("No published Nightly reachable from frozen main; fetch upstream tags first.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Snapshot already exists. Resume it, or use a new run directory.")
    base_sha = git("rev-parse", "--verify", f"{args.base_sha}^{{commit}}")
    result = subprocess.run(
        ["gh", "api", f"repos/{REPO}/releases?per_page=100", "--paginate", "--slurp"],
        check=True, capture_output=True, text=True,
    )
    releases = [release for page in json.loads(result.stdout) for release in page]
    snapshot = select(releases, base_sha)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as output:
        json.dump(snapshot, output, indent=2)
        output.write("\n")
    print(json.dumps(snapshot, indent=2))


if __name__ == "__main__":
    main()
