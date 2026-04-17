# AI Skills Manager — JetBrains Plugin

A JetBrains IDE plugin for discovering, installing, and managing **AI development resources** from multiple GitHub repositories — with full control over where resources are installed.

A one-stop-shop for **Chat Modes**, **Instructions**, **Prompts**, **Agents**, and **Skills**.

Works in **Rider**, **IntelliJ IDEA**, **WebStorm**, **PyCharm**, and all other JetBrains IDEs.

## Features

* **Resource Marketplace** — Browse Chat Modes, Instructions, Prompts, Agents, and Skills from multiple GitHub repositories
* **Per-Repository Refresh** — Right-click a repository node in the Marketplace tree to refresh just that repo's resources, or use the toolbar refresh button to reload everything
* **Local Collections** — Browse and manage resources from local folders on disk, with the same category structure as the Marketplace
* **Search** — Quickly find resources by name or keyword in both Marketplace and Local Collections
* **One-Click Install** — Download single files or install skill folders directly into your project or globally to your home directory
* **Global & Project Scopes** — Install resources to the project (per-project) or globally (home directory, shared across all projects), and move between scopes at any time
* **Copy to Local Collection** — Copy installed resources into a configured local collection for offline sharing or backup
* **Installed Resources** — View and manage all resources installed to the project or globally, grouped by category with clear scope indicators
* **Rich Preview** — Preview resource content with rendered documentation before installing, or view details for already-installed resources
* **Context Menus** — Right-click any resource in the Marketplace, Local Collections, or Installed tree for quick access to all available actions
* **Multi-Select** — Select multiple resources using Shift+Click (range) or Ctrl+Click (toggle) and perform bulk actions: install, uninstall, move, update, favorite, create packs, delete, and more
* **Repository Management** — Enable/disable repos, add your own custom repos, all from the toolbar
* **Collection Management** — Add, toggle, or remove local collection folders via the toolbar
* **Per-Category Install Locations** — Each category installs to its own configurable folder (default: `.agents/<category>/`)
* **GitHub Auth** — Supports personal access tokens for higher API rate limits
* **Update Detection** — Automatically checks for upstream changes on installed resources and shows update badges in the Installed tree and detail panel
* **One-Click Update** — Update individual resources or all outdated resources at once, with the option to compare changes before overwriting
* **Diff Before Update** — When updating an existing resource, choose to compare the incoming and existing versions side-by-side in the IDE's diff viewer before deciding
* **Resource Scaffolding** — Create new Chat Modes, Instructions, Prompts, Agents, or Skills from built-in templates with proper frontmatter and structure
* **Favorites** — Star marketplace resources to bookmark them; favorites appear in a dedicated section at the top of the Marketplace tree
* **Resource Packs** — Bundle multiple resources into a JSON manifest and install them all at once; create packs from your currently installed resources
* **Installed Resource Validation** — Run health checks across all installed resources to detect missing files, empty content, invalid frontmatter, or missing SKILL.md
* **Export / Import Configuration** — Export your full plugin configuration (repositories, collections, install locations, favorites) to a JSON file and import it on another machine, with merge or replace strategies
* **Tag-Based Filtering** — Filter the Marketplace by tags extracted from resource frontmatter
* **Status Bar Quick Access** — A status bar widget shows the count of installed resources and available updates, with a click to open a menu for common actions
* **Resource Usage Detection** — Scan project files to discover which installed resources are actually referenced in configuration files like `copilot-instructions.md`, `settings.json`, `mcp.json`, `AGENTS.md`, and more
* **File Watchers** — Local collection and install directories are watched for changes; the tree views refresh automatically when files are added or removed on disk
* **Propose Changes** — Push local modifications back to the source GitHub repository as a pull request, directly from the plugin
* **Suggest Addition** — Right-click any resource (marketplace, local, or installed) and suggest adding it to a different GitHub repository via a pull request
* **Revert to Repository Version** — Restore a modified resource to its original installed state by fetching the upstream content
* **Modification Detection** — Automatically detects when installed resources have been locally modified, showing a "Modified" indicator in context menus and detail panels and enabling revert/propose actions

