# AI Skills Manager for VS Code

A VS Code extension for discovering, installing, and managing **AI development resources** from multiple GitHub repositories — with full control over where resources are installed.

A one-stop-shop for **Chat Modes**, **Instructions**, **Prompts**, **Agents**, and **Skills**.

## Features

- **Resource Marketplace** — Browse Chat Modes, Instructions, Prompts, Agents, and Skills from multiple GitHub repositories
- **Local Collections** — Browse and manage resources from local folders on disk, with the same category structure as the Marketplace
- **Search** — Quickly find resources by name or keyword in both Marketplace and Local Collections
- **One-Click Install** — Download single files or install skill folders directly into your workspace or globally to your home directory
- **Global & Workspace Scopes** — Install resources to the workspace (per-workspace) or globally (home directory, shared across all workspaces), and move between scopes at any time
- **Copy to Local Collection** — Copy installed resources into a configured local collection for offline sharing or backup
- **Installed Resources** — View and manage all resources installed to the workspace or globally, grouped by category with clear scope indicators
- **Rich Preview** — Preview resource content with markdown rendering before installing, or view details for already-installed resources
- **Context Menus** — Right-click any resource in the Marketplace, Local Collections, or Installed tree for quick access to all available actions
- **Repository Management** — Enable/disable repos, add your own custom repos, all from a quick-pick UI
- **Collection Management** — Add, toggle, or remove local collection folders via a quick-pick UI
- **Per-Category Install Locations** — Each category installs to its own configurable folder (default: `.agents/<category>/`)
- **GitHub Auth** — Supports personal access tokens and VS Code's built-in GitHub authentication for higher API rate limits

## Quick Start

### Browse Resources

1. Open the **AI Skills Manager** panel in the Activity Bar
2. The **Marketplace** tab shows resources grouped by repository, then by category
3. The **Local Collections** tab shows resources from configured local folders, grouped by collection, then by category
4. Expand a repository or collection to see its categories (Chat Modes, Instructions, Prompts, Agents, Skills)
5. Expand a category to see individual resources

### Search Resources

1. Click the **Search** icon (🔍) in the Marketplace title bar
2. Enter a name or keyword
3. Click the **Clear Search** icon (✕) to return to the full list

### Install a Resource

1. Find the resource in the Marketplace
2. Click the **Install to Workspace** button (⬇️) to install to the workspace, or the **Install Globally** button (🏠) to install to the home directory
3. Or **right-click** the resource and choose **Install to Workspace** or **Install Globally** from the context menu
4. The resource will be saved to the configured install location for that category and scope

> **Tip:** Hover over any install or move button (in the detail panel) to see a tooltip showing the exact path the resource will be installed to.

### Move Between Global and Workspace

1. Click the **Installed** tab
2. Each resource shows its scope: **\$(home) Global** or **\$(folder) Workspace**
3. Click the **Move to Global** (🏠) or **Move to Workspace** (📁) inline button, or **right-click** and choose the move action from the context menu

### Preview Resources

Click any resource in the Marketplace, Local Collections, or Installed tree to preview its contents in a detail panel with:

- Full content / documentation with markdown rendering
- Category badge, license, and compatibility info
- Installation status
- **Install to Workspace** / **Install Globally** buttons (with hover tooltips showing the target path)
- **Remove** and **Move to Global** / **Move to Workspace** buttons for installed resources
- View Source button to see the resource on GitHub

### Manage Installed Resources

1. Click the **Installed** tab to see resources grouped by category
2. Each resource displays its scope (Global or Workspace) next to the description
3. **Click** any installed resource to open its detail panel
4. For each installed resource you can also use **inline buttons** or **right-click the context menu**:
   - **Remove** — delete the installed file or folder
   - **View Details** — open the documentation / detail panel (works even if the resource is no longer in the marketplace)
   - **Open** — open the file or folder in the editor
   - **Move to Global** / **Move to Workspace** — relocate between scopes (shown based on current scope)
   - **Copy to Local Collection** — copy the resource into a configured local collection folder

### Local Collections

Local Collections let you browse resources from folders on your local disk, using the same category structure as the Marketplace.

#### Configure a local collection

