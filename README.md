# AI Skills Manager for VS Code

A VS Code extension for discovering, installing, and managing **AI development resources** from multiple GitHub repositories — with full control over where resources are installed.

A one-stop-shop for **Chat Modes**, **Instructions**, **Prompts**, **Agents**, and **Skills**.

## Features

- **Resource Marketplace** — Browse Chat Modes, Instructions, Prompts, Agents, and Skills from multiple GitHub repositories
- **Search** — Quickly find resources by name or keyword
- **One-Click Install** — Download single files or install skill folders directly into your workspace
- **Installed Resources** — View and manage all resources installed in your workspace, grouped by category
- **Rich Preview** — Preview resource content with markdown rendering before installing
- **Repository Management** — Enable/disable repos, add your own custom repos, all from a quick-pick UI
- **Per-Category Install Locations** — Each category installs to its own configurable folder (default: `.agents/<category>/`)
- **GitHub Auth** — Supports personal access tokens and VS Code's built-in GitHub authentication for higher API rate limits

## Quick Start

### Browse Resources

1. Open the **AI Skills Manager** panel in the Activity Bar
2. The **Marketplace** tab shows resources grouped by repository, then by category
3. Expand a repository to see its categories (Chat Modes, Instructions, Prompts, Agents, Skills)
4. Expand a category to see individual resources

### Search Resources

1. Click the **Search** icon (🔍) in the Marketplace title bar
2. Enter a name or keyword
3. Click the **Clear Search** icon (✕) to return to the full list

### Install a Resource

1. Find the resource in the Marketplace
2. Click the **Download** button (⬇️) for files, or **Install** for skill folders
3. The resource will be saved to the configured install location for that category

### Preview Resources

Click any resource in the marketplace tree to preview its contents in a detail panel with:

- Full content / documentation with markdown rendering
- Category badge, license, and compatibility info
- Installation status
- Install / Remove buttons
- View Source button to see the resource on GitHub

### Manage Installed Resources

1. Click the **Installed** tab to see resources grouped by category
2. For each installed resource you can:
   - **Remove** — click the trash icon
   - **Open** — click the folder icon to open the file or folder

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

Each category has its own install location setting, all defaulting to `.agents/<category>/`:

| Setting | Default | Description |
|---|---|---|
| `aiSkillsManager.installLocation.chatmodes` | `.agents/chatmodes` | Where to install Chat Modes |
| `aiSkillsManager.installLocation.instructions` | `.agents/instructions` | Where to install Instructions |
| `aiSkillsManager.installLocation.prompts` | `.agents/prompts` | Where to install Prompts |
| `aiSkillsManager.installLocation.agents` | `.agents/agents` | Where to install Agents |
| `aiSkillsManager.installLocation.skills` | `.agents/skills` | Where to install Skills |

All paths are relative to the workspace root. Use `~/` prefix for home directory paths (e.g. `~/.copilot/skills`).

### Repositories

**Setting:** `aiSkillsManager.repositories`

Two types of repositories are supported:

1. **Full repos** — scan all category folders (chatmodes, instructions, prompts, agents, skills)
2. **Skills repos** — specify a `skillsPath` to only scan for skills at that path

Default repositories:

| Repository | Type | Description |
|---|---|---|
| `github/awesome-copilot` | Full | GitHub Copilot community resources |
| `anthropics/skills` | Skills | Official Anthropic skills |
| `pytorch/pytorch` | Skills | PyTorch agent skills |
| `formulahendry/agent-skill-code-runner` | Skills (single) | Code runner skill |

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

### GitHub Token

**Setting:** `aiSkillsManager.githubToken`

Provide a [personal access token](https://github.com/settings/tokens) with `public_repo` scope for higher API rate limits. Alternatively, the extension will use VS Code's built-in GitHub authentication if available.

### Cache Timeout

**Setting:** `aiSkillsManager.cacheTimeout`

How long (in seconds) to cache resource metadata. Default: `3600` (1 hour).

## Commands

Available via Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---|---|
| AI Skills Manager: Search Resources | Open search dialog |
| AI Skills Manager: Clear Search | Clear search and show all resources |
| AI Skills Manager: Refresh | Refresh marketplace and installed data |
| AI Skills Manager: Install / Download | Install or download selected resource |
| AI Skills Manager: Remove | Remove selected installed resource |
| AI Skills Manager: Preview Resource | Preview resource content |
| AI Skills Manager: View Details | Open resource detail panel |
| AI Skills Manager: Open Resource | Open installed resource file/folder |
| AI Skills Manager: Manage Repositories | Toggle/add/remove repos |

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
| `types.test.ts` | `types.ts` | `ResourceCategory` enum, `ALL_CATEGORIES`, `CATEGORY_LABELS`, `CATEGORY_ICONS`, `DEFAULT_INSTALL_PATHS` |
| `pathService.test.ts` | `services/pathService.ts` | `isHomeLocation`, `requiresWorkspaceFolder`, `getInstallLocation`, `getScanLocations`, `resolveLocationToUri`, `resolveInstallTarget` |
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
│   └── installationService.ts       # Install / uninstall / open resources
├── views/
│   ├── marketplaceProvider.ts        # 3-level tree: Repo → Category → Item
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
- **Per-category install locations**: Each of the five categories has its own configurable path, defaulting to `.agents/<category>/`. Paths starting with `~/` resolve to the user's home directory.
- **GitHub auth cascade**: Tries `aiSkillsManager.githubToken` first, then falls back to VS Code's built-in GitHub authentication (`vscode.authentication`).
- **Install strategy**: Skills (folders) are fetched file-by-file and written to disk. Other resources are single-file downloads.
- **Caching**: All API responses are cached in memory with a configurable TTL (`cacheTimeout`, default 1 hour).

## License

MIT
