# Changelog

## 0.1.8

### New Features

* **Copy Name for Chat** — Right-click any resource in the Marketplace, Local Collections, or Installed tree to copy its name (with a configurable prefix, default `/`) to the clipboard for quick pasting into AI chat. Configurable via `aiSkillsManager.copyNamePrefix`.
* **Suggest Addition** — Right-click any resource and suggest adding it to a different GitHub repository via a pull request. Supports marketplace, local collection, and installed resources. Skills-only repos only accept skill resources.

### Bug Fixes

* **Update loop for skills repos** — Fixed a bug where "Update All" on skills installed from Trees API repositories (those with `skillsPath`) would repeatedly show them as needing updates. The install service now fetches and persists the correct SHA when the resource item lacks one.
* **Uninstall within local collections** — Fixed uninstall not working correctly when triggered from a container context.

### Updates to Existing Features

* **Per-Repository Refresh** — Right-click a repository node in the Marketplace tree to refresh just that repo without reloading everything.
* **Command module refactoring** — Extension entry point refactored into separate command modules (`installCommands`, `localCommands`, `managementCommands`, `marketplaceCommands`) for better maintainability.
* **Shared frontmatter service** — YAML frontmatter parsing extracted into a dedicated `frontmatterService.ts` module, shared across services.
* **Version number in tooltips** — Extension version number now shown in hover tooltips.
* **Rider feature parity** — Rider plugin updated to match VS Code extension features (per-repo refresh, status bar, marketplace, and installed panel enhancements).

## 0.1.5

Initial tagged release with core marketplace, install, update, local collections, favorites, packs, scaffolding, validation, config export/import, usage detection, multi-select, propose changes, revert, modification detection, and status bar features.