1. Click the **gear** icon (⚙️) in the **Local Collections** title bar
2. Choose **Add local collection…** to select a folder
3. Optionally provide a display label

Or add entries directly in settings:

```json
"aiSkillsManager.localCollections": [
  {
    "path": "/path/to/my/resources",
    "label": "My AI Resources",
    "enabled": true
  }
]
```

The folder should contain category sub-folders:

```
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

Resources in local collections can be installed to the workspace or globally, just like Marketplace resources:
- Click **Install to Workspace** (⬇️) or **Install Globally** (🏠) on any resource
- Resources are copied from the collection folder to the configured install location

#### Delete resources from a local collection

**Right-click** a resource in the Local Collections tree and choose **Delete from Disk** to permanently remove it. A confirmation dialog will warn that this deletes the file or folder from disk. Skill folders are deleted recursively.

#### Manage collections

Click the **gear** icon (⚙️) in the Local Collections title bar to:
- **Toggle** collections on/off
- **Add** new collection folders
- **Remove** collections from the list

You can also **right-click** a collection in the Local Collections tree and choose **Disconnect Local Collection** to remove it from the configuration. This only removes the reference — the folder and its contents remain on disk.

#### Missing collection folders

When the extension starts (or refreshes), it checks whether each configured collection folder exists on disk. If a folder is missing:

- The collection appears with a **warning icon** in the Local Collections tree, coloured to indicate an error
- The description shows **(not found)** next to the path
- The tooltip explains that the folder could not be found and suggests disconnecting or creating it
- The collection cannot be expanded (no children to show)
- You can still **Disconnect** the collection from the right-click menu or inline button to correct your configuration

Collection folders are also **watched for changes**. If a new resource is added to a collection folder on disk (or one is removed), the Local Collections tree will automatically refresh within a few seconds. If a previously missing folder is created, the extension will detect it periodically and start showing its contents. The check interval is configurable via `aiSkillsManager.localCollectionWatchInterval` (default: 30 seconds, minimum: 5 seconds).

### Manage Repositories

Click the **gear** icon (⚙️) in the Marketplace title bar to:

- **Toggle** repositories on/off
- **Add** new repositories (full repo or skills-only)
- **Remove** repositories you no longer need

## Resource Categories

| Category | Icon | Description | File Types |
|---|---|---|---|
| Chat Modes | 💬 | Copilot chat mode definitions | `.chatmode` files |
| Instructions | 📖 | Coding and project instructions | `.instructions.md` files |
| Prompts | 💡 | Reusable prompt templates | `.prompt.md` files |
| Agents | 🤖 | Agent configurations | Agent config files |
| Skills | 📦 | Multi-file skill packages | Folders with `SKILL.md` |

## Configuration

Press `Ctrl+,` (or `Cmd+,` on Mac) and search for **AI Skills Manager**.

### Install Locations

Each category has separate **local** and **global** install location settings:

#### Local (per-workspace)

| Setting | Default | Description |
|---|---|---|
| `aiSkillsManager.installLocation.chatmodes` | `.agents/chatmodes` | Where to install Chat Modes locally |
| `aiSkillsManager.installLocation.instructions` | `.agents/instructions` | Where to install Instructions locally |
| `aiSkillsManager.installLocation.prompts` | `.agents/prompts` | Where to install Prompts locally |
| `aiSkillsManager.installLocation.agents` | `.agents/agents` | Where to install Agents locally |
| `aiSkillsManager.installLocation.skills` | `.agents/skills` | Where to install Skills locally |

Local paths are relative to the workspace root. Use `~/` prefix for home directory paths.

#### Global (home directory)

| Setting | Default | Description |
|---|---|---|
| `aiSkillsManager.globalInstallLocation.chatmodes` | `~/.agents/chatmodes` | Where to install Chat Modes globally |
| `aiSkillsManager.globalInstallLocation.instructions` | `~/.agents/instructions` | Where to install Instructions globally |
| `aiSkillsManager.globalInstallLocation.prompts` | `~/.agents/prompts` | Where to install Prompts globally |
| `aiSkillsManager.globalInstallLocation.agents` | `~/.agents/agents` | Where to install Agents globally |
| `aiSkillsManager.globalInstallLocation.skills` | `~/.agents/skills` | Where to install Skills globally |

Global resources are shared across all workspaces and resolve under the user's home directory.

### Repositories

**Setting:** `aiSkillsManager.repositories`

Two types of repositories are supported:

1. **Full repos** — scan all category folders (chatmodes, instructions, prompts, agents, skills)
2. **Skills repos** — specify a `skillsPath` to only scan for skills at that path

Default repositories:

| Repository | Type | Description |
|---|---|---|
| [`github/awesome-copilot`](https://github.com/github/awesome-copilot) | Full | GitHub Copilot community resources |
| [`anthropics/skills`](https://github.com/anthropics/skills) | Skills | Official Anthropic skills |
| [`pytorch/pytorch`](https://github.com/pytorch/pytorch) | Skills | PyTorch agent skills |
| [`formulahendry/agent-skill-code-runner`](https://github.com/formulahendry/agent-skill-code-runner) | Skills (single) | Code runner skill |

Example configuration:

```json
"aiSkillsManager.repositories": [
  {
    "owner": "github",
    "repo": "awesome-copilot",
    "branch": "main",
    "enabled": true,
    "label": "Awesome Copilot"
  },
  {
    "owner": "my-org",
    "repo": "my-skills",
    "branch": "main",
    "enabled": true,
    "skillsPath": "skills"
  }
]
```

### Local Collections

**Setting:** `aiSkillsManager.localCollections`

An array of local folder paths to browse for AI resources. Each entry specifies:
- `path` (required) — Absolute path or `~/` prefix for home directory
- `label` (optional) — Display label
- `enabled` (default `true`) — Toggle on/off without removing

### GitHub Token

**Setting:** `aiSkillsManager.githubToken`

Provide a [personal access token](https://github.com/settings/tokens) with `public_repo` scope for higher API rate limits. Alternatively, the extension will use VS Code's built-in GitHub authentication if available.

### Local Collection Watch Interval

**Setting:** `aiSkillsManager.localCollectionWatchInterval`

How often (in seconds) to check local collection folders for existence changes — detecting when missing folders are created on disk, or existing folders are deleted. Lower values detect changes faster but use more resources. Default: `30`. Minimum: `5`. Maximum: `300`.

### Cache Timeout

**Setting:** `aiSkillsManager.cacheTimeout`

How long (in seconds) to cache resource metadata. Default: `3600` (1 hour).

## Commands

Available via Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---|---|
| AI Skills Manager: Search Resources | Open search dialog |
| AI Skills Manager: Clear Search | Clear search and show all resources |
| AI Skills Manager: Refresh | Refresh marketplace, local collections, and installed data |
| AI Skills Manager: Install to Workspace | Install selected resource to the workspace |
| AI Skills Manager: Install Globally | Install selected resource to global (home directory) location |
| AI Skills Manager: Remove | Remove selected installed resource |
| AI Skills Manager: Move to Global | Move an installed resource from workspace to global scope |
| AI Skills Manager: Move to Workspace | Move an installed resource from global to workspace scope |
| AI Skills Manager: Copy to Local Collection | Copy an installed resource into a local collection folder |
| AI Skills Manager: Preview Resource | Preview resource content |
| AI Skills Manager: View Details | Open resource detail panel |
| AI Skills Manager: Open Resource | Open installed resource file/folder |
| AI Skills Manager: Manage Repositories | Toggle/add/remove repos |
| AI Skills Manager: Search Local Resources | Search within local collections |
| AI Skills Manager: Clear Local Search | Clear local collections search |
| AI Skills Manager: Manage Local Collections | Toggle/add/remove local collection folders |
| AI Skills Manager: Delete from Disk | Delete a resource from a local collection (permanent) |
| AI Skills Manager: Disconnect Local Collection | Remove a collection from the configuration without deleting from disk |

## Skill Directory Structure

Skills follow the [Agent Skills specification](https://agentskills.io/):

```
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
---

