#!/usr/bin/env bash
# Cut a release: bumps every control manifest + the solution version, commits,
# and tags. Pushing the tag triggers the GitHub Actions Release workflow, which
# builds the solution zips and attaches them to a GitHub Release.
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

# every control manifest: version="x.y.z" on the <control> element
for MANIFEST in controls/*/ControlManifest.Input.xml; do
  perl -pi -e "s/version=\"[0-9]+\\.[0-9]+\\.[0-9]+\"/version=\"$VERSION\"/ if /<control /../control-type=/" \
    "$MANIFEST"
done

# solution manifest: <Version>x.y.z.0</Version>
perl -pi -e "s/<Version>[0-9.]+<\\/Version>/<Version>$VERSION.0<\\/Version>/" \
  Solution/src/Other/Solution.xml

echo "Set control versions $VERSION, solution version $VERSION.0"

git add controls/*/ControlManifest.Input.xml Solution/src/Other/Solution.xml
git commit -m "Release v$VERSION"
git tag "v$VERSION"

echo
echo "Tagged v$VERSION. Publish with:"
echo "  git push origin main --tags"
