# AI Skills Manager for VS Code

A VS Code extension for discovering, installing, and managing **AI development resources** from multiple GitHub repositories — with full control over where resources are installed.

A one-stop-shop for **Chat Modes**, **Instructions**, **Prompts**, **Agents**, and **Skills**.

## Features

* **Resource Marketplace** — Browse Chat Modes, Instructions, Prompts, Agents, and Skills from multiple GitHub repositories
* **Per-Repository Refresh** — Right-click a repository node in the Marketplace tree to refresh just that repo's resources, or use the header refresh button to reload everything
* **Local Collections** — Browse and manage resources from local folders on disk, with the same category structure as the Marketplace
* **Search** — Quickly find resources by name or keyword in both Marketplace and Local Collections
* **One-Click Install** — Download single files or install skill folders directly into your workspace or globally to your home directory
* **Global & Workspace Scopes** — Install resources to the workspace (per-workspace) or globally (home directory, shared across all workspaces), and move between scopes at any time
* **Copy to Local Collection** — Copy installed resources into a configured local collection for offline sharing or backup
* **Installed Resources** — View and manage all resources installed to the workspace or globally, grouped by category with clear scope indicators
* **Rich Preview** — Preview resource content with markdown rendering before installing, or view details for already-installed resources
* **Context Menus** — Right-click any resource in the Marketplace, Local Collections, or Installed tree for quick access to all available actions
* **Repository Management** — Enable/disable repos, add your own custom repos, all from a quick-pick UI
* **Collection Management** — Add, toggle, or remove local collection folders via a quick-pick UI
* **Per-Category Install Locations** — Each category installs to its own configurable folder (default: `.agents/<category>/`)
* **GitHub Auth** — Supports personal access tokens and VS Code's built-in GitHub authentication for higher API rate limits
* **Update Detection** — Automatically checks for upstream changes on installed resources and shows update badges in the Installed tree and detail panel
* **One-Click Update** — Update individual resources or all outdated resources at once, with the option to compare changes before overwriting
* **Resource Scaffolding** — Create new Chat Modes, Instructions, Prompts, Agents, or Skills from built-in templates with proper frontmatter and structure
* **Favorites** — Star marketplace resources to bookmark them; favorites appear in a dedicated section at the top of the Marketplace tree
* **Resource Packs** — Bundle multiple resources into a JSON manifest and install them all at once; create packs from your currently installed resources
* **Diff Before Update** — When overwriting an existing resource, choose to compare the incoming and existing versions side-by-side in VS Code's diff editor before deciding
* **Installed Resource Validation** — Run health checks across all installed resources to detect missing files, empty content, invalid frontmatter, or missing SKILL.md
* **Export / Import Configuration** — Export your full extension configuration (repositories, collections, install locations, favorites) to a JSON file and import it on another machine, with merge or replace strategies
* **Tag-Based Filtering** — Filter the Marketplace by tags extracted from resource frontmatter; active tag filters are shown in the tree title
* **Status Bar Quick Access** — A status bar item shows the count of installed resources and available updates, with a click to open a quick-pick menu for common actions
* **Resource Usage Detection** — Scan workspace files to discover which installed resources are actually referenced in configuration files like `copilot-instructions.md`, `settings.json`, `mcp.json`, `AGENTS.md`, and more
* **Multi-Select** — Select multiple resources using Shift+Click (range) or Ctrl+Click (toggle) and perform bulk actions: install, uninstall, move, update, favorite, create packs, delete, and more
* **Propose Changes** — Push local modifications back to the source GitHub repository as a pull request, directly from the extension
* **Suggest Addition** — Right-click any resource (marketplace, local, or installed) and suggest adding it to a different GitHub repository via a pull request
* **Revert to Repository Version** — Restore a modified resource to its original installed state by fetching the upstream content
* **Modification Detection** — Automatically detects when installed resources have been locally modified, showing a "Modified" indicator in the tree and enabling revert/propose actions

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

* Full content / documentation with markdown rendering
* Category badge, license, and compatibility info
* Installation status
* **Install to Workspace** / **Install Globally** buttons (with hover tooltips showing the target path)
* **Remove** and **Move to Global** / **Move to Workspace** buttons for installed resources
* View Source button to see the resource on GitHub

