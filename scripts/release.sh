#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

if [ -z "$1" ]; then
  echo "Error: Missing version argument."
  echo "Usage: bun run release <new-version | patch | minor | major>"
  echo "Example: bun run release patch"
  exit 1
fi

# Ensure working directory is clean
if [[ $(git status --porcelain) ]]; then
  echo "Error: Working directory is not clean. Commit or stash changes first."
  exit 1
fi

echo "🚀 Bumping version..."
# npm version updates package.json, commits it, and creates a Git tag
npm version $1

# Extract the new version from package.json
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
TARBALL="tnz3270-node-$VERSION.tgz"

echo "📦 Pushing commit and tag to GitHub..."
git push origin main
git push origin $TAG

echo "🏗  Building and packing artifact..."
# This runs the prepublishOnly script (which runs the build) and creates the .tgz
npm pack

echo "🐙 Creating GitHub Release $TAG..."
# Create the release. --generate-notes automatically generates release notes from PRs/commits
gh release create $TAG $TARBALL -t "$TAG Release" --generate-notes

echo "🧹 Cleaning up..."
rm $TARBALL

echo ""
echo "✅ Successfully created GitHub release $TAG!"
echo "⚠️  Don't forget to publish to NPM by running:"
echo "    npm publish"
