<!-- Workspace instructions for AI Skills Manager VS Code extension -->

- This is a VS Code extension project written in TypeScript, bundled with esbuild.
- The extension is a one-stop-shop for discovering, installing, and managing AI development resources: Chat Modes, Instructions, Prompts, Agents, and Skills.
- Resources are categorised by `ResourceCategory` enum: `chatmodes`, `instructions`, `prompts`, `agents`, `skills`.
- Two repository modes: "Full repo" (scans category folders) and "Skills repo" (uses `skillsPath` for Git Trees API).
- Key architecture: Activity Bar view container with two tree views (Marketplace, Installed), plus detail webview panels.
- Marketplace tree: Repo → Category → Resource items (three levels).
- Installed tree: Category → Installed resources (two levels).
- Source files are under `src/`, with sub-folders `github/`, `services/`, and `views/`.
- Key files: `types.ts`, `github/resourceClient.ts`, `services/pathService.ts`, `services/installationService.ts`, `views/marketplaceProvider.ts`, `views/installedProvider.ts`, `views/resourceDetailPanel.ts`, `extension.ts`.
- Run `npm run watch` for development, press F5 to launch Extension Development Host.
- Configuration prefix is `aiSkillsManager.*` (not `agentSkills.*`).
- Each resource category has its own install location setting (`aiSkillsManager.installLocation.<category>`), all defaulting to `.agents/<category>/`.
- Install location settings are free-form strings, not enums. Paths starting with `~/` resolve to home directory.
- Repositories use `aiSkillsManager.repositories` (not `skillRepositories`) and have an `enabled` boolean flag for toggling.
