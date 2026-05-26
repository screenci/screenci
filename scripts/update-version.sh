#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
CREATE_PACKAGE_DIR="$PACKAGE_DIR/create-screenci"

cd "$PACKAGE_DIR"

# Update the main package version.
npm version "$VERSION" --no-git-tag-version

# Keep the wrapper package version and dependency aligned.
npm version "$VERSION" --no-git-tag-version --prefix "$CREATE_PACKAGE_DIR"
npm pkg set dependencies.screenci="$VERSION" --prefix "$CREATE_PACKAGE_DIR"

# Stage the updated manifests.
git add package.json package-lock.json create-screenci/package.json

# Commit
git commit -m "Release $VERSION"

# Tag
git tag "v$VERSION"

# Push commit and tag
git push
git push origin "v$VERSION"
