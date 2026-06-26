#!/usr/bin/env bash
# Publishes the NexusMDWeb.Api as a self-contained binary for the target RID.
# Usage: TARGET_RID=win-x64 bash scripts/build-api.sh

set -e

TARGET_RID="${TARGET_RID:-win-x64}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_PROJECT="$SCRIPT_DIR/../../NexusMD-Web/NexusMD-Web/NexusMDWeb.Api.csproj"
OUTPUT_DIR="$SCRIPT_DIR/../api/$TARGET_RID"

dotnet publish "$API_PROJECT" \
  -c Release \
  -r "$TARGET_RID" \
  --self-contained true \
  -o "$OUTPUT_DIR"

echo "Published to: $OUTPUT_DIR"
