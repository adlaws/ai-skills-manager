# AI Skills Manager — Developer Guide

This document covers everything you need to build, test, debug, and package the extension locally.

## Prerequisites

- [Node.js](https://nodejs.org/) 22.x (LTS) or later
- [VS Code](https://code.visualstudio.com/) 1.107.0 or later
- Git

## Getting Started

```bash
# Clone the repo
git clone https://github.com/adlaws/ai-skills-manager.git
cd ai-skills-manager

# Install dependencies
npm install
```

## Project Structure

```
ai-skills-manager/
├── .github/
│   └── copilot-instructions.md      # Workspace instructions for AI assistants
├── .vscode/
│   ├── launch.json                   # F5 launch config (Extension Dev Host)
│   └── tasks.json                    # Default build task (npm run watch)
├── .vscode-test.mjs                  # Test runner configuration
├── .vscodeignore                     # Files excluded from the packaged VSIX
├── esbuild.js                        # esbuild bundler config
├── eslint.config.mjs                 # ESLint v9 flat config
├── LICENSE                           # MIT license
├── package.json                      # Extension manifest + npm scripts
├── tsconfig.json                     # TypeScript compiler config
├── resources/
│   ├── logo.png                      # Extension marketplace icon (128×128)
│   └── skills-icon.svg               # Activity Bar icon
├── dist/                             # Bundled output (esbuild) — runtime entry point
│   └── extension.js
├── out/                              # TypeScript compiler output (for tests)
│   └── test/
│       └── *.test.js
└── src/
    ├── extension.ts                  # Entry point — activates commands, views, watchers
    ├── types.ts                      # Shared types, enums, constants
    ├── github/
    │   └── resourceClient.ts         # GitHub API client (Contents + Trees APIs)
    ├── services/
    │   ├── pathService.ts            # Install / scan location resolution
    │   └── installationService.ts    # Install, uninstall, open resources
    ├── views/
    │   ├── marketplaceProvider.ts     # Marketplace tree (Repo → Category → Item)
    │   ├── installedProvider.ts       # Installed tree (Category → Item)
    │   └── resourceDetailPanel.ts     # Webview detail panel (markdown preview)
    └── test/
        ├── types.test.ts             # Constants & enum coverage
        ├── pathService.test.ts        # PathService unit tests
        ├── resourceClient.test.ts     # ResourceClient + SKILL.md parsing tests
        ├── marketplaceProvider.test.ts # Marketplace tree item + provider tests
        └── installedProvider.test.ts   # Installed tree item + provider tests
```

### Key source modules

| Module | Responsibility |
|---|---|
| `types.ts` | `ResourceCategory` enum (5 categories), label/icon/default-path lookup maps, `DEFAULT_GLOBAL_INSTALL_PATHS`, `InstallScope` type, all shared interfaces (`ResourceItem`, `InstalledResource`, `ResourceRepository`, etc.) |
| `github/resourceClient.ts` | Fetches resources from GitHub. **Full repos** use the Contents API to list category folders. **Skills repos** (`skillsPath` set) use the Git Trees API for recursive scanning. Raw content is fetched from `raw.githubusercontent.com`. All responses are cached in memory with a configurable TTL. |
| `services/pathService.ts` | Resolves per-category install and scan locations, for both local (workspace) and global (home directory) scopes. Paths starting with `~/` resolve to the home directory; all others resolve relative to the first workspace folder. |
| `services/installationService.ts` | Handles the download-and-write flow. Skills (folders) are fetched file-by-file and written recursively. Other resources are single-file downloads. Supports local and global install scopes, moving resources between scopes, overwrite prompts, and cancellation. |
| `views/marketplaceProvider.ts` | Three-level `TreeDataProvider` (Repo → Category → Resource). Supports search filtering and tracks which items are already installed. |
| `views/installedProvider.ts` | Two-level `TreeDataProvider` (Category → Installed Resource). Scans configured + well-known directories on disk (both local and global). Skills are recognised by the presence of `SKILL.md`. Each item shows its scope (Global/Local) and uses scope-specific context values for menu control. |
| `views/resourceDetailPanel.ts` | Webview panel that renders resource details with `markdown-it`. Shows metadata, install/remove buttons, and a "View Source" link. |
| `extension.ts` | Wires everything together — creates service instances, registers commands, sets up file watchers, and subscribes to configuration changes. |

### Build outputs

| Directory | Purpose | Used by |
|---|---|---|
| `dist/` | Production bundle (single `extension.js` file produced by esbuild) | VS Code Extension Host at runtime |
| `out/` | Full TypeScript compiler output (one `.js` per `.ts` source file) | Test runner (`@vscode/test-cli`) |

The distinction matters: the extension itself loads from `dist/extension.js` (see `"main"` in `package.json`), while tests load from `out/test/*.test.js` (see `.vscode-test.mjs`).

## Building

### One-off build

```bash
npm run compile
```

This runs, in order: type checking (`tsc --noEmit`), linting (`eslint src`), and bundling (`node esbuild.js`). The result is `dist/extension.js`.

### Watch mode (recommended during development)

```bash
npm run watch
```

This starts two parallel watchers:
- **esbuild** — incrementally re-bundles `dist/extension.js` on every source change
- **tsc** — runs the TypeScript compiler in watch mode (type-check only, no emit) so you get real-time error feedback

When you press **F5** in VS Code, the default build task (`npm run watch`) is started automatically before the Extension Development Host launches (configured in `.vscode/tasks.json`).

### Type checking only

```bash
npm run check-types
```

Runs `tsc --noEmit` — useful for a quick check without bundling or linting.

### Linting

```bash
npm run lint
```

Runs ESLint against `src/`.

## Running & Debugging the Extension

### Option 1: F5 (recommended)

1. Open the project in VS Code
2. Press **F5** (or **Run → Start Debugging**)
3. A new VS Code window opens — the **Extension Development Host**
4. The AI Skills Manager icon should appear in the Activity Bar
5. Set breakpoints in any file under `src/`; the debugger will hit them

This uses the launch configuration in `.vscode/launch.json`, which:
- Starts the Extension Development Host at `--extensionDevelopmentPath=${workspaceFolder}`
- Maps source files via the `dist/**/*.js` source maps
- Runs the default build task (`npm run watch`) first, so the bundle is always fresh

### Option 2: Manual

```bash
# Build once
npm run compile

# Then launch VS Code with the extension loaded
code --extensionDevelopmentPath="$(pwd)"
```

### Reload during development

While the Extension Development Host is running:
- **Ctrl+Shift+P** → "Developer: Reload Window" picks up the latest bundle without restarting the debug session (as long as `npm run watch` is running)

## Testing

Tests run inside a real VS Code Extension Host process via `@vscode/test-cli` + `@vscode/test-electron`, so all `vscode` APIs are available — no mocking required.

### Run all tests

```bash
npm test
```

This triggers the `pretest` script first, which:
1. Compiles tests to `out/` (`tsc -p . --outDir out`)
2. Builds the extension (`npm run compile`)
3. Lints (`eslint src`)

Then `vscode-test` downloads a matching VS Code version (if not already cached in `.vscode-test/`), launches it, and executes the Mocha test suite.

### Run tests only (skip lint + full compile)

```bash
npm run compile-tests && npx vscode-test
```

### Watch tests

```bash
npm run watch-tests
```

Recompiles `out/` on every source change. You still need to re-run `npx vscode-test` manually to execute them, but compilation errors will show immediately.

### Test configuration

The test runner is configured in `.vscode-test.mjs`:

```js
export default defineConfig({
    files: 'out/test/**/*.test.js',
    mocha: {
        timeout: 20000,
        ui: 'tdd',        // suite() / test() syntax
    },
});
```

### Writing new tests

1. Create a new file in `src/test/` named `<module>.test.ts`
2. Use the `tdd` Mocha UI:
   ```ts
   import * as assert from 'assert';
   import * as vscode from 'vscode';

   suite('MyModule', () => {
       test('does something', () => {
           assert.strictEqual(1 + 1, 2);
       });
   });
   ```
3. Run `npm test` to verify

### Current test coverage

| Test file | Module under test | What's covered |
|---|---|---|
| `types.test.ts` | `types.ts` | Enum values, `ALL_CATEGORIES`, label/icon/path maps, `DEFAULT_GLOBAL_INSTALL_PATHS` |
| `pathService.test.ts` | `services/pathService.ts` | Home vs. workspace paths, scan locations (including global), install target resolution for both scopes, `getScopeForLocation` |
| `resourceClient.test.ts` | `github/resourceClient.ts` | SKILL.md parsing (valid / missing / Windows CRLF), repo key, item creation, cache lifecycle |
| `marketplaceProvider.test.ts` | `views/marketplaceProvider.ts` | Tree item properties (labels, icons, context values), search API, event firing |
| `installedProvider.test.ts` | `views/installedProvider.ts` | Tree item properties (including scope badges and scope-specific contextValues), `getInstalledNames`, `isInstalled`, `getChildren` dispatch |

## Packaging & Distribution

### Create a VSIX package

```bash
npx @vscode/vsce package
```

This will:
1. Run the `vscode:prepublish` script (`npm run package`), which type-checks, lints, and produces a minified production bundle
2. Package everything (respecting `.vscodeignore`) into a `.vsix` file, e.g. `ai-skills-manager-0.1.0.vsix`

> **Note:** The marketplace icon at `resources/logo.png` must be a valid PNG (at least 128×128). If you need to regenerate it, replace the file before packaging.

### Install a VSIX locally

From the command line:

```bash
code --install-extension ai-skills-manager-0.1.0.vsix
```

Or within VS Code:
1. **Ctrl+Shift+P** → "Extensions: Install from VSIX…"
2. Select the `.vsix` file
3. Reload the window when prompted

To uninstall later:

```bash
code --uninstall-extension adlaws.ai-skills-manager
```

### Safe / isolated installation

If you want to test the extension without touching your main VS Code setup at all, launch VS Code with a **throwaway data directory**. This gives you a completely separate instance — its own extensions, settings, and state — that you can delete to revert to a clean slate instantly.

```bash
# Create a temporary sandbox directory
mkdir -p /tmp/vscode-sandbox

# Launch VS Code with an isolated profile
code \
  --user-data-dir /tmp/vscode-sandbox/data \
  --extensions-dir /tmp/vscode-sandbox/extensions \
  --install-extension ai-skills-manager-0.1.0.vsix
```

This opens a fresh VS Code window with:
- **No other extensions** loaded (clean `--extensions-dir`)
- **No existing settings, keybindings, or state** (clean `--user-data-dir`)
- Only the AI Skills Manager extension installed

To revert completely — remove every trace as if nothing happened:

```bash
rm -rf /tmp/vscode-sandbox
```

Your normal VS Code installation is completely untouched throughout this process.

> **Tip:** You can use any path, not just `/tmp/`. Use a persistent path like `~/vscode-sandboxes/ai-skills-test` if you want the sandbox to survive a reboot.

#### Alternative: VS Code Profiles

If you'd prefer to stay inside your regular VS Code window, you can use **Profiles** instead:

1. **Ctrl+Shift+P** → "Profiles: Create Profile…"
2. Name it something like "Extension Testing"
3. Uncheck "Extensions" to start with a clean extension set
4. Click **Create**
5. Install the VSIX in this profile
6. When done, switch back to your default profile and delete the test profile

This is less isolated (shares the same VS Code binary and some global state) but more convenient for quick tests.

### Share with others

Send the `.vsix` file to colleagues. They can install it using either method above.

### Publish to the VS Code Marketplace

> This requires a [Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token) and a publisher account.

```bash
# Login (first time only)
npx @vscode/vsce login USERNAME_HERE

# Publish
npx @vscode/vsce publish
```

Or publish a specific version:

```bash
npx @vscode/vsce publish 0.2.0
```

See the [VS Code publishing docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for full details.

### What goes into the VSIX

The `.vscodeignore` file controls what is excluded. Currently excluded:

- Source files (`src/`, `out/`, `*.ts`, `*.map`)
- Dev config (`.vscode/`, `.vscode-test/`, `.vscode-test.mjs`, `tsconfig.json`, `esbuild.js`, `eslint.config.mjs`)
- Dev docs (`DEVELOPMENT.md`, `.github/`)
- Dependencies (`node_modules/`)
- Lock file (`package-lock.json`)

The VSIX will contain:
- `dist/extension.js` — the bundled extension (all dependencies inlined by esbuild)
- `package.json` — the extension manifest
- `resources/` — icons (`logo.png`, `skills-icon.svg`)
- `README.md`
- `LICENSE`

## Configuration Reference (for development)

These settings affect the extension at runtime. During development in the Extension Development Host, you can set them in the host window's settings.

| Setting | Type | Default | Description |
|---|---|---|---|
| `aiSkillsManager.repositories` | array | *(4 default repos)* | GitHub repositories to browse |
| `aiSkillsManager.installLocation.chatmodes` | string | `.agents/chatmodes` | Local Chat Modes install path |
| `aiSkillsManager.installLocation.instructions` | string | `.agents/instructions` | Local Instructions install path |
| `aiSkillsManager.installLocation.prompts` | string | `.agents/prompts` | Local Prompts install path |
| `aiSkillsManager.installLocation.agents` | string | `.agents/agents` | Local Agents install path |
| `aiSkillsManager.installLocation.skills` | string | `.agents/skills` | Local Skills install path |
| `aiSkillsManager.globalInstallLocation.chatmodes` | string | `~/.agents/chatmodes` | Global Chat Modes install path |
| `aiSkillsManager.globalInstallLocation.instructions` | string | `~/.agents/instructions` | Global Instructions install path |
| `aiSkillsManager.globalInstallLocation.prompts` | string | `~/.agents/prompts` | Global Prompts install path |
| `aiSkillsManager.globalInstallLocation.agents` | string | `~/.agents/agents` | Global Agents install path |
| `aiSkillsManager.globalInstallLocation.skills` | string | `~/.agents/skills` | Global Skills install path |
| `aiSkillsManager.githubToken` | string | `""` | GitHub PAT for higher rate limits |
| `aiSkillsManager.cacheTimeout` | number | `3600` | Cache TTL in seconds |

## Troubleshooting

### "rate limit exceeded" errors

The GitHub API allows 60 requests/hour unauthenticated. To increase this:
- Set `aiSkillsManager.githubToken` to a [personal access token](https://github.com/settings/tokens) with `public_repo` scope, **or**
- Sign in to GitHub via VS Code's built-in authentication (the extension picks it up automatically)

### Extension doesn't appear in the Activity Bar

- Make sure the build succeeded (`npm run compile` with no errors)
- Check the Extension Development Host's **Output** panel → "AI Skills Manager" channel for errors
- Verify `dist/extension.js` exists

### Tests fail to start

- Ensure `out/test/*.test.js` files exist — run `npm run compile-tests`
- If VS Code download fails, check your network and delete `.vscode-test/` to force a fresh download
- The test runner requires a display. On headless Linux, use `xvfb-run npm test`
