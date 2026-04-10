#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PACKAGE_DIR"

# Update version in package.json
npm version "$VERSION" --no-git-tag-version

# Stage package.json and package-lock.json
git add package.json package-lock.json

# Commit
git commit -m "Release $VERSION"

# Tag
git tag "v$VERSION"

# Push commit and tag
git push
git push origin "v$VERSION"
