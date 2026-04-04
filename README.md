# AI Skills Manager

A **monorepo** containing IDE extensions for discovering, installing, and managing AI development resources — **Chat Modes**, **Instructions**, **Prompts**, **Agents**, and **Skills** — from GitHub repositories with customizable install locations.

One extension for VS Code, one plugin for JetBrains IDEs (Rider, IntelliJ IDEA, WebStorm, etc.), sharing the same feature set.

## Repository Structure

```
ai-skills-manager/
├── vscode/          ← VS Code extension (TypeScript, esbuild)
├── rider/           ← JetBrains / Rider plugin (Kotlin, Gradle)
├── shared/          ← Shared assets (icons, logos)
├── .github/         ← GitHub config & AI assistant instructions
├── LICENSE
├── README.md        ← You are here
└── ai-skills-manager.code-workspace
```

## VS Code Extension (`vscode/`)

Written in **TypeScript**, bundled with esbuild, published to the VS Code Marketplace.

* [VS Code Extension README](vscode/README.md)
* [VS Code Development Guide](vscode/DEVELOPMENT.md)

### Quick Start

```bash
cd vscode
npm install
npm run watch
# Press F5 in VS Code to launch Extension Development Host
```

## JetBrains / Rider Plugin (`rider/`)

Written in **Kotlin**, built with Gradle and the IntelliJ Platform Plugin SDK. Works across all JetBrains IDEs (Rider, IntelliJ IDEA, WebStorm, PyCharm, etc.).

* [Rider Plugin README](rider/README.md)

### Quick Start

```bash
cd rider
./gradlew runIde
```

## Shared Features

Both extensions provide the same core functionality:

* **Resource Marketplace** — Browse resources from multiple GitHub repositories
* **Local Collections** — Browse resources from local folders on disk
* **One-Click Install** — Install to workspace or globally
* **Global & Workspace Scopes** — Per-category configurable install locations
* **Update Detection** — SHA-based comparison against upstream
* **Diff Before Update** — Compare incoming and existing versions before overwriting
* **Resource Scaffolding** — Create new resources from templates
* **Resource Packs** — Bundle and install multiple resources at once
* **Favorites** — Bookmark marketplace resources
* **Tag Filtering** — Filter by frontmatter tags
* **Configuration Export/Import** — Share settings across machines
* **Resource Validation** — Health checks for installed resources
* **Usage Detection** — Find which resources are referenced in workspace files
* **Multi-Select** — Bulk operations on multiple resources
* **Status Bar** — Quick access to installed count and common actions
* **File Watchers** — Automatic refresh when files change on disk

## Resource Categories

| Category | Description | File Types |
|---|---|---|
| Chat Modes | Copilot chat mode definitions | `.chatmode` files |
| Instructions | Coding and project instructions | `.instructions.md` files |
| Prompts | Reusable prompt templates | `.prompt.md` files |
| Agents | Agent configurations | Agent config files |
| Skills | Multi-file skill packages | Folders with `SKILL.md` |

## Building Distribution Packages

The repository includes build scripts that package both extensions for distribution. By default both are built; pass a flag to build only one.

### Prerequisites

#### VS Code Extension (`--vscode`)

| Requirement | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org/) | 22.x LTS or later | Includes `npm`. Used to install dependencies and run the `@vscode/vsce` packager. |
| [Git](https://git-scm.com/) | Any recent version | Required by `vsce` during packaging. |

#### Rider / JetBrains Plugin (`--rider`)

| Requirement | Version | Notes |
|---|---|---|
| [JDK](https://adoptium.net/) | 17 or later | The Gradle build compiles Kotlin to JVM 17 bytecode (`sourceCompatibility = "17"`). |
| [Gradle](https://gradle.org/) *(optional)* | 8.x+ | Only needed if the Gradle wrapper (`gradlew` / `gradlew.bat`) is missing from the `rider/` directory. The wrapper is included in the repo and is the preferred way to build. |

> **Tip — checking prerequisites:**
>
> ```bash
> # Node / npm
> node --version    # expect v22.x+
> npm --version
>
> # Java
> java --version    # expect 17+
> javac --version
>
> # Git
> git --version
> ```

### Build Scripts

| Platform | Script | Usage |
|---|---|---|
| Linux / macOS | `build_package.sh` | `./build_package.sh [--vscode] [--rider]` |
| Windows (CMD) | `build_package.bat` | `build_package.bat [--vscode] [--rider]` |
| Windows (PowerShell) | `build_package.ps1` | `.\build_package.ps1 [-VSCode] [-Rider]` |

All three scripts perform the same steps:

1. Clean previous artefacts from the project root.
2. Build the VS Code extension (`.vsix`) — runs `npm install` then `npx @vscode/vsce package`.
3. Build the Rider plugin (`.zip`) — runs `gradlew buildPlugin` (or `gradlew.bat` on Windows).
4. Copy the resulting artefacts to the project root directory.

### Linux / macOS

```bash
# Build both
./build_package.sh

# Build only the VS Code extension
./build_package.sh --vscode

# Build only the Rider plugin
./build_package.sh --rider
```

### Windows — Command Prompt

```cmd
:: Build both
build_package.bat

:: Build only the VS Code extension
build_package.bat --vscode

:: Build only the Rider plugin
build_package.bat --rider
```

### Windows — PowerShell

```powershell
# Build both
.\build_package.ps1

# Build only the VS Code extension
.\build_package.ps1 -VSCode

# Build only the Rider plugin
.\build_package.ps1 -Rider
```

> **Note:** If PowerShell's execution policy blocks the script, run
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in the current session before invoking the script.

### Output

After a successful build, the artefacts are placed in the repository root:

| Artefact | Example filename |
|---|---|
| VS Code extension | `ai-skills-manager-1.2.3.vsix` |
| Rider plugin | `ai-skills-manager-rider-1.2.3.zip` |

> NOTE: The version number `1.2.3` is an example only and will depend on the current version details.

See [vscode/DEVELOPMENT.md](vscode/DEVELOPMENT.md) and [rider/README.md](rider/README.md) for detailed development, testing, and publishing instructions for each extension.

## Shared Assets (`shared/`)

Contains icons and logos used by both extensions. Each extension copies or references these assets at build time.

## License

MIT
