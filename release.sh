#!/usr/bin/env bash
# Cut a release: marks the commit and tags it. Pushing the tag triggers the
# GitHub Actions Release workflow, which builds the code-app package and
# exports the managed LeanToolKitData solution, attaching both to a GitHub
# Release.
#
# The version now lives in the tag alone. This used to stamp 24 PCF control
# manifests plus the controls solution version; that target was retired
# (docs/leanboard-pcf-retirement-plan.md).
#
#   ./release.sh 0.1.0
#   git push origin main --tags
set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: ./release.sh <major.minor.patch>   e.g. ./release.sh 0.1.0" >&2
  exit 1
fi

cd "$(dirname "$0")"

# with no files to stamp, the tag is the whole release — so guard it rather
# than fail late on a duplicate
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  echo "Tag v$VERSION already exists." >&2
  exit 1
fi

git commit --allow-empty -m "Release v$VERSION"
git tag "v$VERSION"

echo
echo "Tagged v$VERSION. Publish with:"
echo "  git push origin main --tags"
