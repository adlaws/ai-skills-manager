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

# ──────────────────────────────────────────────
#  Pre-requisite checks
# ──────────────────────────────────────────────
PREREQ_OK=true

# Detect package-manager hint for installation guidance
install_hint() {
    # Returns a platform-appropriate install suggestion for a given tool
    local tool="$1"
    if [[ "$(uname)" == "Darwin" ]]; then
        case "$tool" in
            node)  echo "  brew install node            (Homebrew)" ;;
            git)   echo "  brew install git             (Homebrew)" ;;
            java)  echo "  brew install temurin         (Homebrew — Adoptium JDK 17+)" ;;
        esac
    else
        # Linux — try to detect distro
        if command -v apt-get &>/dev/null; then
            case "$tool" in
                node)  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
                       echo "  sudo apt-get install -y nodejs" ;;
                git)   echo "  sudo apt-get install -y git" ;;
                java)  echo "  sudo apt-get install -y openjdk-17-jdk" ;;
            esac
        elif command -v dnf &>/dev/null; then
            case "$tool" in
                node)  echo "  sudo dnf install -y nodejs" ;;
                git)   echo "  sudo dnf install -y git" ;;
                java)  echo "  sudo dnf install -y java-17-openjdk-devel" ;;
            esac
        elif command -v pacman &>/dev/null; then
            case "$tool" in
                node)  echo "  sudo pacman -S nodejs npm" ;;
                git)   echo "  sudo pacman -S git" ;;
                java)  echo "  sudo pacman -S jdk17-openjdk" ;;
            esac
        else
            case "$tool" in
                node)  echo "  https://nodejs.org/ — download the v22.x LTS installer" ;;
                git)   echo "  https://git-scm.com/downloads" ;;
                java)  echo "  https://adoptium.net/ — download JDK 17+" ;;
            esac
        fi
    fi
}

check_command() {
    local cmd="$1"
    local label="$2"
    local tool_key="$3"   # node | git | java
    local ver_flag="${4:---version}"

    if command -v "$cmd" &>/dev/null; then
        local ver
        ver=$("$cmd" $ver_flag 2>&1 | head -1)
        echo "  ✔ $label found: $ver"
    else
        echo "  ✘ $label is NOT installed (or not on PATH)." >&2
        install_hint "$tool_key"
        PREREQ_OK=false
    fi
}

echo "========================================"
echo " Checking pre-requisites"
echo "========================================"

if $BUILD_VSCODE; then
    echo ""
    echo "VS Code extension requires: Node.js (npm), Git"
    check_command node  "Node.js" node  "--version"
    check_command npm   "npm"     node  "--version"
    check_command git   "Git"     git   "--version"
fi

if $BUILD_RIDER; then
    echo ""
    echo "Rider plugin requires: JDK 17+"
    check_command java  "Java"    java  "-version"
    check_command javac "javac"   java  "-version"

    # Verify Java version >= 17
    if command -v java &>/dev/null; then
        JAVA_VER=$(java -version 2>&1 | head -1 | sed -E 's/.*"([0-9]+).*/\1/')
        if [[ "$JAVA_VER" -lt 17 ]] 2>/dev/null; then
            echo "  ⚠ Java version $JAVA_VER detected — JDK 17 or later is required." >&2
            install_hint java
            PREREQ_OK=false
        fi
    fi

    # Check for Gradle wrapper or system Gradle (non-fatal — wrapper is preferred)
    if [[ ! -f "$SCRIPT_DIR/rider/gradlew" ]]; then
        if ! command -v gradle &>/dev/null; then
            echo "  ⚠ Gradle wrapper (rider/gradlew) not found and 'gradle' is not on PATH."
            echo "    The wrapper is included in the repository — try a fresh git checkout."
            echo "    Alternatively, install Gradle (https://gradle.org/install/) and run:"
            echo "      cd rider && gradle wrapper"
            PREREQ_OK=false
        else
            echo "  ✔ Gradle wrapper missing, but system Gradle found (will generate wrapper)"
        fi
    else
        echo "  ✔ Gradle wrapper found: rider/gradlew"
    fi
fi

echo ""

if ! $PREREQ_OK; then
    echo "========================================"
    echo " Pre-requisite check FAILED"
    echo " Install the missing tools listed above"
    echo " and then re-run this script."
    echo "========================================"
    exit 1
fi

echo "All pre-requisites satisfied."
echo ""

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
    echo ""
fi

# --- Rider / JetBrains Plugin ---
if $BUILD_RIDER; then
    echo "========================================"
    echo " Building Rider/JetBrains plugin (.zip)"
    echo "========================================"
    cd "$SCRIPT_DIR/rider"

    if [[ ! -f "./gradlew" ]]; then
        echo "Generating Gradle wrapper..."
        gradle wrapper
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
