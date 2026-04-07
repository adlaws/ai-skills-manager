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
import {
    LocalTreeDataProvider,
    LocalResourceTreeItem,
    LocalCollectionTreeItem,
} from './views/localProvider';
import { ResourceDetailPanel } from './views/resourceDetailPanel';
import { InstallationService } from './services/installationService';
import { PathService } from './services/pathService';
import { ScaffoldingService } from './services/scaffoldingService';
import { PackService } from './services/packService';
import { ValidationService } from './services/validationService';
import { ConfigService } from './services/configService';
import { UsageDetectionService } from './services/usageDetectionService';
import { ContributionService } from './services/contributionService';
import { ResourceItem, InstalledResource, ResourceRepository, ResourceCategory, LocalCollection } from './types';

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
    const scaffoldingService = new ScaffoldingService(pathService);
    const packService = new PackService(
        installationService,
        () => marketplaceProvider.getAllItems(),
        () => localProvider.getAllItems(),
    );
    const validationService = new ValidationService(pathService);
    const configService = new ConfigService(context);
    const usageDetectionService = new UsageDetectionService();
    const contributionService = new ContributionService(
        resourceClient,
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
    const localProvider = new LocalTreeDataProvider(context);

    // ── Tree views ──────────────────────────────────────────────
    const marketplaceTreeView = vscode.window.createTreeView(
        'aiSkillsManager.marketplace',
        {
            treeDataProvider: marketplaceProvider,
            showCollapseAll: true,
            canSelectMany: true,
        },
    );

    const localTreeView = vscode.window.createTreeView(
        'aiSkillsManager.local',
        {
            treeDataProvider: localProvider,
            showCollapseAll: true,
            canSelectMany: true,
        },
    );

    const installedTreeView = vscode.window.createTreeView(
        'aiSkillsManager.installed',
        {
            treeDataProvider: installedProvider,
            canSelectMany: true,
        },
    );

    // ── Status bar ──────────────────────────────────────────────
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100,
    );
    statusBarItem.command = 'aiSkillsManager.statusBarAction';
    statusBarItem.tooltip = 'AI Skills Manager — click for quick actions';
    context.subscriptions.push(statusBarItem);

    const updateStatusBar = () => {
        const count = installedProvider.getInstalledResources().length;
        const updates = installedProvider.getUpdatableCount();
        if (count === 0) {
            statusBarItem.text = '$(tools) AI Skills';
        } else if (updates > 0) {
            statusBarItem.text = `$(tools) ${count} $(cloud-download) ${updates}`;
            statusBarItem.tooltip = `AI Skills Manager — ${count} installed, ${updates} update${updates !== 1 ? 's' : ''} available`;
        } else {
            statusBarItem.text = `$(tools) ${count}`;
            statusBarItem.tooltip = `AI Skills Manager — ${count} resource${count !== 1 ? 's' : ''} installed`;
        }
        statusBarItem.show();
    };

    // Update status bar whenever installed tree changes
    installedProvider.onDidChangeTreeData(() => updateStatusBar());
    updateStatusBar();

    // ── Helpers ─────────────────────────────────────────────────

    /** Extract ResourceItem(s) from a marketplace tree command invocation. */
    const resolveMarketplaceItems = (
        clicked: ResourceTreeItem | ResourceItem,
        selected?: readonly (ResourceTreeItem | ResourceItem)[],
    ): ResourceItem[] => {
        if (selected && selected.length > 0) {
            return selected.map((s) =>
                s instanceof ResourceTreeItem ? s.resource : s,
            ).filter(Boolean);
        }
        const single = clicked instanceof ResourceTreeItem ? clicked.resource : clicked;
        return single ? [single] : [];
    };

    /** Extract InstalledResource(s) from an installed tree command invocation. */
    const resolveInstalledItems = (
        clicked: InstalledResourceTreeItem | InstalledResource,
        selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
    ): InstalledResource[] => {
        if (selected && selected.length > 0) {
            return selected.map((s) =>
                s instanceof InstalledResourceTreeItem ? s.resource : s,
            ).filter(Boolean);
        }
        const single = clicked instanceof InstalledResourceTreeItem ? clicked.resource : clicked;
        return single ? [single] : [];
    };

    /** Extract ResourceItem(s) from a local collection tree command invocation. */
    const resolveLocalItems = (
        clicked: LocalResourceTreeItem | ResourceItem,
        selected?: readonly (LocalResourceTreeItem | ResourceItem)[],
    ): ResourceItem[] => {
        if (selected && selected.length > 0) {
            return selected.map((s) =>
                s instanceof LocalResourceTreeItem ? s.resource : s,
            ).filter(Boolean);
        }
        const single = clicked instanceof LocalResourceTreeItem ? clicked.resource : clicked;
        return single ? [single] : [];
    };

    const syncInstalledStatus = async () => {
        await installedProvider.refresh();
        const names = installedProvider.getInstalledNames();
        marketplaceProvider.setInstalledNames(names);
        localProvider.setInstalledNames(names);
    };

    /**
     * Check for local modifications by comparing current content hashes
     * against the hashes stored at install time. Purely local — no network.
     *
     * Reads metadata directly from disk so it works even when the cached
     * metadata map has not been populated yet (e.g. startup race, or when
     * checkForUpdates has not finished / failed).
     */
    const checkForModifications = async () => {
        // Read metadata fresh from disk — don't rely on the cached copy
        // that is set by checkForUpdates, which may not have run yet.
        const allMeta = await installationService.readAllInstallMetadata();
        installedProvider.setInstallMetadata(allMeta);

        const installed = installedProvider.getInstalledResources();
        const modified = new Set<string>();

        for (const resource of installed) {
            const meta = allMeta.get(resource.name);
            if (!meta?.contentHash || !meta?.sourceRepo) {
                continue;
            }

            try {
                const currentHash = await installationService.computeContentHash(
                    resource.location, resource.category,
                );
                if (currentHash && currentHash !== meta.contentHash) {
                    modified.add(resource.name);
                }
            } catch {
                // Skip resources we can't hash
            }
        }

        installedProvider.setModifiedNames(modified);
    };

    /**
     * Check for updates by comparing installed SHAs against current
     * marketplace SHAs. Runs in background with progress notification.
     */
    const checkForUpdates = async () => {
        // Load metadata from all install locations
        const allMeta = await installationService.readAllInstallMetadata();
        installedProvider.setInstallMetadata(allMeta);

        if (allMeta.size === 0) {
            vscode.commands.executeCommand('setContext', 'aiSkillsManager:hasUpdates', false);
            installedProvider.setUpdatableNames(new Set());
            return;
        }

        const updatable = new Set<string>();

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: 'Checking for resource updates…',
            },
            async (progress) => {
                for (const [name, meta] of allMeta.entries()) {
                    if (!meta.sha || !meta.sourceRepo) {
                        continue;
                    }

                    progress.report({ message: name });

                    try {
                        const remoteSha = await resourceClient.fetchResourceSha(
                            meta.sourceRepo.owner,
                            meta.sourceRepo.repo,
                            meta.sourceRepo.branch,
                            meta.sourceRepo.filePath,
                        );

                        if (remoteSha && remoteSha !== meta.sha) {
                            updatable.add(name);
                        }
                    } catch {
                        // Skip resources we can't check
                    }
                }
            },
        );

        installedProvider.setUpdatableNames(updatable);
        vscode.commands.executeCommand(
            'setContext',
            'aiSkillsManager:hasUpdates',
            updatable.size > 0,
        );

        if (updatable.size > 0) {
            const names = [...updatable].join(', ');
            const action = await vscode.window.showInformationMessage(
                `${updatable.size} resource update${updatable.size > 1 ? 's' : ''} available: ${names}`,
                'Update All',
            );
            if (action === 'Update All') {
                await vscode.commands.executeCommand('aiSkillsManager.updateAll');
            }
        }
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

        // Toggle favorite
        vscode.commands.registerCommand(
            'aiSkillsManager.toggleFavorite',
            async (
                clicked: ResourceTreeItem | ResourceItem,
                selected?: readonly (ResourceTreeItem | ResourceItem)[],
            ) => {
                const items = resolveMarketplaceItems(clicked, selected);
                for (const item of items) {
                    await marketplaceProvider.toggleFavorite(item.id);
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
                const items = resolveMarketplaceItems(clicked, selected);
                for (const item of items) {
                    await marketplaceProvider.removeFavorite(item.id);
                }
            },
        ),

        // Filter by tag
        vscode.commands.registerCommand(
            'aiSkillsManager.filterByTag',
            async () => {
                const tags = marketplaceProvider.getAllTags();
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
                    marketplaceProvider.setTagFilter(pick.label);
                }
            },
        ),

        // Clear tag filter
        vscode.commands.registerCommand('aiSkillsManager.clearTagFilter', () => {
            marketplaceProvider.clearTagFilter();
        }),

        // Status bar quick action menu
        vscode.commands.registerCommand(
            'aiSkillsManager.statusBarAction',
            async () => {
                const installedCount = installedProvider.getInstalledResources().length;
                const updateCount = installedProvider.getUpdatableCount();

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
                    marketplaceProvider.refresh(),
                    localProvider.refresh(),
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
                    pathService,
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
                    item = marketplaceProvider.getItemByName(
                        treeItemOrItem.resource.name,
                    );
                    // Then try local collections
                    if (!item) {
                        item = localProvider.getItemByName(
                            treeItemOrItem.resource.name,
                        );
                    }
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
            async (
                clicked: ResourceTreeItem | ResourceItem,
                selected?: readonly (ResourceTreeItem | ResourceItem)[],
            ) => {
                const items = resolveMarketplaceItems(clicked, selected);
                if (items.length === 0) { return; }

                let anySuccess = false;
                if (items.length === 1) {
                    anySuccess = await installationService.installResource(items[0], 'local');
                } else {
                    await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: 'Installing resources…', cancellable: true },
                        async (progress, token) => {
                            for (let i = 0; i < items.length; i++) {
                                if (token.isCancellationRequested) { break; }
                                progress.report({ message: `${items[i].name} (${i + 1}/${items.length})`, increment: (1 / items.length) * 100 });
                                const ok = await installationService.installResource(items[i], 'local');
                                if (ok) { anySuccess = true; }
                            }
                        },
                    );
                }
                if (anySuccess) { await syncInstalledStatus(); }
            },
        ),

        // Install globally
        vscode.commands.registerCommand(
            'aiSkillsManager.installGlobally',
            async (
                clicked: ResourceTreeItem | ResourceItem,
                selected?: readonly (ResourceTreeItem | ResourceItem)[],
            ) => {
                const items = resolveMarketplaceItems(clicked, selected);
                if (items.length === 0) { return; }

                let anySuccess = false;
                if (items.length === 1) {
                    anySuccess = await installationService.installResource(items[0], 'global');
                } else {
                    await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: 'Installing resources globally…', cancellable: true },
                        async (progress, token) => {
                            for (let i = 0; i < items.length; i++) {
                                if (token.isCancellationRequested) { break; }
                                progress.report({ message: `${items[i].name} (${i + 1}/${items.length})`, increment: (1 / items.length) * 100 });
                                const ok = await installationService.installResource(items[i], 'global');
                                if (ok) { anySuccess = true; }
                            }
                        },
                    );
                }
                if (anySuccess) { await syncInstalledStatus(); }
            },
        ),

        // Move installed resource to global
        vscode.commands.registerCommand(
            'aiSkillsManager.moveToGlobal',
            async (
                clicked: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                const resources = resolveInstalledItems(clicked, selected);
                if (resources.length === 0) { return; }

                let anySuccess = false;
                for (const resource of resources) {
                    const ok = await installationService.moveResource(resource, 'global');
                    if (ok) { anySuccess = true; }
                }
                if (anySuccess) { await syncInstalledStatus(); }
            },
        ),

        // Move installed resource to workspace
        vscode.commands.registerCommand(
            'aiSkillsManager.moveToWorkspace',
            async (
                clicked: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                const resources = resolveInstalledItems(clicked, selected);
                if (resources.length === 0) { return; }

                let anySuccess = false;
                for (const resource of resources) {
                    const ok = await installationService.moveResource(resource, 'local');
                    if (ok) { anySuccess = true; }
                }
                if (anySuccess) { await syncInstalledStatus(); }
            },
        ),

        // Copy installed resource to a local collection
        vscode.commands.registerCommand(
            'aiSkillsManager.copyToLocalCollection',
            async (
                clicked: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                const resources = resolveInstalledItems(clicked, selected);
                if (resources.length === 0) { return; }

                let anySuccess = false;
                for (const resource of resources) {
                    const ok = await installationService.copyToLocalCollection(resource);
                    if (ok) { anySuccess = true; }
                }
                if (anySuccess) { await localProvider.refresh(); }
            },
        ),

        // Uninstall / remove
        vscode.commands.registerCommand(
            'aiSkillsManager.uninstall',
            async (
                clicked: InstalledResourceTreeItem | InstalledResource | ResourceItem,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                // When multi-select is active, use the selected array
                if (selected && selected.length > 1) {
                    const resources = resolveInstalledItems(
                        clicked as InstalledResourceTreeItem | InstalledResource,
                        selected,
                    );
                    if (resources.length === 0) { return; }

                    const confirm = await vscode.window.showWarningMessage(
                        `Remove ${resources.length} selected resources? This will delete their files.`,
                        { modal: true },
                        'Remove All',
                    );
                    if (confirm !== 'Remove All') { return; }

                    let anySuccess = false;
                    for (const resource of resources) {
                        const ok = await installationService.uninstallResourceSilent(resource);
                        if (ok) {
                            await installationService.removeInstallMetadata(resource);
                            anySuccess = true;
                        }
                    }
                    if (anySuccess) { await syncInstalledStatus(); }
                    return;
                }

                // Single-item uninstall (existing logic)
                let installed: InstalledResource | undefined;

                if (clicked instanceof InstalledResourceTreeItem) {
                    installed = clicked.resource;
                } else if ('location' in clicked) {
                    installed = clicked as InstalledResource;
                } else {
                    const item = clicked as ResourceItem;
                    installed = installedProvider
                        .getInstalledResources()
                        .find((r) => r.name === item.name);
                }

                if (installed) {
                    const success =
                        await installationService.uninstallResource(installed);
                    if (success) {
                        await installationService.removeInstallMetadata(installed);
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

        // Check for updates
        vscode.commands.registerCommand(
            'aiSkillsManager.checkForUpdates',
            async () => {
                await checkForUpdates();
            },
        ),

        // Update a single resource (or multiple selected)
        vscode.commands.registerCommand(
            'aiSkillsManager.updateResource',
            async (
                clicked: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                const resources = resolveInstalledItems(clicked, selected);
                if (resources.length === 0) { return; }

                let anySuccess = false;
                for (const resource of resources) {
                    const marketplaceItem = marketplaceProvider.getItemByName(resource.name);
                    const ok = await installationService.updateResource(resource, marketplaceItem);
                    if (ok) { anySuccess = true; }
                }
                if (anySuccess) {
                    await syncInstalledStatus();
                    await checkForUpdates();
                    await checkForModifications();
                }
            },
        ),

        // Update all resources with available updates
        vscode.commands.registerCommand(
            'aiSkillsManager.updateAll',
            async () => {
                const updatableNames = installedProvider.getUpdatableNames();
                if (updatableNames.size === 0) {
                    vscode.window.showInformationMessage('All resources are up to date.');
                    return;
                }

                const confirm = await vscode.window.showInformationMessage(
                    `Update ${updatableNames.size} resource${updatableNames.size > 1 ? 's' : ''}?`,
                    { modal: true },
                    'Update All',
                );
                if (confirm !== 'Update All') {
                    return;
                }

                let updated = 0;
                let failed = 0;

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Updating resources…',
                        cancellable: true,
                    },
                    async (progress, token) => {
                        const total = updatableNames.size;
                        let processed = 0;

                        for (const name of updatableNames) {
                            if (token.isCancellationRequested) {
                                break;
                            }

                            const resource = installedProvider.getInstalledByName(name);
                            if (!resource) {
                                continue;
                            }

                            progress.report({
                                message: `${name} (${processed + 1}/${total})`,
                                increment: (1 / total) * 100,
                            });

                            const marketplaceItem = marketplaceProvider.getItemByName(name);
                            const success = await installationService.updateResource(
                                resource,
                                marketplaceItem,
                            );

                            if (success) {
                                updated++;
                            } else {
                                failed++;
                            }
                            processed++;
                        }
                    },
                );

                await syncInstalledStatus();
                await checkForUpdates();
                await checkForModifications();

                if (failed > 0) {
                    vscode.window.showWarningMessage(
                        `Updated ${updated} resource${updated !== 1 ? 's' : ''}, ${failed} failed.`,
                    );
                } else {
                    vscode.window.showInformationMessage(
                        `Successfully updated ${updated} resource${updated !== 1 ? 's' : ''}.`,
                    );
                }
            },
        ),

        // Create new resource from template
        vscode.commands.registerCommand(
            'aiSkillsManager.createResource',
            async () => {
                const success = await scaffoldingService.createResource();
                if (success) {
                    await syncInstalledStatus();
                }
            },
        ),

        // Install a resource pack from file
        vscode.commands.registerCommand(
            'aiSkillsManager.installPack',
            async () => {
                const result = await packService.installPack();
                if (result.installed > 0) {
                    await syncInstalledStatus();
                }
            },
        ),

        // Create a resource pack from installed resources
        vscode.commands.registerCommand(
            'aiSkillsManager.createPack',
            async (
                clicked?: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                // If invoked from multi-select, pre-select those resources
                const preSelected = (selected && selected.length > 0)
                    ? resolveInstalledItems(clicked!, selected)
                    : undefined;

                const allResources = preSelected ??
                    installedProvider.getInstalledResources();

                const resources = allResources.map((r) => ({ name: r.name, category: r.category }));
                await packService.createPack(resources);
            },
        ),

        // Validate installed resources
        vscode.commands.registerCommand(
            'aiSkillsManager.validateResources',
            async () => {
                const resources = installedProvider.getInstalledResources();
                if (resources.length === 0) {
                    vscode.window.showInformationMessage('No resources installed to validate.');
                    return;
                }

                const issues = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Validating installed resources…',
                    },
                    () => validationService.validate(resources),
                );

                await validationService.showResults(issues, resources.length);
            },
        ),

        // Export configuration
        vscode.commands.registerCommand(
            'aiSkillsManager.exportConfig',
            async () => {
                await configService.exportConfig();
            },
        ),

        // Import configuration
        vscode.commands.registerCommand(
            'aiSkillsManager.importConfig',
            async () => {
                const success = await configService.importConfig();
                if (success) {
                    await Promise.all([
                        marketplaceProvider.refresh(),
                        localProvider.refresh(),
                        installedProvider.refresh(),
                    ]);
                }
            },
        ),

        // Detect resource usage in workspace
        vscode.commands.registerCommand(
            'aiSkillsManager.detectUsage',
            async () => {
                const resources = installedProvider.getInstalledResources();
                if (resources.length === 0) {
                    vscode.window.showInformationMessage('No resources installed to check usage for.');
                    return;
                }

                const result = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Scanning workspace for resource references…',
                    },
                    () => usageDetectionService.detectUsage(resources),
                );

                await usageDetectionService.showResults(result, resources);
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

        // ── Local collection commands ────────────────────────────

        // Install from local collection (local scope)
        vscode.commands.registerCommand(
            'aiSkillsManager.localInstall',
            async (
                clicked: LocalResourceTreeItem | ResourceItem,
                selected?: readonly (LocalResourceTreeItem | ResourceItem)[],
            ) => {
                const items = resolveLocalItems(clicked, selected);
                if (items.length === 0) { return; }

                let anySuccess = false;
                for (const item of items) {
                    const ok = await installationService.installFromLocal(item, 'local');
                    if (ok) { anySuccess = true; }
                }
                if (anySuccess) { await syncInstalledStatus(); }
            },
        ),

        // Install from local collection (global scope)
        vscode.commands.registerCommand(
            'aiSkillsManager.localInstallGlobally',
            async (
                clicked: LocalResourceTreeItem | ResourceItem,
                selected?: readonly (LocalResourceTreeItem | ResourceItem)[],
            ) => {
                const items = resolveLocalItems(clicked, selected);
                if (items.length === 0) { return; }

                let anySuccess = false;
                for (const item of items) {
                    const ok = await installationService.installFromLocal(item, 'global');
                    if (ok) { anySuccess = true; }
                }
                if (anySuccess) { await syncInstalledStatus(); }
            },
        ),

        // Search local collections
        vscode.commands.registerCommand(
            'aiSkillsManager.localSearch',
            async () => {
                const query = await vscode.window.showInputBox({
                    prompt: 'Search local resources',
                    placeHolder: 'Enter name or keyword…',
                });
                if (query !== undefined) {
                    localProvider.setSearchQuery(query);
                }
            },
        ),

        // Clear local search
        vscode.commands.registerCommand('aiSkillsManager.localClearSearch', () => {
            localProvider.clearSearch();
        }),

        // Open resource from local collection in editor
        vscode.commands.registerCommand(
            'aiSkillsManager.localOpenResource',
            async (treeItem: LocalResourceTreeItem) => {
                if (!treeItem?.resource) {
                    return;
                }
                const item = treeItem.resource;
                const fileUri = vscode.Uri.file(item.file.path);
                try {
                    const stat = await vscode.workspace.fs.stat(fileUri);
                    if (stat.type & vscode.FileType.Directory) {
                        // Open folder in OS file manager
                        await vscode.env.openExternal(fileUri);
                    } else {
                        await vscode.window.showTextDocument(fileUri);
                    }
                } catch {
                    vscode.window.showErrorMessage(
                        `Could not open: ${item.file.path}`,
                    );
                }
            },
        ),

        // Delete resource from local collection on disk
        vscode.commands.registerCommand(
            'aiSkillsManager.localDeleteResource',
            async (
                clicked: LocalResourceTreeItem,
                selected?: readonly LocalResourceTreeItem[],
            ) => {
                const treeItems = (selected && selected.length > 0)
                    ? [...selected].filter((s) => s instanceof LocalResourceTreeItem)
                    : (clicked instanceof LocalResourceTreeItem ? [clicked] : []);

                if (treeItems.length === 0) { return; }

                if (treeItems.length === 1) {
                    const item = treeItems[0].resource;
                    if (!item) { return; }
                    const isSkill =
                        item.category === ResourceCategory.Skills &&
                        item.file.type === 'dir';

                    const warningMessage = isSkill
                        ? `Permanently delete skill folder "${item.name}" and all its contents from disk?`
                        : `Permanently delete file "${item.name}" from disk?`;

                    const confirm = await vscode.window.showWarningMessage(
                        warningMessage,
                        { modal: true, detail: `This will remove: ${item.file.path}` },
                        'Delete',
                    );
                    if (confirm !== 'Delete') { return; }

                    try {
                        const fileUri = vscode.Uri.file(item.file.path);
                        await vscode.workspace.fs.delete(fileUri, {
                            recursive: isSkill,
                            useTrash: true,
                        });
                        vscode.window.showInformationMessage(
                            `Deleted "${item.name}" from disk`,
                        );
                    } catch (error) {
                        const msg =
                            error instanceof Error ? error.message : String(error);
                        vscode.window.showErrorMessage(
                            `Failed to delete: ${msg}`,
                        );
                    }
                } else {
                    const names = treeItems.map((t) => t.resource?.name).filter(Boolean);
                    const confirm = await vscode.window.showWarningMessage(
                        `Permanently delete ${treeItems.length} resources from disk?`,
                        { modal: true, detail: names.join(', ') },
                        'Delete All',
                    );
                    if (confirm !== 'Delete All') { return; }

                    for (const treeItem of treeItems) {
                        const item = treeItem.resource;
                        if (!item) { continue; }
                        const isSkill =
                            item.category === ResourceCategory.Skills &&
                            item.file.type === 'dir';
                        try {
                            const fileUri = vscode.Uri.file(item.file.path);
                            await vscode.workspace.fs.delete(fileUri, {
                                recursive: isSkill,
                                useTrash: true,
                            });
                        } catch (error) {
                            const msg =
                                error instanceof Error ? error.message : String(error);
                            vscode.window.showErrorMessage(
                                `Failed to delete "${item.name}": ${msg}`,
                            );
                        }
                    }
                    vscode.window.showInformationMessage(
                        `Deleted ${treeItems.length} resources from disk`,
                    );
                }
                await localProvider.refresh();
            },
        ),

        // Manage local collections – quick-pick to toggle, add, or remove
        vscode.commands.registerCommand(
            'aiSkillsManager.manageLocalCollections',
            async () => {
                const config =
                    vscode.workspace.getConfiguration('aiSkillsManager');
                const collections = config.get<LocalCollection[]>(
                    'localCollections',
                    [],
                );

                const pick = await vscode.window.showQuickPick(
                    [
                        {
                            label: '$(add) Add local collection…',
                            id: '__add__',
                        },
                        ...collections.map((c, i) => ({
                            label: c.label || c.path,
                            description: c.path,
                            detail:
                                c.enabled !== false
                                    ? '$(check) Enabled'
                                    : '$(circle-slash) Disabled',
                            id: String(i),
                        })),
                    ],
                    {
                        placeHolder:
                            'Select a collection to toggle or add a new one',
                        title: 'Manage Local Collections',
                    },
                );

                if (!pick) {
                    return;
                }

                if (pick.id === '__add__') {
                    const folderUris = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: 'Select Collection Folder',
                        title: 'Select a folder containing AI resources',
                    });

                    if (folderUris && folderUris.length > 0) {
                        const folderPath = folderUris[0].fsPath;
                        const label = await vscode.window.showInputBox({
                            prompt: 'Optional display label for this collection',
                            placeHolder: 'e.g. My AI Resources',
                        });

                        collections.push({
                            path: folderPath,
                            label: label || undefined,
                            enabled: true,
                        });
                        await config.update(
                            'localCollections',
                            collections,
                            vscode.ConfigurationTarget.Global,
                        );
                        vscode.window.showInformationMessage(
                            `Added local collection: ${folderPath}`,
                        );
                        localProvider.refresh();
                    }
                } else {
                    const idx = parseInt(pick.id!);
                    const collection = collections[idx];

                    const action = await vscode.window.showQuickPick(
                        [
                            {
                                label:
                                    collection.enabled !== false
                                        ? 'Disable'
                                        : 'Enable',
                                id: 'toggle',
                            },
                            { label: 'Remove', id: 'remove' },
                        ],
                        { placeHolder: collection.label || collection.path },
                    );

                    if (action?.id === 'toggle') {
                        collections[idx] = {
                            ...collection,
                            enabled: collection.enabled === false,
                        };
                        await config.update(
                            'localCollections',
                            collections,
                            vscode.ConfigurationTarget.Global,
                        );
                        localProvider.refresh();
                    } else if (action?.id === 'remove') {
                        collections.splice(idx, 1);
                        await config.update(
                            'localCollections',
                            collections,
                            vscode.ConfigurationTarget.Global,
                        );
                        localProvider.refresh();
                    }
                }
            },
        ),

        // Propose changes back to the source repository
        vscode.commands.registerCommand(
            'aiSkillsManager.proposeChanges',
            async (
                clicked?: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                // If invoked from command palette with no args, show a quick pick
                if (!clicked) {
                    const allInstalled = installedProvider.getInstalledResources();
                    const withSource = allInstalled.filter((r) => {
                        const meta = installedProvider.getMetadata(r.name);
                        return contributionService.canProposeChanges(r, meta);
                    });

                    if (withSource.length === 0) {
                        vscode.window.showInformationMessage(
                            'No installed resources have source repository metadata. Install resources from the Marketplace first.',
                        );
                        return;
                    }

                    const pick = await vscode.window.showQuickPick(
                        withSource.map((r) => ({
                            label: r.name,
                            description: `${r.category} • ${r.scope}`,
                            resource: r,
                        })),
                        {
                            placeHolder: 'Select an installed resource to propose changes for',
                            title: 'Propose Changes to Repository',
                        },
                    );

                    if (!pick) {
                        return;
                    }

                    const meta = installedProvider.getMetadata(pick.resource.name);
                    await contributionService.proposeChanges(pick.resource, meta);
                    return;
                }

                const resources = resolveInstalledItems(clicked, selected);
                if (resources.length === 0) {
                    return;
                }

                // Only process the first resource (propose changes is inherently per-resource)
                const resource = resources[0];
                const meta = installedProvider.getMetadata(resource.name);
                await contributionService.proposeChanges(resource, meta);
            },
        ),

        // Revert an installed resource to the version in the source repository
        vscode.commands.registerCommand(
            'aiSkillsManager.revertToRepository',
            async (
                clicked?: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                // If invoked from command palette with no args, show a quick pick
                if (!clicked) {
                    const allInstalled = installedProvider.getInstalledResources();
                    const withSource = allInstalled.filter((r) => {
                        const meta = installedProvider.getMetadata(r.name);
                        const sourceRepo = meta?.sourceRepo ?? r.sourceRepo;
                        return !!(sourceRepo?.owner && sourceRepo?.repo && sourceRepo?.filePath);
                    });

                    if (withSource.length === 0) {
                        vscode.window.showInformationMessage(
                            'No installed resources have source repository metadata. Install resources from the Marketplace first.',
                        );
                        return;
                    }

                    const pick = await vscode.window.showQuickPick(
                        withSource.map((r) => ({
                            label: r.name,
                            description: `${r.category} • ${r.scope}`,
                            resource: r,
                        })),
                        {
                            placeHolder: 'Select an installed resource to revert to the repository version',
                            title: 'Revert to Repository Version',
                        },
                    );

                    if (!pick) {
                        return;
                    }

                    const meta = installedProvider.getMetadata(pick.resource.name);
                    const ok = await installationService.revertResource(pick.resource, meta);
                    if (ok) {
                        await syncInstalledStatus();
                        await checkForUpdates();
                        await checkForModifications();
                    }
                    return;
                }

                const resources = resolveInstalledItems(clicked, selected);
                if (resources.length === 0) {
                    return;
                }

                // Process first resource only (revert is inherently per-resource due to diff)
                const resource = resources[0];
                const meta = installedProvider.getMetadata(resource.name);
                const ok = await installationService.revertResource(resource, meta);
                if (ok) {
                    await syncInstalledStatus();
                    await checkForUpdates();
                    await checkForModifications();
                }
            },
        ),

        // Disconnect (deregister) a local collection without deleting from disk
        vscode.commands.registerCommand(
            'aiSkillsManager.localDeregisterCollection',
            async (treeItem: LocalCollectionTreeItem) => {
                if (!treeItem?.collection) {
                    return;
                }
                const collection = treeItem.collection;
                const label = collection.label || collection.path;

                const confirm = await vscode.window.showWarningMessage(
                    `Disconnect "${label}" from Local Collections?`,
                    {
                        modal: true,
                        detail: 'This only removes the collection from your configuration. The folder and its contents will NOT be deleted from disk.',
                    },
                    'Disconnect',
                );

                if (confirm !== 'Disconnect') {
                    return;
                }

                const config = vscode.workspace.getConfiguration('aiSkillsManager');
                const collections = config.get<LocalCollection[]>('localCollections', []);
                const updated = collections.filter((c) => c.path !== collection.path);
                await config.update(
                    'localCollections',
                    updated,
                    vscode.ConfigurationTarget.Global,
                );
                vscode.window.showInformationMessage(
                    `Disconnected "${label}". The folder remains on disk at: ${collection.path}`,
                );
                localProvider.refresh();
            },
        ),
    ];

    context.subscriptions.push(
        ...commands,
        marketplaceTreeView,
        localTreeView,
        installedTreeView,
        localProvider,
    );

    // ── File-system watchers ────────────────────────────────────

    // Debounced modification re-check so rapid saves don't hammer hashing
    let modCheckTimer: ReturnType<typeof setTimeout> | undefined;
    const debouncedModCheck = () => {
        if (modCheckTimer) { clearTimeout(modCheckTimer); }
        modCheckTimer = setTimeout(() => {
            checkForModifications().catch(() => { });
        }, 1500);
    };

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
        watcher.onDidChange(() => debouncedModCheck());
        context.subscriptions.push(watcher);
    }

    // ── Configuration changes ───────────────────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('aiSkillsManager.repositories')) {
                marketplaceProvider.refresh();
            }
            if (e.affectsConfiguration('aiSkillsManager.localCollections') ||
                e.affectsConfiguration('aiSkillsManager.localCollectionWatchInterval')) {
                localProvider.refresh();
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
        localProvider.loadResources(),
    ]).then(async () => {
        const names = installedProvider.getInstalledNames();
        marketplaceProvider.setInstalledNames(names);
        localProvider.setInstalledNames(names);

        // Check for local modifications first (fast, no network)
        await checkForModifications().catch(() => { });

        // Then check for updates after initial load (non-blocking)
        checkForUpdates().catch(() => {
            // Silently ignore update check failures
        });
    });
}

export function deactivate() { }
