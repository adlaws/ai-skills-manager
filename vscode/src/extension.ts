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
} from './views/localProvider';
import { InstallationService } from './services/installationService';
import { PathService } from './services/pathService';
import { ScaffoldingService } from './services/scaffoldingService';
import { PackService } from './services/packService';
import { ValidationService } from './services/validationService';
import { ConfigService } from './services/configService';
import { UsageDetectionService } from './services/usageDetectionService';
import { ContributionService } from './services/contributionService';
import { ResourceItem, InstalledResource, ResourceRepository, ResourceCategory } from './types';
import { parseFrontmatter } from './services/frontmatterService';
import { CommandContext } from './commands/commandContext';
import { registerMarketplaceCommands } from './commands/marketplaceCommands';
import { registerInstallCommands } from './commands/installCommands';
import { registerManagementCommands } from './commands/managementCommands';
import { registerLocalCommands } from './commands/localCommands';

// Module-scope timer so deactivate() can clear it
let modCheckTimer: ReturnType<typeof setTimeout> | undefined;

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
            const parsed = parseFrontmatter(raw);
            bodyContent = parsed.body;
            if (parsed.description) { description = parsed.description; }
            license = parsed.license;
            compatibility = parsed.compatibility;
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
    const statusBarListener = installedProvider.onDidChangeTreeData(() => updateStatusBar());
    context.subscriptions.push(statusBarListener);
    updateStatusBar();

    // ── Helpers ─────────────────────────────────────────────────

    /**
     * Generic helper to extract data items from tree command invocations.
     * Handles multi-select (selected array) and single-click (clicked item).
     */
    function resolveTreeItems<TTreeItem extends { resource: TData }, TData>(
        clicked: TTreeItem | TData,
        selected: readonly (TTreeItem | TData)[] | undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        treeItemClass: abstract new (...args: any[]) => TTreeItem,
    ): TData[] {
        if (selected && selected.length > 0) {
            return selected
                .map((s) => (s instanceof treeItemClass ? s.resource : s) as TData)
                .filter(Boolean);
        }
        const single = (clicked instanceof treeItemClass ? clicked.resource : clicked) as TData;
        return single ? [single] : [];
    }

    const resolveMarketplaceItems = (
        clicked: ResourceTreeItem | ResourceItem,
        selected?: readonly (ResourceTreeItem | ResourceItem)[],
    ): ResourceItem[] => resolveTreeItems<ResourceTreeItem, ResourceItem>(clicked, selected, ResourceTreeItem);

    const resolveInstalledItems = (
        clicked: InstalledResourceTreeItem | InstalledResource,
        selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
    ): InstalledResource[] => resolveTreeItems<InstalledResourceTreeItem, InstalledResource>(clicked, selected, InstalledResourceTreeItem);

    const resolveLocalItems = (
        clicked: LocalResourceTreeItem | ResourceItem,
        selected?: readonly (LocalResourceTreeItem | ResourceItem)[],
    ): ResourceItem[] => resolveTreeItems<LocalResourceTreeItem, ResourceItem>(clicked, selected, LocalResourceTreeItem);

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
    const checkForModifications = async (preloadedMeta?: Map<string, import('./types').InstallMetadata[string]>) => {
        const allMeta = preloadedMeta ?? await installationService.readAllInstallMetadata();
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
            } catch (err) {
                console.warn('Failed to hash resource:', resource.name, err);
            }
        }

        installedProvider.setModifiedNames(modified);
    };

    /**
     * Check for updates by comparing installed SHAs against current
     * marketplace SHAs. Runs in background with progress notification.
     */
    const checkForUpdates = async (preloadedMeta?: Map<string, import('./types').InstallMetadata[string]>) => {
        const allMeta = preloadedMeta ?? await installationService.readAllInstallMetadata();
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
                    } catch (err) {
                        console.warn('Failed to check for updates:', name, err);
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

    // ── Command context ─────────────────────────────────────────

    const cmdCtx: CommandContext = {
        extensionContext: context,
        client: resourceClient,
        installationService,
        pathService,
        scaffoldingService,
        packService,
        validationService,
        configService,
        usageDetectionService,
        contributionService,
        marketplaceProvider,
        installedProvider,
        localProvider,
        resolveMarketplaceItems,
        resolveInstalledItems,
        resolveLocalItems,
        syncInstalledStatus,
        checkForUpdates,
        checkForModifications,
        buildResourceItemFromInstalled: (resource) =>
            buildResourceItemFromInstalled(resource, pathService),
    };

    // ── Commands ────────────────────────────────────────────────

    context.subscriptions.push(
        ...registerMarketplaceCommands(cmdCtx),
        ...registerInstallCommands(cmdCtx),
        ...registerManagementCommands(cmdCtx),
        ...registerLocalCommands(cmdCtx),
        marketplaceTreeView,
        localTreeView,
        installedTreeView,
        marketplaceProvider,
        localProvider,
    );

    // ── File-system watchers ────────────────────────────────────

    // Debounced modification re-check so rapid saves don't hammer hashing
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

        // Load metadata once and share between both checks
        const allMeta = await installationService.readAllInstallMetadata();

        // Check for local modifications first (fast, no network)
        await checkForModifications(allMeta).catch(() => { });

        // Then check for updates after initial load (non-blocking)
        checkForUpdates(allMeta).catch(() => {
            // Silently ignore update check failures
        });
    });
}

export function deactivate() {
    if (modCheckTimer) {
        clearTimeout(modCheckTimer);
    }
}
