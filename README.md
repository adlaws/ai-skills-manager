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

## Shared Assets (`shared/`)

Contains icons and logos used by both extensions. Each extension copies or references these assets at build time.

## License

MIT
