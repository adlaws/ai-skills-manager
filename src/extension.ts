/**
 * AI Skills Manager – VS Code Extension entry point.
 *
 * One-stop-shop for discovering, installing, and managing AI development
 * resources: Chat Modes, Instructions, Prompts, Agents, and Skills.
 */

import * as vscode from 'vscode';
import { ResourceClient } from './github/resourceClient';
import {
    MarketplaceTreeDataProvider,
    ResourceTreeItem,
} from './views/marketplaceProvider';
import {
    InstalledTreeDataProvider,
    InstalledResourceTreeItem,
} from './views/installedProvider';
import { ResourceDetailPanel } from './views/resourceDetailPanel';
import { InstallationService } from './services/installationService';
import { PathService } from './services/pathService';
import { ResourceItem, InstalledResource, ResourceRepository, ResourceCategory } from './types';

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Build a synthetic `ResourceItem` from an installed resource by reading
 * its content from disk. This allows the detail panel to show documentation
 * for locally-installed resources that aren't (or are no longer) in the
 * marketplace data.
 */
async function buildResourceItemFromInstalled(
    resource: InstalledResource,
    pathService: PathService,
): Promise<ResourceItem | undefined> {
    const wf = pathService.getWorkspaceFolderForLocation(resource.location);
    const uri = pathService.resolveLocationToUri(resource.location, wf);
    if (!uri) {
        return undefined;
    }

    const isSkill = resource.category === ResourceCategory.Skills;

    // Placeholder repo — the detail panel will detect missing owner/repo
    // and adapt accordingly (hide "View Source", show local path).
    const localRepo: ResourceRepository = {
        owner: '',
        repo: '',
        branch: '',
        enabled: true,
    };

    let content: string | undefined;
    let bodyContent: string | undefined;
    let fullContent: string | undefined;
    let description = resource.description;
    let license: string | undefined;
    let compatibility: string | undefined;

    try {
        if (isSkill) {
            const skillMd = vscode.Uri.joinPath(uri, 'SKILL.md');
            const raw = new TextDecoder().decode(
                await vscode.workspace.fs.readFile(skillMd),
            );
            fullContent = raw;
            const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
            if (fmMatch) {
                const yaml = fmMatch[1];
                bodyContent = fmMatch[2];
                const descMatch = yaml.match(/^description:\s*(.+)$/m);
                const licenseMatch = yaml.match(/^license:\s*(.+)$/m);
                const compatMatch = yaml.match(/^compatibility:\s*(.+)$/m);
                if (descMatch) { description = descMatch[1].trim(); }
                if (licenseMatch) { license = licenseMatch[1].trim(); }
                if (compatMatch) { compatibility = compatMatch[1].trim(); }
            } else {
                bodyContent = raw;
            }
        } else {
            content = new TextDecoder().decode(
                await vscode.workspace.fs.readFile(uri),
            );
        }
    } catch {
        // File unreadable — still create a bare item so panel can render
    }

    return {
        id: `local:${resource.category}/${resource.name}`,
        name: resource.name,
        category: resource.category,
        file: {
            name: resource.name,
            path: resource.location,
            download_url: '',
            size: 0,
            type: isSkill ? 'dir' : 'file',
        },
        repo: localRepo,
        content,
        description,
        license,
        compatibility,
        bodyContent,
        fullContent,
    };
}