### Manage Installed Resources

1. Click the **Installed** tab to see resources grouped by category
2. Each resource displays its scope (Global or Workspace) next to the description
3. **Click** any installed resource to open its detail panel
4. For each installed resource you can also use **inline buttons** or **right-click the context menu**:
   * **Remove** — delete the installed file or folder
   * **View Details** — open the documentation / detail panel (works even if the resource is no longer in the marketplace)
   * **Open** — open the file or folder in the editor
   * **Move to Global** / **Move to Workspace** — relocate between scopes (shown based on current scope)
   * **Copy to Local Collection** — copy the resource into a configured local collection folder
   * **Propose Changes…** — push your local modifications back to the source repository as a pull request (only shown when locally modified)
   * **Suggest Addition…** — suggest adding this resource to a different GitHub repository via a pull request
   * **Revert to Repository Version…** — restore the resource to its original installed state from the upstream repository (only shown when locally modified)
5. Resources that have been locally modified show a **"Modified"** indicator in the tree description

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
* Click **Install to Workspace** (⬇️) or **Install Globally** (🏠) on any resource
* Resources are copied from the collection folder to the configured install location

#### Delete resources from a local collection

**Right-click** a resource in the Local Collections tree and choose **Delete from Disk** to permanently remove it. A confirmation dialog will warn that this deletes the file or folder from disk. Skill folders are deleted recursively.

#### Manage collections

Click the **gear** icon (⚙️) in the Local Collections title bar to:
* **Toggle** collections on/off
* **Add** new collection folders
* **Remove** collections from the list

You can also **right-click** a collection in the Local Collections tree and choose **Disconnect Local Collection** to remove it from the configuration. This only removes the reference — the folder and its contents remain on disk.

#### Missing collection folders

When the extension starts (or refreshes), it checks whether each configured collection folder exists on disk. If a folder is missing:

* The collection appears with a **warning icon** in the Local Collections tree, coloured to indicate an error
* The description shows **(not found)** next to the path
* The tooltip explains that the folder could not be found and suggests disconnecting or creating it
* The collection cannot be expanded (no children to show)
* You can still **Disconnect** the collection from the right-click menu or inline button to correct your configuration

Collection folders are also **watched for changes**. If a new resource is added to a collection folder on disk (or one is removed), the Local Collections tree will automatically refresh within a few seconds. If a previously missing folder is created, the extension will detect it periodically and start showing its contents. The check interval is configurable via `aiSkillsManager.localCollectionWatchInterval` (default: 30 seconds, minimum: 5 seconds).

### Manage Repositories

Click the **gear** icon (⚙️) in the Marketplace title bar to:

* **Toggle** repositories on/off
* **Add** new repositories (full repo or skills-only)
* **Remove** repositories you no longer need

### Check for Updates

The extension automatically checks for upstream changes after loading the Marketplace. You can also trigger a manual check:

1. Click the **Check for Updates** icon (🔄) in the **Installed** title bar
2. Resources with available updates show an **"Update available"** badge in the tree and in the detail panel
3. Category nodes show the count of updatable resources (e.g. "2 updates")

To update a resource:
* Click **Update Resource** (⬇️) on any resource with an update badge, or
* Click **Update All Resources** (🔄) in the Installed title bar to update everything at once

When updating, if the resource already exists on disk, you'll be offered the option to **Compare** the incoming and existing versions in VS Code's diff editor before overwriting.

### Create a New Resource

1. Click the **+** icon in the **Installed** title bar, or run **AI Skills Manager: Create New Resource…** from the Command Palette
2. Choose a resource category (Chat Mode, Instruction, Prompt, Agent, or Skill)
3. Enter a name for the new resource
4. Choose between **workspace** or **global** scope
5. The resource is created with proper frontmatter / structure and opened in the editor