## Quick Start

### Browse Resources

1. Open the **AI Skills Manager** tool window from the right sidebar (or via **View > Tool Windows > AI Skills Manager**)
2. The **Marketplace** tab shows resources grouped by repository, then by category
3. The **Local Collections** tab shows resources from configured local folders, grouped by collection, then by category
4. Expand a repository or collection to see its categories (Chat Modes, Instructions, Prompts, Agents, Skills)
5. Expand a category to see individual resources

### Search Resources

1. Use the search field at the top of the Marketplace or Local Collections tab
2. Enter a name or keyword
3. Clear the search field to return to the full list

### Install a Resource

1. Find the resource in the Marketplace
2. **Right-click** the resource and choose **Install to Workspace** or **Install Globally** from the context menu
3. The resource will be saved to the configured install location for that category and scope

### Move Between Global and Project

1. Click the **Installed** tab
2. Each resource shows its scope: Global (globe icon) or Workspace (folder icon)
3. **Right-click** and choose **Move to Global** or **Move to Workspace** from the context menu

### Preview Resources

Double-click any resource in the Marketplace, Local Collections, or Installed tree to open a detail panel in the editor with:

* Full content and documentation
* Category badge, license, and compatibility info
* Installation status
* Install / Remove / Move buttons
* View Source button to see the resource on GitHub

### Manage Installed Resources

1. Click the **Installed** tab to see resources grouped by category
2. Each resource displays its scope (Global or Project) next to the name
3. **Double-click** any installed resource to open its detail panel
4. **Right-click** for the context menu:
   * **Open Resource** — open the file or folder in the editor
   * **View Details** — open the documentation / detail panel (works even if the resource is no longer in the marketplace)
   * **Update** — update to the latest upstream version (shown when an update is available)
   * **Move to Global** / **Move to Workspace** — relocate between scopes
   * **Copy to Local Collection** — copy the resource into a configured local collection folder
   * **Create Resource Pack** — create a pack manifest from this resource
   * **Propose Changes…** — push your local modifications back to the source repository as a pull request (only for resources installed from a marketplace repository that have been locally modified)
   * **Suggest Addition…** — suggest adding this resource to a different GitHub repository via a pull request
   * **Revert to Repository Version…** — restore the resource to its original installed state from the upstream repository (only for locally modified resources with source repo metadata)
   * **Remove** — delete the installed file or folder

### Local Collections

Local Collections let you browse resources from folders on your local disk, using the same category structure as the Marketplace.

#### Configure a local collection

1. Click the **Manage Local Collections** button in the toolbar
2. Choose **Add collection** and select a folder
3. Optionally provide a display label

Or configure them in **Settings > Tools > AI Skills Manager**.

The folder should contain category sub-folders:

```text
my-resources/
├── chatmodes/
├── instructions/
├── prompts/
├── agents/
└── skills/
    └── my-skill/
        └── SKILL.md
```

#### Install from a local collection

Resources in local collections can be installed to the project or globally, just like Marketplace resources. Right-click and choose **Install to Workspace** or **Install Globally**.

#### Delete resources from a local collection

Right-click a resource in the Local Collections tree and choose **Delete from Disk** to permanently remove it. A confirmation dialog will warn that this deletes the file or folder from disk. Skill folders are deleted recursively.

#### Manage collections

Click the **Manage Local Collections** button in the toolbar to:

* **Add** new collection folders
* **Toggle** collections on/off
* **Remove** collections from the list

You can also right-click a collection in the Local Collections tree and choose **Disconnect Collection** to remove it from the configuration. This only removes the reference — the folder and its contents remain on disk.

#### Missing collection folders

When the plugin starts (or refreshes), it checks whether each configured collection folder exists on disk. If a folder is missing:

* The collection appears with a warning indicator in the Local Collections tree
* The description shows **(missing)** next to the label
* You can still **Disconnect** the collection from the right-click menu

