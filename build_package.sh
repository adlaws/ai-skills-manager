#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_VSCODE=false
BUILD_RIDER=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --vscode) BUILD_VSCODE=true; shift ;;
        --rider)  BUILD_RIDER=true;  shift ;;
        -h|--help)
            echo "Usage: $0 [--vscode] [--rider]"
            echo ""
            echo "Package IDE extensions for distribution."
            echo ""
            echo "Options:"
            echo "  --vscode    Build the VS Code extension (.vsix)"
            echo "  --rider     Build the Rider/JetBrains plugin (.zip)"
            echo ""
            echo "If no options are specified, both packages are built."
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Run '$0 --help' for usage." >&2
            exit 1
            ;;
    esac
done

# Default: build both if neither flag was provided
if ! $BUILD_VSCODE && ! $BUILD_RIDER; then
    BUILD_VSCODE=true
    BUILD_RIDER=true
fi

FAILED=0

# --- Clean previous build artefacts from the root directory ---
if $BUILD_VSCODE; then
    echo "Cleaning previous VS Code packages from $SCRIPT_DIR ..."
    rm -f "$SCRIPT_DIR"/ai-skills-manager-*.vsix
fi
if $BUILD_RIDER; then
    echo "Cleaning previous Rider packages from $SCRIPT_DIR ..."
    rm -f "$SCRIPT_DIR"/ai-skills-manager-rider-*.zip
fi

# --- VS Code Extension ---
if $BUILD_VSCODE; then
    echo "========================================"
    echo " Building VS Code extension (.vsix)"
    echo "========================================"
    cd "$SCRIPT_DIR/vscode"

    if ! command -v npm &>/dev/null; then
        echo "ERROR: npm is not installed or not on PATH." >&2
        FAILED=1
    else
        npm install --silent
        npx @vscode/vsce package
        VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)
        if [[ -n "$VSIX_FILE" ]]; then
            cp "$VSIX_FILE" "$SCRIPT_DIR/"
            echo ""
            echo "✔ VS Code package: $VSIX_FILE (copied to project root)"
        else
            echo "ERROR: VSIX file was not produced." >&2
            FAILED=1
        fi
    fi
    echo ""
fi

# --- Rider / JetBrains Plugin ---
if $BUILD_RIDER; then
    echo "========================================"
    echo " Building Rider/JetBrains plugin (.zip)"
    echo "========================================"
    cd "$SCRIPT_DIR/rider"

    if [[ ! -f "./gradlew" ]]; then
        # Generate the Gradle wrapper if not present
        if command -v gradle &>/dev/null; then
            echo "Generating Gradle wrapper..."
            gradle wrapper
        else
            echo "ERROR: Gradle wrapper not found and 'gradle' is not on PATH." >&2
            echo "Run 'cd rider && gradle wrapper' to generate it, or install Gradle." >&2
            FAILED=1
        fi
    fi

    if [[ -f "./gradlew" ]]; then
        chmod +x ./gradlew
        ./gradlew buildPlugin
        ZIP_FILE=$(ls -t build/distributions/*.zip 2>/dev/null | head -1)
        if [[ -n "$ZIP_FILE" ]]; then
            cp "$ZIP_FILE" "$SCRIPT_DIR/"
            BASENAME=$(basename "$ZIP_FILE")
            echo ""
            echo "✔ Rider package: $BASENAME (copied to project root)"
        else
            echo "ERROR: Plugin zip was not produced." >&2
            FAILED=1
        fi
    fi
    echo ""
fi

# --- Summary ---
echo "========================================"
if [[ $FAILED -eq 0 ]]; then
    echo " All requested packages built successfully."
    echo " Artefacts available in: $SCRIPT_DIR/"
else
    echo " Some packages failed to build — see errors above."
fi
echo "========================================"

exit $FAILED