## Usage

Instructions on how to use this skill…
```

## Development

```bash
# Install dependencies
npm install

# Watch mode (build on save)
npm run watch

# One-off compile with type checking + lint
npm run compile

# Production bundle
npm run package

# Run all tests (downloads VS Code, runs in Extension Host)
npm test

# Compile tests only (useful for IDE error checking)
npm run compile-tests
```

Press **F5** in VS Code to launch the Extension Development Host.

## Testing

The test suite runs inside the VS Code Extension Host via `@vscode/test-cli` + `@vscode/test-electron`, so all `vscode` APIs are available.

| Test file | Module under test | What's covered |
|---|---|---|
| `types.test.ts` | `types.ts` | `ResourceCategory` enum, `ALL_CATEGORIES`, `CATEGORY_LABELS`, `CATEGORY_ICONS`, `DEFAULT_INSTALL_PATHS`, `DEFAULT_GLOBAL_INSTALL_PATHS` |
| `pathService.test.ts` | `services/pathService.ts` | `isHomeLocation`, `requiresWorkspaceFolder`, `getInstallLocation`, `getGlobalInstallLocation`, `getInstallLocationForScope`, `getScopeForLocation`, `getScanLocations`, `resolveLocationToUri`, `resolveInstallTarget`, `resolveInstallTargetForScope` |
| `resourceClient.test.ts` | `github/resourceClient.ts` | SKILL.md parsing (frontmatter, missing fields, Windows line endings), `repoKey`, `toResourceItem`, cache get/set/clear |
| `marketplaceProvider.test.ts` | `views/marketplaceProvider.ts` | `RepoTreeItem`, `CategoryTreeItem`, `ResourceTreeItem` (labels, icons, context values), search activate/clear, `getAllItems`, `getItemByName` |
| `installedProvider.test.ts` | `views/installedProvider.ts` | `InstalledCategoryTreeItem`, `InstalledResourceTreeItem` (labels, icons, tooltips), `getInstalledNames`, `isInstalled`, `getChildren` |

Run with:

```bash
npm test
```

## Architecture

```
src/
├── types.ts                         # Shared types, enums, and constants
├── github/
│   └── resourceClient.ts            # GitHub API client (Contents + Trees)
├── services/
│   ├── pathService.ts               # Install/scan location resolution
│   └── installationService.ts       # Install / uninstall / open / copy resources
├── views/
│   ├── marketplaceProvider.ts        # 3-level tree: Repo → Category → Item
│   ├── localProvider.ts              # 3-level tree: Collection → Category → Item
│   ├── installedProvider.ts          # 2-level tree: Category → Item
│   └── resourceDetailPanel.ts        # Webview detail panel
├── extension.ts                     # Entry point, command & watcher wiring
└── test/
    ├── types.test.ts
    ├── pathService.test.ts
    ├── resourceClient.test.ts
    ├── marketplaceProvider.test.ts
    └── installedProvider.test.ts
