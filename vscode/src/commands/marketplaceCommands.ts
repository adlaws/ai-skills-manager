/**
 * Marketplace-related commands: search, favorites, tag filtering,
 * status-bar quick actions, refresh, preview, and view-details.
 */

import * as vscode from 'vscode';
import { CommandContext } from './commandContext';
import { ResourceItem, ResourceCategory } from '../types';
import { parseFrontmatter } from '../services/frontmatterService';
import { ResourceTreeItem, RepoTreeItem } from '../views/marketplaceProvider';
import {
    InstalledResourceTreeItem,
} from '../views/installedProvider';
import { LocalResourceTreeItem } from '../views/localProvider';
import { ResourceDetailPanel } from '../views/resourceDetailPanel';

export function registerMarketplaceCommands(
    ctx: CommandContext,
): vscode.Disposable[] {
    return [
        // Search
        vscode.commands.registerCommand(
            'aiSkillsManager.search',
            async () => {
                const query = await vscode.window.showInputBox({
                    prompt: 'Search resources',
                    placeHolder: 'Enter name or keyword…',
                });
                if (query !== undefined) {
                    ctx.marketplaceProvider.setSearchQuery(query);
                }
            },
        ),

        // Clear search
        vscode.commands.registerCommand('aiSkillsManager.clearSearch', () => {
            ctx.marketplaceProvider.clearSearch();
        }),

        // Toggle favorite
        vscode.commands.registerCommand(
            'aiSkillsManager.toggleFavorite',
            async (
                clicked: ResourceTreeItem | ResourceItem,
                selected?: readonly (ResourceTreeItem | ResourceItem)[],
            ) => {
                const items = ctx.resolveMarketplaceItems(clicked, selected);
                for (const item of items) {
                    await ctx.marketplaceProvider.toggleFavorite(item.id);
                }
            },
        ),

        // Remove from favorites
        vscode.commands.registerCommand(
            'aiSkillsManager.removeFavorite',
            async (
                clicked: ResourceTreeItem | ResourceItem,
                selected?: readonly (ResourceTreeItem | ResourceItem)[],
            ) => {
                const items = ctx.resolveMarketplaceItems(clicked, selected);
                for (const item of items) {
                    await ctx.marketplaceProvider.removeFavorite(item.id);
                }
            },
        ),

        // Filter by tag
        vscode.commands.registerCommand(
            'aiSkillsManager.filterByTag',
            async () => {
                const tags = ctx.marketplaceProvider.getAllTags();
                if (tags.length === 0) {
                    vscode.window.showInformationMessage(
                        'No tags found in current resources. Tags are parsed from the "tags" field in SKILL.md frontmatter.',
                    );
                    return;
                }

                const pick = await vscode.window.showQuickPick(
                    tags.map((tag) => ({ label: tag })),
                    {
                        placeHolder: 'Select a tag to filter by',
                        title: 'Filter by Tag',
                    },
                );

                if (pick) {
                    ctx.marketplaceProvider.setTagFilter(pick.label);
                }
            },
        ),

        // Clear tag filter
        vscode.commands.registerCommand('aiSkillsManager.clearTagFilter', () => {
            ctx.marketplaceProvider.clearTagFilter();
        }),

        // Status bar quick action menu
        vscode.commands.registerCommand(
            'aiSkillsManager.statusBarAction',
            async () => {
                const installedCount = ctx.installedProvider.getInstalledResources().length;
                const updateCount = ctx.installedProvider.getUpdatableCount();

                const actions: { label: string; id: string; description?: string }[] = [
                    {
                        label: '$(search) Browse Marketplace',
                        id: 'marketplace',
                    },
                    {
                        label: '$(add) Create New Resource…',
                        id: 'create',
                    },
                ];

                if (installedCount > 0) {
                    actions.push({
                        label: `$(list-tree) View Installed (${installedCount})`,
                        id: 'installed',
                    });
                }

                if (updateCount > 0) {
                    actions.push({
                        label: `$(cloud-download) Update All (${updateCount})`,
                        id: 'updateAll',
                    });
                }

                actions.push(
                    {
                        label: '$(sync) Check for Updates',
                        id: 'checkUpdates',
                    },
                    {
                        label: '$(package) Install Resource Pack…',
                        id: 'installPack',
                    },
                    {
                        label: '$(checklist) Validate Installed Resources',
                        id: 'validate',
                    },
                    {
                        label: '$(export) Export Configuration…',
                        id: 'export',
                    },
                    {
                        label: '$(import) Import Configuration…',
                        id: 'import',
                    },
                    {
                        label: '$(references) Detect Resource Usage',
                        id: 'detectUsage',
                    },
                );

                const pick = await vscode.window.showQuickPick(actions, {
                    placeHolder: 'AI Skills Manager — Quick Actions',
                });

                if (!pick) {
                    return;
                }

                switch (pick.id) {
                    case 'marketplace':
                        await vscode.commands.executeCommand('aiSkillsManager.marketplace.focus');
                        break;
                    case 'create':
                        await vscode.commands.executeCommand('aiSkillsManager.createResource');
                        break;
                    case 'installed':
                        await vscode.commands.executeCommand('aiSkillsManager.installed.focus');
                        break;
                    case 'updateAll':
                        await vscode.commands.executeCommand('aiSkillsManager.updateAll');
                        break;
                    case 'checkUpdates':
                        await vscode.commands.executeCommand('aiSkillsManager.checkForUpdates');
                        break;
                    case 'installPack':
                        await vscode.commands.executeCommand('aiSkillsManager.installPack');
                        break;
                    case 'validate':
                        await vscode.commands.executeCommand('aiSkillsManager.validateResources');
                        break;
                    case 'export':
                        await vscode.commands.executeCommand('aiSkillsManager.exportConfig');
                        break;
                    case 'import':
                        await vscode.commands.executeCommand('aiSkillsManager.importConfig');
                        break;
                    case 'detectUsage':
                        await vscode.commands.executeCommand('aiSkillsManager.detectUsage');
                        break;
                }
            },
        ),

        // Refresh
        vscode.commands.registerCommand(
            'aiSkillsManager.refresh',
            async () => {
                await Promise.all([
                    ctx.marketplaceProvider.refresh(),
                    ctx.localProvider.refresh(),
                    ctx.installedProvider.refresh(),
                ]);
                await ctx.syncInstalledStatus();
            },
        ),

        // Refresh single repo
        vscode.commands.registerCommand(
            'aiSkillsManager.refreshRepo',
            async (treeItem: RepoTreeItem) => {
                if (treeItem instanceof RepoTreeItem) {
                    await ctx.marketplaceProvider.refreshRepo(treeItem.repo);
                }
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
                                await ctx.client.fetchRawContent(
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
                                await ctx.client.fetchFileContent(
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
                    ctx.extensionContext.extensionUri,
                    ctx.installedProvider,
                    ctx.pathService,
                );
            },
        ),

        // View details (alias for preview)
        vscode.commands.registerCommand(
            'aiSkillsManager.viewDetails',
            async (
                treeItemOrItem:
                    | ResourceTreeItem
                    | LocalResourceTreeItem
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
                    treeItemOrItem instanceof LocalResourceTreeItem
                ) {
                    item = treeItemOrItem.resource;
                } else if (
                    treeItemOrItem instanceof InstalledResourceTreeItem
                ) {
                    // Try marketplace first for richer metadata
                    item = ctx.marketplaceProvider.getItemByName(
                        treeItemOrItem.resource.name,
                    );
                    // Then try local collections
                    if (!item) {
                        item = ctx.localProvider.getItemByName(
                            treeItemOrItem.resource.name,
                        );
                    }
                    // Fall back to reading local content from disk
                    if (!item) {
                        item = await ctx.buildResourceItemFromInstalled(
                            treeItemOrItem.resource,
                        );
                    }
                } else {
                    const data = treeItemOrItem as Record<string, unknown>;
                    if (data.id && data.name && data.category && data.repo && data.file) {
                        item = treeItemOrItem as ResourceItem;
                    }
                }

                // Lazy-load content for local collection items (not loaded at scan time)
                if (item && !item.content && !item.fullContent && item.file.path) {
                    try {
                        if (item.category === ResourceCategory.Skills && item.file.type === 'dir') {
                            const skillMdUri = vscode.Uri.joinPath(
                                vscode.Uri.file(item.file.path), 'SKILL.md',
                            );
                            const raw = new TextDecoder().decode(
                                await vscode.workspace.fs.readFile(skillMdUri),
                            );
                            item.fullContent = raw;
                            item.bodyContent = parseFrontmatter(raw).body;
                        } else if (item.file.type === 'file') {
                            const fileUri = vscode.Uri.file(item.file.path);
                            item.content = new TextDecoder().decode(
                                await vscode.workspace.fs.readFile(fileUri),
                            );
                        }
                    } catch {
                        // Content unavailable — detail panel handles gracefully
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

        // Copy resource name with configurable prefix (for pasting into AI chat)
        vscode.commands.registerCommand(
            'aiSkillsManager.copyResourceName',
            async (
                treeItemOrItem: ResourceTreeItem | InstalledResourceTreeItem | LocalResourceTreeItem | ResourceItem,
            ) => {
                let name: string | undefined;

                if (treeItemOrItem instanceof ResourceTreeItem) {
                    name = treeItemOrItem.resource.name;
                } else if (treeItemOrItem instanceof InstalledResourceTreeItem) {
                    name = treeItemOrItem.resource.name;
                } else if (treeItemOrItem instanceof LocalResourceTreeItem) {
                    name = treeItemOrItem.resource.name;
                } else if (treeItemOrItem && typeof (treeItemOrItem as ResourceItem).name === 'string') {
                    name = (treeItemOrItem as ResourceItem).name;
                }

                if (!name) {
                    return;
                }

                const config = vscode.workspace.getConfiguration('aiSkillsManager');
                const prefix = config.get<string>('copyNamePrefix', '/');
                const text = `${prefix}${name}`;

                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage(`Copied "${text}" to clipboard`);
            },
        ),
    ];
}