Each category uses an appropriate template:
* **Chat Modes** — `.chatmode` file with `name`, `description`, and `tools` frontmatter
* **Instructions** — `.instructions.md` with `applyTo` and `description` frontmatter
* **Prompts** — `.prompt.md` with `mode`, `description`, and `tools` frontmatter
* **Agents** — `.md` agent file with `name`, `description`, and `tools` frontmatter
* **Skills** — A folder containing `SKILL.md` with full frontmatter (name, description, license, compatibility)

### Favorites

Star resources in the Marketplace to keep them easy to find:

1. Click the **star** icon (⭐) next to any Marketplace resource, or right-click and choose **Toggle Favorite**
2. Favorited resources appear in a **Favorites** section at the top of the Marketplace tree
3. To remove a favorite, click the star again or right-click and choose **Remove from Favorites**

Favorites are stored globally and persist across sessions.

### Resource Packs

Resource packs let you bundle multiple resources into a single JSON file for easy sharing and bulk installation.

#### Install a pack

1. Run **AI Skills Manager: Install Resource Pack…** from the Command Palette
2. Select a `.json` pack file from your filesystem
3. Choose to install to **workspace** or **global** scope
4. All resources listed in the pack are installed from their source repositories

#### Create a pack

1. Run **AI Skills Manager: Create Resource Pack from Installed…** from the Command Palette
2. Select which installed resources to include (multi-select)
3. Enter a name and description for the pack
4. Save the pack as a `.json` file

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

### Diff Before Update

When installing or updating a resource that already exists on disk, the extension asks whether to overwrite:

* **Overwrite** — Replace the existing file immediately
* **Compare** — Open VS Code's diff editor showing the incoming content alongside your current version, so you can review changes before deciding
* **Cancel** — Keep the existing version unchanged

For skill folders (which contain multiple files), the comparison uses the `SKILL.md` file from each version.

### Validate Installed Resources

Run **AI Skills Manager: Validate Installed Resources** from the Command Palette to scan all installed resources for common issues:

* **Missing files** — Expected file or folder not found on disk
* **Empty content** — File exists but has no content
* **Invalid frontmatter** — YAML frontmatter cannot be parsed (for `.md` resources)
* **Missing SKILL.md** — Skill folder exists but has no `SKILL.md` file

Results are shown in an information message listing any problems found, or confirming that all resources are healthy. Issues are also logged to the Output Channel.

### Export / Import Configuration

Share your extension setup across machines or with your team:

#### Export

1. Run **AI Skills Manager: Export Configuration…** from the Command Palette
2. Choose a save location for the JSON file
3. The export includes: repositories, local collections, install locations (local and global), favorites, and cache timeout

#### Import

1. Run **AI Skills Manager: Import Configuration…** from the Command Palette
2. Select a previously exported JSON file
3. Choose an import strategy:
   * **Merge** — Adds new repositories, collections, and favorites alongside your existing ones (does not duplicate)
   * **Replace** — Overwrites all settings with the imported values

### Filter by Tag

Resources with tags in their frontmatter (e.g. `tags: python, testing, automation`) can be filtered:

1. Click the **tag** icon (🏷️) in the Marketplace title bar, or run **AI Skills Manager: Filter by Tag…**
2. Select one or more tags from the list of all tags found across loaded resources
3. The Marketplace tree shows only resources matching the selected tags
4. Click the **clear** icon (✕) in the title bar or run **AI Skills Manager: Clear Tag Filter** to remove the filter

### Status Bar Quick Access

A status bar item appears on the **right side** of the VS Code status bar. It uses a wrench icon (`$(tools)`) and adapts its display based on the current state:

| State | Display | Example |
|---|---|---|
| No resources installed | Wrench icon + "AI Skills" label | 🔧 AI Skills |
| Resources installed, no updates | Wrench icon + installed count | 🔧 4 |
| Resources installed, updates available | Wrench icon + count + cloud icon + update count | 🔧 4 ⬇ 2 |

Hovering over the status bar item shows a tooltip with a summary (e.g. "AI Skills Manager — 4 resources installed" or "AI Skills Manager — 4 installed, 2 updates available").

**Click** the status bar item to open a quick-pick menu with common actions:

* **Browse Marketplace** — focus the Marketplace tree view
* **Create New Resource…** — scaffold a new resource from a template
* **View Installed** — focus the Installed tree view (shown when resources are installed, with count)
* **Update All** — update all resources with available updates (shown when updates exist, with count)
* **Check for Updates** — manually check for upstream changes
* **Install Resource Pack…** — install resources from a pack JSON file
* **Validate Installed Resources** — run health checks
* **Export Configuration…** — export settings to a JSON file
* **Import Configuration…** — import settings from a JSON file
* **Detect Resource Usage** — scan workspace for resource references

The status bar item updates automatically whenever the Installed tree changes (installs, uninstalls, updates, moves).

> **Note:** VS Code's status bar API only supports built-in [codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) icons — custom images or the AI Skills Manager logo cannot be used in the status bar. The wrench icon (`$(tools)`) was chosen as the closest match.

### Detect Resource Usage

Run **AI Skills Manager: Detect Resource Usage** from the Command Palette to scan your workspace for references to installed resources. The extension searches for resource names in common configuration files:

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

* **Shift+Click** — Select a contiguous range of items
* **Ctrl+Click** (or **Cmd+Click** on Mac) — Toggle individual items in the selection

When multiple items are selected, right-click to see the available bulk actions. The context menu adapts to the selection — only actions that make sense for all selected items are shown.

**Marketplace / Local Collections** — Bulk actions on selected resources:
* **Install to Workspace** / **Install Globally** — Install all selected resources at once
* **Toggle Favorite** — Add or remove favorites for all selected items (Marketplace only)

**Installed** — Bulk actions on selected installed resources:
* **Remove** — Uninstall all selected resources (with a single confirmation prompt)
* **Move to Global** / **Move to Workspace** — Move all selected resources between scopes
* **Update** — Update all selected resources that have available updates
* **Copy to Local Collection** — Copy all selected resources to a collection
* **Create Resource Pack** — Create a pack from the selected resources
* **Delete from Disk** — Delete all selected local collection resources (with one confirmation)

### Propose Changes

If you've modified an installed resource locally and want to push your changes back to the source repository, you can propose changes directly from the extension:

1. **Right-click** an installed resource and choose **Propose Changes…**, or click the **Propose Changes…** button in the resource detail panel, or run **AI Skills Manager: Propose Changes…** from the Command Palette
2. The extension authenticates with GitHub (requesting `repo` scope for write access)
3. It verifies you have push access to the source repository (collaborators only — non-collaborators see a clear error message)
4. Enter a **branch name** (auto-generated as `ai-skills-manager/<category>/<name>/<date>`, editable)
5. Enter a **PR title** and optional **description**
6. The extension creates the branch, commits your local file(s), and opens a pull request
7. A notification shows the PR number with an **Open in Browser** link

**How it works under the hood:**
* Single-file resources are committed via the GitHub Contents API (PUT)
* Multi-file skills use the Git Data API (create blobs → tree → commit → update ref) for atomic commits
* Only resources installed from a marketplace repository (with `sourceRepo` metadata) can be proposed
* The feature targets direct collaborators only — fork-based contributions may be supported in a future update

### Revert to Repository Version

If you've modified an installed resource and want to undo your changes, you can revert it to the original version from the source repository:

1. **Right-click** an installed resource that shows a **"Modified"** indicator and choose **Revert to Repository Version…**, or click the **Revert to Repository Version…** button in the resource detail panel
2. Confirm that you want to overwrite your local changes
3. The extension fetches the original content from the upstream repository and replaces your local copy

### Suggest Addition

You can suggest adding any resource — from the Marketplace, a Local Collection, or Installed — to a different GitHub repository you have write access to:

1. **Right-click** any resource in the Marketplace, Local Collections, or Installed tree and choose **Suggest Addition…**
2. Select a **target repository** from your configured repositories
3. The extension authenticates with GitHub (requesting `repo` scope for write access)
4. It verifies you have push access to the target repository
5. Enter a **branch name** (auto-generated as `ai-skills-manager/suggest/<category>/<name>/<date>`, editable)
6. Enter a **PR title** and optional **description**
7. The extension creates the branch, commits the resource file(s), and opens a pull request on the target repo
8. A notification shows the PR number with an **Open in Browser** link

