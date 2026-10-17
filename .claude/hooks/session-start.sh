#!/bin/bash
# Cloud sessions only: install REA (Reverse Engineer Anything) MCP server + skill,
# with Ghidra and JADX as native analysis engines. Idempotent.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

GHIDRA_DIR=/opt/ghidra_12.1.4_PUBLIC
GHIDRA_URL=https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip
GHIDRA_SHA256=ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db

JADX_JAR=/opt/rea-android/jadx-headless-mcp-0.7.1-all.jar
JADX_URL=https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar
JADX_SHA256=6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75

REA_PACKAGE=rea-agents@6.5.0

# Ghidra needs a full JDK 21+.
if ! command -v javac >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq openjdk-21-jdk-headless unzip
fi

# Ghidra 12.1.4 (the version REA 6.5.0 supports)
if [ ! -x "$GHIDRA_DIR/support/analyzeHeadless" ]; then
  tmp=$(mktemp -d)
  curl -fsSL --retry 3 -o "$tmp/ghidra.zip" "$GHIDRA_URL"
  echo "$GHIDRA_SHA256  $tmp/ghidra.zip" | sha256sum -c - >&2
  unzip -q "$tmp/ghidra.zip" -d /opt
  rm -rf "$tmp"
fi

# jadx-headless-mcp (Android APK decompilation)
if [ ! -f "$JADX_JAR" ]; then
  mkdir -p "$(dirname "$JADX_JAR")"
  curl -fsSL --retry 3 -o "$JADX_JAR.part" "$JADX_URL"
  echo "$JADX_SHA256  $JADX_JAR.part" | sha256sum -c - >&2
  mv "$JADX_JAR.part" "$JADX_JAR"
fi

export GHIDRA_INSTALL_DIR="$GHIDRA_DIR" REA_JADX_MCP_JAR="$JADX_JAR"

# Same paths for `npx rea-agents ...` CLI use during the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export GHIDRA_INSTALL_DIR=$GHIDRA_DIR"
    echo "export REA_JADX_MCP_JAR=$JADX_JAR"
  } >> "$CLAUDE_ENV_FILE"
fi

# Register the REA MCP server (with the engine paths) and install its skill.
mkdir -p "$HOME/.claude"
npx -y "$REA_PACKAGE" setup --client claude_code --yes --json >/dev/null 2>&1
npx -y "$REA_PACKAGE" doctor --client claude_code --json >/dev/null 2>&1