Collection folders are also **watched for changes**. If a new resource is added to a collection folder on disk (or one is removed), the Local Collections tree will automatically refresh within a few seconds. If a previously missing folder is created, the plugin will detect it periodically and start showing its contents. The check interval is configurable in settings (default: 30 seconds, minimum: 5 seconds, maximum: 300 seconds).

### Manage Repositories

Click the **Manage Repositories** button in the toolbar to:

* **Add** new repositories (full repo or skills-only)
* **Toggle** repositories on/off
* **Remove** repositories you no longer need

### Check for Updates

The plugin can check for upstream changes after loading the Marketplace. You can trigger a manual check:

1. Click the **Check for Updates** button in the toolbar
2. Resources with available updates show an update badge in the tree
3. Category nodes show the count of updatable resources (e.g. "2 update(s)")

To update a resource:

* Right-click a resource with an update badge and choose **Update**, or
* Click the **Update All Resources** button in the toolbar to update everything at once

When updating, you are offered the choice to:

* **Overwrite** — replace the existing file immediately
* **Compare** — open the IDE's diff viewer showing the incoming content alongside your current version
* **Cancel** — keep the existing version unchanged

For skill folders (which contain multiple files), the comparison uses the `SKILL.md` file from each version.

### Create a New Resource

1. Click the **Create New Resource** button in the toolbar
2. Choose a resource category (Chat Mode, Instruction, Prompt, Agent, or Skill)
3. Enter a name for the new resource
4. Choose between **Workspace** or **Global** scope
5. The resource is created with proper frontmatter / structure and opened in the editor

Each category uses an appropriate template:

* **Chat Modes** — `.chatmode` file with `name`, `description`, and `tools` frontmatter
* **Instructions** — `.instructions.md` with `applyTo` and `description` frontmatter
* **Prompts** — `.prompt.md` with `mode`, `description`, and `tools` frontmatter
* **Agents** — `.md` agent file with `name`, `description`, and `tools` frontmatter
* **Skills** — A folder containing `SKILL.md` with full frontmatter (name, description, license, compatibility)

### Favorites

Star resources in the Marketplace to keep them easy to find:

1. Right-click any Marketplace resource and choose **Add to Favorites**
2. Favorited resources appear in a **Favorites** section at the top of the Marketplace tree
3. To remove a favorite, right-click and choose **Remove from Favorites**

Favorites are stored globally and persist across sessions.

### Resource Packs

Resource packs let you bundle multiple resources into a single JSON file for easy sharing and bulk installation.

#### Install a pack

1. Click the **Install Pack** button in the toolbar
2. Select a `.json` pack file from your filesystem
3. Choose to install to **Workspace** or **Global** scope
4. All resources listed in the pack are installed from their source repositories

#### Create a pack

1. Click the **Create Resource Pack** button in the toolbar, or right-click installed resources and choose **Create Resource Pack**
2. Enter a name and description for the pack
3. Choose a save location
4. Save the pack as a `.json` file

When creating a pack from the Installed tree context menu, the selected resources are automatically included.

Pack file format:

```json
{
  "name": "My Team Setup",
  "description": "Standard AI resources for our team",
  "resources": [
    {
      "owner": "github",
      "repo": "awesome-copilot",
      "branch": "main",
      "category": "instructions",
      "name": "copilot-instructions.instructions.md"
    }
  ]
}
```

### Validate Installed Resources

Click the **Validate Resources** button in the toolbar to scan all installed resources for common issues:

* **Missing files** — expected file or folder not found on disk
* **Empty content** — file exists but has no content
* **Invalid frontmatter** — YAML frontmatter cannot be parsed (for `.md` resources)
* **Missing SKILL.md** — skill folder exists but has no `SKILL.md` file

Results are shown in an information dialog listing any problems found, or confirming that all resources are healthy.

### Export / Import Configuration

Share your plugin setup across machines or with your team:

#### Export