export function activate(context: vscode.ExtensionContext) {
    console.log('AI Skills Manager extension is now active!');

    // ── Services ────────────────────────────────────────────────
    const resourceClient = new ResourceClient(context);
    const pathService = new PathService();
    const installationService = new InstallationService(
        resourceClient,
        context,
        pathService,
    );

    // ── View providers ──────────────────────────────────────────
    const marketplaceProvider = new MarketplaceTreeDataProvider(
        resourceClient,
        context,
    );
    const installedProvider = new InstalledTreeDataProvider(
        context,
        pathService,
    );

    // ── Tree views ──────────────────────────────────────────────
    const marketplaceTreeView = vscode.window.createTreeView(
        'aiSkillsManager.marketplace',
        {
            treeDataProvider: marketplaceProvider,
            showCollapseAll: true,
        },
    );

    const installedTreeView = vscode.window.createTreeView(
        'aiSkillsManager.installed',
        {
            treeDataProvider: installedProvider,
        },
    );

    // ── Helpers ─────────────────────────────────────────────────

    const syncInstalledStatus = async () => {
        await installedProvider.refresh();
        marketplaceProvider.setInstalledNames(
            installedProvider.getInstalledNames(),
        );
    };

    // ── Commands ────────────────────────────────────────────────

    const commands = [
        // Search
        vscode.commands.registerCommand(
            'aiSkillsManager.search',
            async () => {
                const query = await vscode.window.showInputBox({
                    prompt: 'Search resources',
                    placeHolder: 'Enter name or keyword…',
                });
                if (query !== undefined) {
                    marketplaceProvider.setSearchQuery(query);
                }
            },
        ),

        // Clear search
        vscode.commands.registerCommand('aiSkillsManager.clearSearch', () => {
            marketplaceProvider.clearSearch();
        }),

        // Refresh
        vscode.commands.registerCommand(
            'aiSkillsManager.refresh',
            async () => {
                await Promise.all([
                    marketplaceProvider.refresh(),
                    installedProvider.refresh(),
                ]);
                await syncInstalledStatus();
            },
        ),

        // Preview – fetch content and show in webview
        vscode.commands.registerCommand(
            'aiSkillsManager.preview',
            async (treeItemOrItem: ResourceTreeItem | ResourceItem) => {
                const item =
                    treeItemOrItem instanceof ResourceTreeItem
                        ? treeItemOrItem.resource
                        : treeItemOrItem;

                if (!item) {
                    return;
                }

                // Fetch content if not already loaded
                if (!item.content && !item.fullContent) {
                    try {
                        if (
                            item.category === ResourceCategory.Skills &&
                            item.file.type === 'dir'
                        ) {
                            // For skills, fetch SKILL.md
                            const content =
                                await resourceClient.fetchRawContent(
                                    item.repo.owner,
                                    item.repo.repo,
                                    `${item.file.path}/SKILL.md`,
                                    item.repo.branch,
                                );
                            item.fullContent = content;
                            const bodyMatch = content.match(
                                /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/,
                            );
                            item.bodyContent = bodyMatch
                                ? bodyMatch[1]
                                : content;
                        } else {
                            // For files, fetch content
                            item.content =
                                await resourceClient.fetchFileContent(
                                    item.file.download_url,
                                );
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `Failed to fetch content: ${error}`,
                        );
                        return;
                    }
                }

                ResourceDetailPanel.createOrShow(
                    item,
                    context.extensionUri,
                    installedProvider,
                );
            },
        ),

        // View details (alias for preview)
        vscode.commands.registerCommand(
            'aiSkillsManager.viewDetails',
            async (
                treeItemOrItem:
                    | ResourceTreeItem
                    | InstalledResourceTreeItem
                    | ResourceItem
                    | unknown,
            ) => {
                if (!treeItemOrItem) {
                    vscode.window.showErrorMessage('No resource selected.');
                    return;
                }

                let item: ResourceItem | undefined;

                if (treeItemOrItem instanceof ResourceTreeItem) {
                    item = treeItemOrItem.resource;
                } else if (
                    treeItemOrItem instanceof InstalledResourceTreeItem
                ) {
                    // Try marketplace first for richer metadata
                    item = marketplaceProvider.getItemByName(
                        treeItemOrItem.resource.name,
                    );
                    // Fall back to reading local content from disk
                    if (!item) {
                        item = await buildResourceItemFromInstalled(
                            treeItemOrItem.resource,
                            pathService,
                        );
                    }
                } else {
                    const data = treeItemOrItem as ResourceItem;
                    if (data.repo) {
                        item = data;
                    }
                }

                if (item) {
                    await vscode.commands.executeCommand(
                        'aiSkillsManager.preview',
                        item,
                    );
                }
            },
        ),

        // Install / download (local)
        vscode.commands.registerCommand(
            'aiSkillsManager.install',
            async (treeItemOrItem: ResourceTreeItem | ResourceItem) => {
                const item =
                    treeItemOrItem instanceof ResourceTreeItem
                        ? treeItemOrItem.resource
                        : treeItemOrItem;

                if (item) {
                    const success =
                        await installationService.installResource(item, 'local');
                    if (success) {
                        await syncInstalledStatus();
                    }
                }
            },
        ),

        // Install globally
        vscode.commands.registerCommand(
            'aiSkillsManager.installGlobally',
            async (treeItemOrItem: ResourceTreeItem | ResourceItem) => {
                const item =
                    treeItemOrItem instanceof ResourceTreeItem
                        ? treeItemOrItem.resource
                        : treeItemOrItem;

                if (item) {
                    const success =
                        await installationService.installResource(item, 'global');
                    if (success) {
                        await syncInstalledStatus();
                    }
                }
            },
        ),

        // Move installed resource to global
        vscode.commands.registerCommand(
            'aiSkillsManager.moveToGlobal',
            async (
                treeItemOrResource: InstalledResourceTreeItem | InstalledResource,
            ) => {
                const resource =
                    treeItemOrResource instanceof InstalledResourceTreeItem
                        ? treeItemOrResource.resource
                        : treeItemOrResource;

                if (resource) {
                    const success =
                        await installationService.moveResource(resource, 'global');
                    if (success) {
                        await syncInstalledStatus();
                    }
                }
            },
        ),

        // Move installed resource to local
        vscode.commands.registerCommand(
            'aiSkillsManager.moveToLocal',
            async (
                treeItemOrResource: InstalledResourceTreeItem | InstalledResource,
            ) => {
                const resource =
                    treeItemOrResource instanceof InstalledResourceTreeItem
                        ? treeItemOrResource.resource
                        : treeItemOrResource;

                if (resource) {
                    const success =
                        await installationService.moveResource(resource, 'local');
                    if (success) {
                        await syncInstalledStatus();
                    }
                }
            },
        ),

        // Uninstall / remove
        vscode.commands.registerCommand(
            'aiSkillsManager.uninstall',
            async (
                treeItemOrItem:
                    | InstalledResourceTreeItem
                    | InstalledResource
                    | ResourceItem,
            ) => {
                let installed: InstalledResource | undefined;

                if (treeItemOrItem instanceof InstalledResourceTreeItem) {
                    installed = treeItemOrItem.resource;
                } else if ('location' in treeItemOrItem) {
                    installed = treeItemOrItem as InstalledResource;
                } else {
                    const item = treeItemOrItem as ResourceItem;
                    installed = installedProvider
                        .getInstalledResources()
                        .find((r) => r.name === item.name);
                }

                if (installed) {
                    const success =
                        await installationService.uninstallResource(installed);
                    if (success) {
                        await syncInstalledStatus();
                    }
                }
            },
        ),

        // Open installed resource
        vscode.commands.registerCommand(
            'aiSkillsManager.openResource',
            async (item: InstalledResourceTreeItem) => {
                if (item?.resource) {
                    await installationService.openResource(item.resource);
                }
            },
        ),

        // Focus marketplace (used in welcome content)
        vscode.commands.registerCommand(
            'aiSkillsManager.focusMarketplace',
            () => {
                marketplaceTreeView.reveal(
                    undefined as unknown as ResourceTreeItem,
                    { focus: true },
                );
            },
        ),

        // Manage repositories – quick-pick to toggle, add, or remove
        vscode.commands.registerCommand(
            'aiSkillsManager.manageRepositories',
            async () => {
                const config =
                    vscode.workspace.getConfiguration('aiSkillsManager');
                const repos = config.get<ResourceRepository[]>(
                    'repositories',
                    [],
                );

                const pick = await vscode.window.showQuickPick(
                    [
                        {
                            label: '$(add) Add new repository…',
                            id: '__add__',
                        },
                        ...repos.map((r, i) => ({
                            label: r.label || `${r.owner}/${r.repo}`,
                            description: r.skillsPath
                                ? `Skills: ${r.skillsPath}`
                                : 'All categories',
                            detail:
                                r.enabled !== false
                                    ? '$(check) Enabled'
                                    : '$(circle-slash) Disabled',
                            id: String(i),
                        })),
                    ],
                    {
                        placeHolder:
                            'Select a repository to toggle or add a new one',
                        title: 'Manage Repositories',
                    },
                );

                if (!pick) {
                    return;
                }

                if (pick.id === '__add__') {
                    const format = await vscode.window.showQuickPick(
                        [
                            {
                                label: 'Full Repository',
                                description:
                                    'Scans for chatmodes, instructions, prompts, agents, skills',
                                id: 'full',
                            },
                            {
                                label: 'Skills Repository',
                                description:
                                    'Points to a specific skills directory',
                                id: 'skills',
                            },
                        ],
                        { placeHolder: 'What type of repository?' },
                    );

                    if (!format) {
                        return;
                    }

                    if (format.id === 'full') {
                        const input = await vscode.window.showInputBox({
                            prompt: 'Enter repository as owner/repo',
                            placeHolder: 'e.g. github/awesome-copilot',
                            validateInput: (v) => {
                                const parts = v.trim().split('/');
                                return parts.length >= 2
                                    ? null
                                    : 'Format: owner/repo';
                            },
                        });

                        if (input) {
                            const [owner, repo] = input.trim().split('/');
                            repos.push({
                                owner,
                                repo,
                                branch: 'main',
                                enabled: true,
                            });
                            await config.update(
                                'repositories',
                                repos,
                                vscode.ConfigurationTarget.Global,
                            );
                            vscode.window.showInformationMessage(
                                `Added ${owner}/${repo} and refreshing…`,
                            );
                            marketplaceProvider.refresh();
                        }
                    } else {
                        const input = await vscode.window.showInputBox({
                            prompt: 'Enter repository as owner/repo/path-to-skills',
                            placeHolder: 'e.g. my-org/my-repo/skills',
                            validateInput: (v) => {
                                const parts = v.trim().split('/');
                                return parts.length >= 3
                                    ? null
                                    : 'Format: owner/repo/path (at least 3 segments)';
                            },
                        });

                        if (input) {
                            const parts = input.trim().split('/');
                            const owner = parts[0];
                            const repo = parts[1];
                            const skillsPath = parts.slice(2).join('/');

                            repos.push({
                                owner,
                                repo,
                                branch: 'main',
                                enabled: true,
                                skillsPath,
                            });
                            await config.update(
                                'repositories',
                                repos,
                                vscode.ConfigurationTarget.Global,
                            );
                            vscode.window.showInformationMessage(
                                `Added ${owner}/${repo} and refreshing…`,
                            );
                            marketplaceProvider.refresh();
                        }
                    }
                } else {
                    const idx = parseInt(pick.id!);
                    const repo = repos[idx];

                    const action = await vscode.window.showQuickPick(
                        [
                            {
                                label:
                                    repo.enabled !== false
                                        ? 'Disable'
                                        : 'Enable',
                                id: 'toggle',
                            },
                            { label: 'Remove', id: 'remove' },
                        ],
                        { placeHolder: `${repo.owner}/${repo.repo}` },
                    );

                    if (action?.id === 'toggle') {
                        repos[idx] = {
                            ...repo,
                            enabled: repo.enabled === false,
                        };
                        await config.update(
                            'repositories',
                            repos,
                            vscode.ConfigurationTarget.Global,
                        );
                        marketplaceProvider.refresh();
                    } else if (action?.id === 'remove') {
                        repos.splice(idx, 1);
                        await config.update(
                            'repositories',
                            repos,
                            vscode.ConfigurationTarget.Global,
                        );
                        marketplaceProvider.refresh();
                    }
                }
            },
        ),
    ];

    context.subscriptions.push(
        ...commands,
        marketplaceTreeView,
        installedTreeView,
    );

    // ── File-system watchers ────────────────────────────────────
    const watchPatterns = [
        '**/.agents/*/SKILL.md',
        '**/.agents/**/*',
        '**/.github/chatmodes/*',
        '**/.github/instructions/*',
        '**/.github/prompts/*',
        '**/.github/agents/*',
        '**/.github/skills/*/SKILL.md',
    ];

    for (const pattern of watchPatterns) {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidCreate(() => syncInstalledStatus());
        watcher.onDidDelete(() => syncInstalledStatus());
        context.subscriptions.push(watcher);
    }

    // ── Configuration changes ───────────────────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('aiSkillsManager.repositories')) {
                marketplaceProvider.refresh();
            }
            if (e.affectsConfiguration('aiSkillsManager.installLocation') ||
                e.affectsConfiguration('aiSkillsManager.globalInstallLocation')) {
                installedProvider.refresh();
            }
        }),
    );

    // ── Initial load ────────────────────────────────────────────
    Promise.all([
        installedProvider.refresh(),
        marketplaceProvider.loadResources(),
    ]).then(() => {
        marketplaceProvider.setInstalledNames(
            installedProvider.getInstalledNames(),
        );
    });
}

export function deactivate() { }
