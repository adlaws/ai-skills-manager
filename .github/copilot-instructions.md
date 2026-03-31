<!-- Workspace instructions for AI Skills Manager — a monorepo containing a VS Code extension and a JetBrains Rider plugin -->

- This is a monorepo with two IDE extensions sharing the same feature set: a VS Code extension (TypeScript) and a JetBrains/Rider plugin (Kotlin).
- The VS Code extension source lives under `vscode/`, the Rider plugin under `rider/`, and shared assets under `shared/`.
- The extension/plugin is a one-stop-shop for discovering, installing, and managing AI development resources: Chat Modes, Instructions, Prompts, Agents, and Skills.
- Resources are categorised by `ResourceCategory` enum: `chatmodes`, `instructions`, `prompts`, `agents`, `skills`.
- Two repository modes: "Full repo" (scans category folders) and "Skills repo" (uses `skillsPath` for Git Trees API).

## VS Code Extension (`vscode/`)

- Written in TypeScript, bundled with esbuild.
- Key architecture: Activity Bar view container with three tree views (Marketplace, Local Collections, Installed), plus detail webview panels.
- Marketplace tree: Repo → Category → Resource items (three levels). Includes a Favorites section at the top when the user has starred resources. Supports tag-based filtering.
- Local Collections tree: Collection → Category → Resource items (three levels). Configured via `aiSkillsManager.localCollections`.
- Installed tree: Category → Installed resources (two levels). Shows update badges when upstream changes are detected.
- Source files are under `vscode/src/`, with sub-folders `github/`, `services/`, `views/`, and `test/`.
- Key files: `types.ts`, `github/resourceClient.ts`, `services/pathService.ts`, `services/installationService.ts`, `services/scaffoldingService.ts`, `services/packService.ts`, `services/validationService.ts`, `services/configService.ts`, `services/usageDetectionService.ts`, `views/marketplaceProvider.ts`, `views/localProvider.ts`, `views/installedProvider.ts`, `views/resourceDetailPanel.ts`, `extension.ts`.
- Run `cd vscode && npm run watch` for development, press F5 to launch Extension Development Host.
- Configuration prefix is `aiSkillsManager.*` (not `agentSkills.*`).
- Each resource category has its own local install location setting (`aiSkillsManager.installLocation.<category>`), defaulting to `.agents/<category>/`.
- Each resource category also has a global install location setting (`aiSkillsManager.globalInstallLocation.<category>`), defaulting to `~/.agents/<category>/`.
- Resources have an `InstallScope` (`'local' | 'global'`). The `InstalledResource` interface includes a `scope` field.
- Install location settings are free-form strings, not enums. Paths starting with `~/` resolve to home directory.
- Installed tree items use scope-specific `contextValue`: `installedResourceWorkspace`, `installedResourceGlobal`, `installedResourceWorkspaceUpdatable`, or `installedResourceGlobalUpdatable`.
- Resources can be moved between workspace and global scopes via `moveToGlobal` / `moveToWorkspace` commands.
- Installed resources can be copied to local collections via the `copyToLocalCollection` command.
- Local collection resources can be deleted from disk via the `localDeleteResource` command (with confirmation).
- All actions are available via both inline icon buttons and right-click context menus in Marketplace, Local Collections, and Installed trees.
- The `viewDetails` command works for both marketplace and installed items; for installed items not in the marketplace it reads content from disk.
- Repositories use `aiSkillsManager.repositories` (not `skillRepositories`) and have an `enabled` boolean flag for toggling.
- Local collection folders are checked for existence on startup/refresh. Missing folders show a warning icon with `list.errorForeground` colour and `contextValue` `localCollectionMissing`. The Disconnect command works on both `localCollection` and `localCollectionMissing` context values.
- `LocalTreeDataProvider` implements `vscode.Disposable` and is added to `context.subscriptions`. It manages Node.js `fs.watch` watchers (recursive) for live collection directories, plus a configurable interval (`aiSkillsManager.localCollectionWatchInterval`, default 30 s, min 5 s, max 300 s) that detects newly created or deleted folders. Watcher events are debounced (1 s) before triggering a refresh.
- Install metadata (SHA + source repo) is persisted in `.ai-skills-meta.json` alongside installed resources. Used for update detection by comparing local SHAs to upstream SHAs via `fetchResourceSha()`.
- `InstallMetadata` interface and `ResourcePack`/`PackResourceRef` interfaces are defined in `types.ts`.
- `ResourceItem` has an optional `tags` field, extracted from frontmatter by `resourceClient.ts`. Tags support both comma-separated strings and YAML arrays.
- Favorites are stored in `globalState` under key `aiSkillsManager.favorites` as `"owner/repo:category:name"` identifiers.
- `scaffoldingService.ts` creates new resources from built-in templates (one per category) with proper frontmatter.
- `packService.ts` installs packs from JSON manifests and creates packs from selected installed resources.
- `validationService.ts` checks installed resources for missing files, empty content, invalid frontmatter, and missing SKILL.md.
- `configService.ts` exports/imports full extension config with merge or replace strategies.
- `usageDetectionService.ts` scans workspace files (copilot-instructions.md, settings.json, mcp.json, AGENTS.md, CLAUDE.md, .cursorrules, etc.) for resource name references.
- A status bar item shows installed count and update count. Clicking it opens a quick-pick menu with common actions.
- The extension automatically checks for updates after the initial marketplace load.
- All three tree views use `canSelectMany: true` for multi-select support (Shift+Click range, Ctrl+Click toggle).
- When `canSelectMany` is enabled, tree commands receive `(clickedItem, selectedItems[])`. All bulk-capable commands extract items from the selected array when present, falling back to the single clicked item.
- Bulk uninstall uses `uninstallResourceSilent()` (no per-item confirmation) after a single "Remove All" confirmation.
- The `createPack` command can be invoked from the installed tree context menu; when items are selected, they are pre-selected in the pack creation flow.