1. Click the **Export Config** button in the toolbar
2. Choose a save location for the JSON file
3. The export includes: repositories, local collections, install locations (local and global), favorites, and cache timeout

#### Import

1. Click the **Import Config** button in the toolbar
2. Select a previously exported JSON file
3. Choose an import strategy:
   * **Merge** — adds new repositories, collections, and favorites alongside your existing ones (does not duplicate)
   * **Replace** — overwrites all settings with the imported values

### Filter by Tag

Resources with tags in their frontmatter (e.g. `tags: python, testing, automation`) can be filtered using the search field or programmatically via the Marketplace panel API. Tags are parsed from both comma-separated strings and YAML arrays.

### Status Bar Quick Access

A status bar widget appears showing the number of installed resources and available updates (e.g. `AI Skills: 12 ↑3`).

Click the status bar widget to open a popup menu with common actions:

* Open AI Skills Manager
* Check for Updates
* Create New Resource
* Validate Resources
* Export / Import Configuration
* Detect Resource Usage

### Detect Resource Usage

Click the **Detect Resource Usage** button in the toolbar to scan your project for references to installed resources. The plugin searches for resource names in common configuration files:

* `.github/copilot-instructions.md`
* `.vscode/settings.json`
* `.vscode/mcp.json`
* `AGENTS.md`
* `CLAUDE.md`
* `.cursorrules`
* Other well-known AI configuration files

Results show which resources are referenced and where, helping you identify unused resources that can be cleaned up.

### Multi-Select

All three tree views (Marketplace, Local Collections, Installed) support multi-select:

* **Shift+Click** — select a contiguous range of items
* **Ctrl+Click** (or **Cmd+Click** on Mac) — toggle individual items in the selection

When multiple items are selected, right-click to see the available bulk actions. The context menu adapts to the selection — only actions that make sense for all selected items are shown.

**Marketplace / Local Collections** — bulk actions on selected resources:

* **Install to Workspace** / **Install Globally** — install all selected resources at once
* **Toggle Favorite** — add or remove favorites for all selected items (Marketplace only)
* **Delete from Disk** — delete all selected local collection resources (Local Collections only, with one confirmation)

**Installed** — bulk actions on selected installed resources:

* **Remove** — uninstall all selected resources (with a single confirmation prompt)
* **Move to Global** / **Move to Workspace** — move all selected resources between scopes
* **Update** — update all selected resources that have available updates
* **Copy to Local Collection** — copy all selected resources to a collection
* **Create Resource Pack** — create a pack from the selected resources
* **Propose Changes…** — submit a single pull request containing all selected modified resources, grouped by source repository (resources without source repo metadata are silently skipped)
* **Revert to Repository Version…** — revert all selected modified resources to their upstream versions with a single confirmation prompt (resources without source repo metadata are silently skipped)

### Propose Changes

If you've modified an installed resource locally and want to push your changes back to the source repository, you can propose changes directly from the plugin:

1. **Right-click** an installed resource and choose **Propose Changes…**, or click the **Propose Changes…** button in the resource detail panel
2. The plugin uses your configured GitHub personal access token (must have `repo` scope for write access)
3. It verifies you have push access to the source repository (collaborators only — non-collaborators see a clear error message)
4. Enter a **branch name** (auto-generated as `ai-skills-manager/<category>/<name>/<date>`, editable)
5. Enter a **PR title** and optional **description**
6. The plugin creates the branch, commits your local file(s), and opens a pull request
7. A dialog shows the PR number with an **Open in Browser** option

**Bulk propose changes:** When multiple resources are selected, the plugin groups them by source repository and creates one branch and pull request per repository, committing all changes atomically via the Git Data API. Resources without source repo metadata are silently skipped. The auto-generated branch name and PR description reflect the number of included resources.

**How it works under the hood:**
* Single-file resources are committed via the GitHub Contents API (PUT)
* Multi-file skills use the Git Data API (create blobs → tree → commit → update ref) for atomic commits
* Bulk operations always use the Git Data API for atomic multi-file commits
* Only resources installed from a marketplace repository (with `sourceRepo` metadata) can be proposed
* The feature targets direct collaborators only — fork-based contributions may be supported in a future update