```

### Key design decisions

- **Two repository modes**: "Full repos" scan well-known category folders via the Contents API. "Skills repos" (with `skillsPath`) use the Git Trees API for efficient recursive scanning.
- **Local Collections**: Configured local folders on disk are scanned for the same category structure, enabling offline browsing and management of resources without GitHub. Missing collection folders are detected on startup and shown with a warning indicator; folders are watched via Node.js `fs.watch` for automatic refresh when contents change, with a periodic 30-second existence check as a fallback.
- **Per-category install locations**: Each of the five categories has its own configurable local and global path. Local paths default to `.agents/<category>/` (workspace-relative); global paths default to `~/.agents/<category>/` (home directory). Paths starting with `~/` resolve to the user's home directory.
- **Global & workspace scopes**: Resources can be installed to the workspace or globally (home directory). Installed items display their scope and can be moved between scopes via inline actions.
- **Copy to local collection**: Installed resources can be copied into any configured local collection, placing them in the correct `<collection>/<category>/<name>` structure.
- **GitHub auth cascade**: Tries `aiSkillsManager.githubToken` first, then falls back to VS Code's built-in GitHub authentication (`vscode.authentication`).
- **Install strategy**: Skills (folders) are fetched file-by-file and written to disk. Other resources are single-file downloads. Local collection installs use filesystem copy.
- **Caching**: All API responses are cached in memory with a configurable TTL (`cacheTimeout`, default 1 hour).

## License

MIT