**Notes:**
* Resource content is fetched from GitHub for Marketplace items, or read from disk for Local Collection and Installed items
* If the resource already exists in the target repository, a warning is shown — you can still proceed (the PR will show the differences)
* Repositories configured with a `skillsPath` (skills-only repos) will only accept skill resources; suggesting other categories to these repos shows a warning
* Unlike **Propose Changes** (which pushes edits back to a resource's *source* repo), **Suggest Addition** copies a resource *to a different repo entirely*
4. The modification indicator is removed and the content hash is updated

> **Note:** Only resources installed from a marketplace repository (with `sourceRepo` metadata) that have been locally modified will show the revert option.

### Modification Detection

The extension automatically tracks whether installed resources have been locally modified:

* At install time, a SHA-256 content hash is stored in `.ai-skills-meta.json`
* On startup and whenever an installed file changes on disk, the extension recomputes the hash and compares it against the stored value
* Resources with mismatched hashes show a **"Modified"** indicator in the Installed tree
* The **Propose Changes** and **Revert to Repository Version** actions only appear for modified resources
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
* `path` (required) — Absolute path or `~/` prefix for home directory
* `label` (optional) — Display label
* `enabled` (default `true`) — Toggle on/off without removing

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
| AI Skills Manager: Refresh Repository | Refresh a single repository's resources in the Marketplace |
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
| AI Skills Manager: Update Resource | Update a single installed resource to the latest upstream version |
| AI Skills Manager: Update All Resources | Update all installed resources that have available updates |
| AI Skills Manager: Check for Updates | Manually check installed resources for upstream changes |
| AI Skills Manager: Create New Resource… | Scaffold a new resource from a template (choose category, name, scope) |
| AI Skills Manager: Toggle Favorite | Add or remove a marketplace resource from favorites |
| AI Skills Manager: Remove from Favorites | Remove a resource from favorites |
| AI Skills Manager: Install Resource Pack… | Install all resources defined in a pack JSON file |
| AI Skills Manager: Create Resource Pack from Installed… | Create a pack JSON file from selected installed resources |
| AI Skills Manager: Validate Installed Resources | Run health checks on all installed resources |
| AI Skills Manager: Export Configuration… | Export extension settings to a JSON file |
| AI Skills Manager: Import Configuration… | Import extension settings from a JSON file (merge or replace) |
| AI Skills Manager: Filter by Tag… | Filter marketplace resources by tag |
| AI Skills Manager: Clear Tag Filter | Remove the active tag filter |
| AI Skills Manager: Detect Resource Usage | Scan workspace files for references to installed resources |
| AI Skills Manager: Propose Changes… | Push local modifications to the source repository as a pull request |
| AI Skills Manager: Suggest Addition… | Suggest adding a resource to a different GitHub repository via a pull request |
| AI Skills Manager: Revert to Repository Version… | Restore a modified resource to its original upstream content |

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
tags: python, testing, automation
---

## Usage

Instructions on how to use this skill…
```

The `tags` field is optional. Tags can be specified as a comma-separated string or a YAML array. Tags are used by the **Filter by Tag** feature in the Marketplace.

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
├── types.ts                         # Shared types, enums, constants, and interfaces
├── github/
│   └── resourceClient.ts            # GitHub API client (Contents + Trees), tag extraction
├── services/
│   ├── pathService.ts               # Install/scan location resolution
│   ├── installationService.ts       # Install / uninstall / update / open / copy resources
│   ├── scaffoldingService.ts        # Create new resources from category templates
│   ├── packService.ts               # Install and create resource pack bundles
│   ├── validationService.ts         # Health checks for installed resources
│   ├── configService.ts             # Export / import extension configuration
│   ├── usageDetectionService.ts     # Scan workspace for resource references
│   └── contributionService.ts       # Propose changes (branch + commit + PR)
├── views/
│   ├── marketplaceProvider.ts        # 3-level tree: Repo → Category → Item (+ Favorites, tag filter)
│   ├── localProvider.ts              # 3-level tree: Collection → Category → Item
│   ├── installedProvider.ts          # 2-level tree: Category → Item (+ update badges)
│   └── resourceDetailPanel.ts        # Webview detail panel (+ update button)
├── extension.ts                     # Entry point, commands, status bar, update checker
└── test/
    ├── types.test.ts
    ├── pathService.test.ts
    ├── resourceClient.test.ts
    ├── marketplaceProvider.test.ts
    └── installedProvider.test.ts
```

### Key design decisions

* **Two repository modes**: "Full repos" scan well-known category folders via the Contents API. "Skills repos" (with `skillsPath`) use the Git Trees API for efficient recursive scanning.
* **Local Collections**: Configured local folders on disk are scanned for the same category structure, enabling offline browsing and management of resources without GitHub. Missing collection folders are detected on startup and shown with a warning indicator; folders are watched via Node.js `fs.watch` for automatic refresh when contents change, with a periodic 30-second existence check as a fallback.
* **Per-category install locations**: Each of the five categories has its own configurable local and global path. Local paths default to `.agents/<category>/` (workspace-relative); global paths default to `~/.agents/<category>/` (home directory). Paths starting with `~/` resolve to the user's home directory.
* **Global & workspace scopes**: Resources can be installed to the workspace or globally (home directory). Installed items display their scope and can be moved between scopes via inline actions.
* **Copy to local collection**: Installed resources can be copied into any configured local collection, placing them in the correct `<collection>/<category>/<name>` structure.
* **GitHub auth cascade**: Tries `aiSkillsManager.githubToken` first, then falls back to VS Code's built-in GitHub authentication (`vscode.authentication`).
* **Install strategy**: Skills (folders) are fetched file-by-file and written to disk. Other resources are single-file downloads. Local collection installs use filesystem copy.
* **Caching**: All API responses are cached in memory with a configurable TTL (`cacheTimeout`, default 1 hour).
* **Update detection**: Install metadata (SHA hash, source repository info, and content hash) is persisted alongside each installed resource in a `.ai-skills-meta.json` file. The extension compares local SHAs against upstream SHAs from GitHub to detect available updates.
* **Modification detection**: At install time, a SHA-256 content hash is stored in `.ai-skills-meta.json`. File system watchers trigger a debounced re-check when installed files change on disk, comparing current hashes against stored hashes to detect local modifications. Modified resources show an indicator in the tree and enable the revert/propose actions.
* **Favorites**: Stored in VS Code's `globalState` (key `aiSkillsManager.favorites`) as an array of `"owner/repo:category:name"` identifiers. Favorites persist across sessions and workspaces.
* **Tag extraction**: Tags are parsed from the `tags` field in resource frontmatter (supports both comma-separated strings and YAML arrays). The tag index is built lazily from loaded marketplace data.
* **Resource scaffolding**: Each category has a built-in template function that generates properly structured content with frontmatter. Skills create a folder with `SKILL.md`; all other categories create a single file.
* **Resource packs**: A JSON manifest format (`{ name, description, resources[] }`) captures the source repository, category, and name of each resource. Pack installation resolves each entry against the marketplace and installs them sequentially.
* **Validation**: Health checks iterate over all installed resources across all scopes, reading files from disk to verify existence, non-empty content, parseable YAML frontmatter (for `.md` files), and `SKILL.md` presence (for skill folders).
* **Configuration export/import**: Exports capture a snapshot of all relevant settings. Import supports merge (additive, skips duplicates) and replace (full overwrite) strategies.
* **Usage detection**: Scans well-known workspace files (e.g. `copilot-instructions.md`, `settings.json`, `mcp.json`, `AGENTS.md`, `CLAUDE.md`) for string matches of installed resource names.
* **Propose changes**: Installed resources with source repo metadata can push local modifications back to the upstream repository. Creates a branch, commits file(s) via the GitHub REST API (Contents API for single files, Git Data API for multi-file skills), and opens a pull request. Requires `repo` scope authentication. Targets direct collaborators only.
* **Revert to repository**: Modified resources can be reverted to their original upstream content. The extension fetches the content from the source repository and overwrites the local copy, updating the stored content hash.
* **Status bar**: Shows installed count and update count; clicking opens a quick-pick menu with shortcuts to common actions.

## License

MIT
