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
        },
    );

    const localTreeView = vscode.window.createTreeView(
        'aiSkillsManager.local',
        {
            treeDataProvider: localProvider,
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
        const names = installedProvider.getInstalledNames();
        marketplaceProvider.setInstalledNames(names);
        localProvider.setInstalledNames(names);
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

        // Move installed resource to workspace
        vscode.commands.registerCommand(
            'aiSkillsManager.moveToWorkspace',
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

        // Copy installed resource to a local collection
        vscode.commands.registerCommand(
            'aiSkillsManager.copyToLocalCollection',
            async (
                treeItemOrResource: InstalledResourceTreeItem | InstalledResource,
            ) => {
                const resource =
                    treeItemOrResource instanceof InstalledResourceTreeItem
                        ? treeItemOrResource.resource
                        : treeItemOrResource;

                if (resource) {
                    const success =
                        await installationService.copyToLocalCollection(resource);
                    if (success) {
                        await localProvider.refresh();
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

        // ── Local collection commands ────────────────────────────

        // Install from local collection (local scope)
        vscode.commands.registerCommand(
            'aiSkillsManager.localInstall',
            async (treeItemOrItem: LocalResourceTreeItem | ResourceItem) => {
                const item =
                    treeItemOrItem instanceof LocalResourceTreeItem
                        ? treeItemOrItem.resource
                        : treeItemOrItem;

                if (item) {
                    const success =
                        await installationService.installFromLocal(item, 'local');
                    if (success) {
                        await syncInstalledStatus();
                    }
                }
            },
        ),

        // Install from local collection (global scope)
        vscode.commands.registerCommand(
            'aiSkillsManager.localInstallGlobally',
            async (treeItemOrItem: LocalResourceTreeItem | ResourceItem) => {
                const item =
                    treeItemOrItem instanceof LocalResourceTreeItem
                        ? treeItemOrItem.resource
                        : treeItemOrItem;

                if (item) {
                    const success =
                        await installationService.installFromLocal(item, 'global');
                    if (success) {
                        await syncInstalledStatus();
                    }
                }
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
            async (treeItem: LocalResourceTreeItem) => {
                if (!treeItem?.resource) {
                    return;
                }
                const item = treeItem.resource;
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

                if (confirm !== 'Delete') {
                    return;
                }

                try {
                    const fileUri = vscode.Uri.file(item.file.path);
                    await vscode.workspace.fs.delete(fileUri, {
                        recursive: isSkill,
                        useTrash: true,
                    });
                    vscode.window.showInformationMessage(
                        `Deleted "${item.name}" from disk`,
                    );
                    await localProvider.refresh();
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(
                        `Failed to delete: ${msg}`,
                    );
                }
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
    ]).then(() => {
        const names = installedProvider.getInstalledNames();
        marketplaceProvider.setInstalledNames(names);
        localProvider.setInstalledNames(names);
    });
}

export function deactivate() { }
