#!/usr/bin/env bash

# ServiceNow Admin Helper - Build Script
# Creates a .zip file ready for Firefox submission or distribution

set -e

echo "🔨 Building ServiceNow Admin Helper..."

# Clean old builds
rm -f servicenow-admin-helper.zip

# Create the zip file (exclude git, build files, etc.)
zip -r servicenow-admin-helper.zip \
  manifest.json \
  background.js \
  popup.html \
  popup.js \
  prompt.html \
  prompt.js \
  icon.png \
  -x "*.git*" "*.DS_Store" "build.sh" "README.md"

echo "✅ Built: servicenow-admin-helper.zip"
echo ""
echo "Next steps:"
echo "  • For testing: Load in about:debugging"
echo "  • For distribution: Share the .zip file with team"
echo "  • For signing: Submit to addons.mozilla.org"