> **Note:** Unlike the VS Code extension (which uses VS Code's built-in GitHub OAuth), the Rider plugin requires a GitHub personal access token with `repo` scope configured in **Settings > Tools > AI Skills Manager > GitHub Token**.

### Revert to Repository Version

If you've modified an installed resource and want to undo your changes, you can revert it to the original version from the source repository:

1. **Right-click** an installed resource that has been locally modified and choose **Revert to Repository Version…**, or click the **Revert to Repository Version…** button in the resource detail panel
2. Confirm that you want to overwrite your local changes
3. The plugin fetches the original content from the upstream repository and replaces your local copy

**Bulk revert:** When multiple resources are selected, a single confirmation prompt lists all resources that will be reverted. Resources without source repo metadata are silently skipped.

### Suggest Addition

You can suggest adding any resource — from the Marketplace, a Local Collection, or Installed — to a different GitHub repository you have write access to:

1. **Right-click** any resource in the Marketplace, Local Collections, or Installed tree and choose **Suggest Addition…**
2. Select a **target repository** from your configured repositories
3. The plugin uses your configured GitHub personal access token to verify push access to the target repository
4. Enter a **branch name** (auto-generated as `ai-skills-manager/suggest/<category>/<name>/<date>`, editable)
5. Enter a **PR title** and optional **description**
6. The plugin creates the branch, commits the resource file(s), and opens a pull request on the target repo
7. A dialog shows the PR number with an **Open in Browser** option

**Notes:**
* Resource content is fetched from GitHub for Marketplace items, or read from disk for Local Collection and Installed items
* If the resource already exists in the target repository, a warning is shown — you can still proceed (the PR will show the differences)
* Repositories configured with a `skillsPath` (skills-only repos) will only accept skill resources; suggesting other categories to these repos shows a warning
* Unlike **Propose Changes** (which pushes edits back to a resource's *source* repo), **Suggest Addition** copies a resource *to a different repo entirely*

### Modification Detection

The plugin automatically tracks whether installed resources have been locally modified:

* At install time, a SHA-256 content hash is stored in `.ai-skills-meta.json`
* When you right-click an installed resource, the plugin recomputes the hash on demand and compares it against the stored value
* Resources with mismatched hashes show the **Propose Changes** and **Revert to Repository Version** actions in the context menu and detail panel
* For single-file resources, the hash is of the file content; for skills (directories), all non-dot files are collected, sorted by relative path, and hashed together

## Resource Categories

| Category | Icon | Description | File Types |
|---|---|---|---|
| Chat Modes | 💬 | Copilot chat mode definitions | `.chatmode` files |
| Instructions | 📖 | Coding and project instructions | `.instructions.md` files |
| Prompts | 💡 | Reusable prompt templates | `.prompt.md` files |
| Agents | 🤖 | Agent configurations | Agent config files |
| Skills | 📦 | Multi-file skill packages | Folders with `SKILL.md` |

## Configuration

Open **Settings > Tools > AI Skills Manager** to configure the plugin.

### Install Locations

Each category has separate **local** (per-project) and **global** (home directory) install locations.

#### Local (per-project)

| Setting | Default | Description |
|---|---|---|
| Chat Modes | `.agents/chatmodes` | Where to install Chat Modes locally |
| Instructions | `.agents/instructions` | Where to install Instructions locally |
| Prompts | `.agents/prompts` | Where to install Prompts locally |
| Agents | `.agents/agents` | Where to install Agents locally |
| Skills | `.agents/skills` | Where to install Skills locally |

Local paths are relative to the project root. Use `~/` prefix for home directory paths.

#### Global (home directory)

| Setting | Default | Description |
|---|---|---|
| Chat Modes | `~/.agents/chatmodes` | Where to install Chat Modes globally |
| Instructions | `~/.agents/instructions` | Where to install Instructions globally |
| Prompts | `~/.agents/prompts` | Where to install Prompts globally |
| Agents | `~/.agents/agents` | Where to install Agents globally |
| Skills | `~/.agents/skills` | Where to install Skills globally |

Global resources are shared across all projects and resolve under the user's home directory.

### Repositories

Two types of repositories are supported:

1. **Full repos** — scan all category folders (chatmodes, instructions, prompts, agents, skills)
2. **Skills repos** — specify a `skillsPath` to only scan for skills at that path

Default repositories:

| Repository | Type | Description |
|---|---|---|
| [github/awesome-copilot](https://github.com/github/awesome-copilot) | Full | GitHub Copilot community resources |
| [anthropics/skills](https://github.com/anthropics/skills) | Skills | Official Anthropic skills |
| [pytorch/pytorch](https://github.com/pytorch/pytorch) | Skills | PyTorch agent skills |
| [formulahendry/agent-skill-code-runner](https://github.com/formulahendry/agent-skill-code-runner) | Skills (single) | Code runner skill |

### Local Collections

Configure local collection folders in the settings page. Each entry specifies:

* **Path** (required) — absolute path or `~/` prefix for home directory
* **Label** (optional) — display label
* **Enabled** (default: true) — toggle on/off without removing

### GitHub Token

Provide a [personal access token](https://github.com/settings/tokens) with `public_repo` scope for higher API rate limits.

### Local Collection Watch Interval

How often (in seconds) to check local collection folders for existence changes — detecting when missing folders are created on disk, or existing folders are deleted. Default: `30`. Minimum: `5`. Maximum: `300`.

### Cache Timeout

How long (in seconds) to cache resource metadata. Default: `3600` (1 hour).

## Toolbar Actions

Available from the AI Skills Manager tool window toolbar:

| Action | Description |
|---|---|
| Refresh All | Refresh marketplace, local collections, and installed data |
| Refresh Repository | Right-click a repository node to refresh just that repo |
| Check for Updates | Check installed resources for upstream changes |
| Update All Resources | Update all resources with available updates |
| Create New Resource | Scaffold a new resource from a template |
| Install Pack | Install resources from a pack JSON file |
| Create Resource Pack | Create a pack from installed resources |
| Validate Resources | Run health checks on installed resources |
| Export Config | Export settings to a JSON file |
| Import Config | Import settings from a JSON file (merge or replace) |
| Detect Resource Usage | Scan project files for resource references |
| Manage Repositories | Add, toggle, or remove repositories |
| Manage Local Collections | Add, toggle, or remove local collection folders |

## Skill Directory Structure

Skills follow the [Agent Skills specification](https://agentskills.io/):

```text
my-skill/
├── SKILL.md          # Skill metadata and documentation
├── index.js          # Main skill implementation
├── package.json      # Dependencies (if Node.js based)
└── README.md         # Additional documentation
```

### SKILL.md Format

```yaml
---
name: My Awesome Skill
description: A brief description of what this skill does
license: MIT
compatibility: Claude 3.5 Sonnet, Claude 3 Opus
tags: python, testing, automation
---

## Usage

Instructions on how to use this skill…
```

The `tags` field is optional. Tags can be specified as a comma-separated string or a YAML array. Tags are used by the tag filtering feature in the Marketplace.

## Prerequisites

* JDK 17 or later
* Any JetBrains IDE (Rider, IntelliJ IDEA, WebStorm, PyCharm, etc.)

## Development

```bash
cd rider

# Run the plugin in a sandboxed IDE instance
./gradlew runIde

# Build the plugin distribution
./gradlew buildPlugin

# Run tests
./gradlew test
```

The plugin targets IntelliJ Platform 2024.1.4 and is compatible with builds 241 through 251.*.

## Project Structure

```text
rider/
├── build.gradle.kts                         # Gradle build config
├── settings.gradle.kts                      # Gradle settings
├── gradle.properties                        # Plugin & platform versions
├── gradle/wrapper/                          # Gradle wrapper
└── src/
    └── main/
        ├── kotlin/com/adlaws/aiskillsmanager/
        │   ├── model/
        │   │   └── Types.kt                # Data classes (mirrors vscode/src/types.ts)
        │   ├── services/
        │   │   ├── ResourceClient.kt        # GitHub API client (Contents + Trees APIs)
        │   │   ├── SettingsService.kt       # Persistent settings (PersistentStateComponent)
        │   │   ├── StateService.kt          # Persistent state (favorites)
        │   │   ├── ProjectService.kt        # Project-level path resolution & scanning
        │   │   ├── InstallationService.kt   # Install / uninstall / update / move resources
        │   │   ├── ScaffoldingService.kt    # Create resources from templates
        │   │   ├── PackService.kt           # Install and create resource pack bundles
        │   │   ├── ValidationService.kt     # Health checks for installed resources
        │   │   ├── ConfigService.kt         # Export / import configuration
        │   │   └── UsageDetectionService.kt # Scan project for resource references
        │   └── ui/
        │       ├── AiSkillsToolWindowFactory.kt     # Main tool window (3 tabs + toolbar)
        │       ├── MarketplacePanel.kt              # Marketplace tree panel
        │       ├── LocalCollectionsPanel.kt         # Local Collections tree panel
        │       ├── InstalledPanel.kt                # Installed resources tree panel
        │       ├── ResourceDetailPanel.kt           # HTML detail panel (editor tab)
        │       ├── AiSkillsConfigurable.kt          # Settings UI page
        │       ├── AiSkillsStatusBarWidget.kt       # Status bar widget
        │       └── actions/
        │           └── RefreshMarketplaceAction.kt
        └── resources/
            ├── META-INF/
            │   └── plugin.xml               # Plugin descriptor
            └── icons/
                └── skills-icon.svg
```

## Architecture Mapping

The Rider plugin mirrors the VS Code extension's architecture:

| VS Code (TypeScript) | Rider (Kotlin) | Notes |
|---|---|---|
| `types.ts` | `model/Types.kt` | Enums, data classes |
| `resourceClient.ts` | `services/ResourceClient.kt` | OkHttp instead of fetch |
| `pathService.ts` | `services/ProjectService.kt` | `java.nio.file` APIs |
| `installationService.ts` | `services/InstallationService.kt` | NIO file operations |
| `scaffoldingService.ts` | `services/ScaffoldingService.kt` | Template generation |
| `packService.ts` | `services/PackService.kt` | Pack install and creation |
| `validationService.ts` | `services/ValidationService.kt` | Health checks |
| `configService.ts` | `services/ConfigService.kt` | Export / import |
| `usageDetectionService.ts` | `services/UsageDetectionService.kt` | Workspace scanning |
| `contributionService.ts` | `services/ContributionService.kt` | Branch + commit + PR via REST API |
| VS Code settings | `services/SettingsService.kt` | `PersistentStateComponent` |
| VS Code `globalState` | `services/StateService.kt` | `PersistentStateComponent` |
| `marketplaceProvider.ts` | `ui/MarketplacePanel.kt` | `JTree` + `DefaultTreeModel` |
| `localProvider.ts` | `ui/LocalCollectionsPanel.kt` | `JTree` + file watchers |
| `installedProvider.ts` | `ui/InstalledPanel.kt` | `JTree` + update badges |
| `resourceDetailPanel.ts` | `ui/ResourceDetailPanel.kt` | HTML editor tab |
| `extension.ts` | `plugin.xml` + services | Declarative wiring |
| Status bar item | `ui/AiSkillsStatusBarWidget.kt` | `StatusBarWidgetFactory` |

### Key Design Decisions

* **Two repository modes**: "Full repos" scan well-known category folders via the Contents API. "Skills repos" (with `skillsPath`) use the Git Trees API for efficient recursive scanning.
* **Local Collections**: Configured local folders on disk are scanned for the same category structure, enabling offline browsing and management of resources without GitHub. Missing collection folders are detected on startup and shown with a warning indicator; folders are watched via IntelliJ's `BulkFileListener` for automatic refresh when contents change, with a periodic existence check as a fallback.
* **Per-category install locations**: Each of the five categories has its own configurable local and global path. Local paths default to `.agents/<category>/` (project-relative); global paths default to `~/.agents/<category>/` (home directory). Paths starting with `~/` resolve to the user's home directory.
* **Global & project scopes**: Resources can be installed to the project or globally (home directory). Installed items display their scope and can be moved between scopes via context menu actions.
* **Copy to local collection**: Installed resources can be copied into any configured local collection, placing them in the correct `<collection>/<category>/<name>` structure.
* **GitHub auth**: Uses a personal access token configured in settings.
* **Install strategy**: Skills (folders) are fetched file-by-file and written to disk. Other resources are single-file downloads. Local collection installs use filesystem copy.
* **Caching**: All API responses are cached in memory with a configurable TTL (`cacheTimeout`, default 1 hour).
* **Update detection**: Install metadata (SHA hash, source repository info, and content hash) is persisted alongside each installed resource in a `.ai-skills-meta.json` file. The plugin compares local SHAs against upstream SHAs from GitHub to detect available updates.
* **Modification detection**: At install time, a SHA-256 content hash is stored in `.ai-skills-meta.json`. `isResourceModified()` recomputes the hash on demand and compares it against the stored value to detect local modifications. Modified resources show propose and revert actions in the context menu and detail panel.
* **Diff before update**: When overwriting an existing resource, the user can choose to open IntelliJ's built-in diff viewer to compare the current and incoming content before deciding.
* **Favorites**: Stored in `PersistentStateComponent` as an array of `"owner/repo:category:name"` identifiers. Favorites persist across sessions and projects.
* **Tag extraction**: Tags are parsed from the `tags` field in resource frontmatter (supports both comma-separated strings and YAML arrays). The tag index is built lazily from loaded marketplace data.
* **Resource scaffolding**: Each category has a built-in template function that generates properly structured content with frontmatter. Skills create a folder with `SKILL.md`; all other categories create a single file.
* **Resource packs**: A JSON manifest format (`{ name, description, resources[] }`) captures the source repository, category, and name of each resource. Pack installation resolves each entry against the marketplace and installs them sequentially.
* **Validation**: Health checks iterate over all installed resources across all scopes, reading files from disk to verify existence, non-empty content, parseable YAML frontmatter (for `.md` files), and `SKILL.md` presence (for skill folders).
* **Configuration export/import**: Exports capture a snapshot of all relevant settings. Import supports merge (additive, skips duplicates) and replace (full overwrite) strategies.
* **Usage detection**: Scans well-known project files (e.g. `copilot-instructions.md`, `settings.json`, `mcp.json`, `AGENTS.md`, `CLAUDE.md`) for string matches of installed resource names.
* **Propose changes**: Installed resources with source repo metadata can push local modifications back to the upstream repository. Creates a branch, commits file(s) via the GitHub REST API (Contents API for single files, Git Data API for multi-file skills), and opens a pull request. Requires a GitHub PAT with `repo` scope. Targets direct collaborators only.
* **Suggest addition**: Any resource (marketplace, local, or installed) can be suggested for addition to a different target repository via a pull request. Content is fetched from GitHub for marketplace items or read from disk for local/installed items. Skills-only repos only accept skill resources.
* **Revert to repository**: Modified resources can be reverted to their original upstream content. The plugin fetches the content from the source repository and overwrites the local copy, updating the stored content hash.
* **Status bar**: Shows installed count and update count; clicking opens a popup menu with shortcuts to common actions.
* **File watchers**: Uses IntelliJ's `VirtualFileManager` / `BulkFileListener` to watch local collection and install directories for changes, triggering debounced tree refreshes.
* **Multi-select**: All three tree panels use `DISCONTIGUOUS_TREE_SELECTION` mode, allowing Shift+Click range selection and Ctrl+Click toggle. Bulk context menus adapt to the selection.

## License

MIT