## JetBrains / Rider Plugin (`rider/`)

- Written in Kotlin, built with Gradle and the IntelliJ Platform Plugin SDK.
- Targets IntelliJ Platform (works in Rider, IDEA, WebStorm, and other JetBrains IDEs).
- Mirrors the VS Code extension's feature set: Marketplace, Local Collections, Installed resources, detail panels, GitHub API integration, update detection, scaffolding, packs, validation, config export/import, usage detection, multi-select, file watchers, diff before update, and status bar widget.
- Source files are under `rider/src/main/kotlin/com/adlaws/aiskillsmanager/` with sub-packages `model/`, `services/`, `ui/`.
- Key files: `model/Types.kt`, `services/ResourceClient.kt`, `services/SettingsService.kt`, `services/StateService.kt`, `services/ProjectService.kt`, `services/InstallationService.kt`, `services/ScaffoldingService.kt`, `services/PackService.kt`, `services/ValidationService.kt`, `services/ConfigService.kt`, `services/UsageDetectionService.kt`, `ui/AiSkillsToolWindowFactory.kt`, `ui/MarketplacePanel.kt`, `ui/LocalCollectionsPanel.kt`, `ui/InstalledPanel.kt`, `ui/ResourceDetailPanel.kt`, `ui/AiSkillsConfigurable.kt`, `ui/AiSkillsStatusBarWidget.kt`.
- Plugin descriptor is at `rider/src/main/resources/META-INF/plugin.xml`.
- Run `cd rider && ./gradlew runIde` for development.
- Uses IntelliJ's `ToolWindowFactory` + `JTree`/`DefaultTreeModel` for tree views, HTML-based editor tabs for detail panels, `PersistentStateComponent` for settings/state.
- GitHub API calls use OkHttp client library. YAML parsing uses SnakeYAML. JSON uses Gson.
- File operations use `java.nio.file` APIs; file watching uses IntelliJ's `VirtualFileManager` / `BulkFileListener` with debounced refresh.
- All three tree panels use `DISCONTIGUOUS_TREE_SELECTION` for multi-select support (Shift+Click range, Ctrl+Click toggle). Context menus adapt to single or multi-selection.
- Bulk uninstall uses `uninstallResourceSilent()` (no per-item confirmation) after a single confirmation prompt.
- `InstalledPanel` and `LocalCollectionsPanel` implement `Disposable` and are registered with the tool window's disposable parent.
- The `createPackFromSelected` method in `InstalledPanel` can be invoked from both the context menu and toolbar.
- Status bar widget (`AiSkillsStatusBarWidget`) shows installed count + update count; click opens popup menu with common actions.
- Diff before update uses IntelliJ's `DiffManager` / `SimpleDiffRequest` to show side-by-side comparison of local vs upstream content.
- Update All action iterates all updatable resources and updates them in a background task with progress indicator.
- Default repositories match the VS Code extension: `github/awesome-copilot`, `anthropics/skills`, `pytorch/pytorch`, `formulahendry/agent-skill-code-runner`.
- `localCollectionWatchInterval` setting controls periodic existence check interval (default 30s, min 5s, max 300s).

## Shared (`shared/`)

- Contains assets shared between both extensions (logos, icons).
- May later contain shared documentation, specs, or schema definitions.
