/**
 * Local collection commands extracted from extension.ts.
 */

import * as vscode from 'vscode';
import { LocalCollection, ResourceCategory, ResourceItem } from '../types';
import { CommandContext } from './commandContext';
import {
    LocalResourceTreeItem,
    LocalCollectionTreeItem,
} from '../views/localProvider';

export function registerLocalCommands(ctx: CommandContext): vscode.Disposable[] {
    return [
        // Install from local collection (local scope)
        vscode.commands.registerCommand(
            'aiSkillsManager.localInstall',
            async (
                clicked: LocalResourceTreeItem | ResourceItem,
                selected?: readonly (LocalResourceTreeItem | ResourceItem)[],
            ) => {
                const items = ctx.resolveLocalItems(clicked, selected);
                if (items.length === 0) { return; }

                let anySuccess = false;
                if (items.length > 1) { ctx.installationService.beginMetadataBatch(); }
                for (const item of items) {
                    const ok = await ctx.installationService.installFromLocal(item, 'local');
                    if (ok) { anySuccess = true; }
                }
                if (items.length > 1) { await ctx.installationService.flushMetadataBatch(); }
                if (anySuccess) { await ctx.syncInstalledStatus(); }
            },
        ),

        // Install from local collection (global scope)
        vscode.commands.registerCommand(
            'aiSkillsManager.localInstallGlobally',
            async (
                clicked: LocalResourceTreeItem | ResourceItem,
                selected?: readonly (LocalResourceTreeItem | ResourceItem)[],
            ) => {
                const items = ctx.resolveLocalItems(clicked, selected);
                if (items.length === 0) { return; }

                let anySuccess = false;
                if (items.length > 1) { ctx.installationService.beginMetadataBatch(); }
                for (const item of items) {
                    const ok = await ctx.installationService.installFromLocal(item, 'global');
                    if (ok) { anySuccess = true; }
                }
                if (items.length > 1) { await ctx.installationService.flushMetadataBatch(); }
                if (anySuccess) { await ctx.syncInstalledStatus(); }
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
                    ctx.localProvider.setSearchQuery(query);
                }
            },
        ),

        // Clear local search
        vscode.commands.registerCommand('aiSkillsManager.localClearSearch', () => {
            ctx.localProvider.clearSearch();
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
                await ctx.localProvider.refresh();
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
                        ctx.localProvider.refresh();
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
                        ctx.localProvider.refresh();
                    } else if (action?.id === 'remove') {
                        collections.splice(idx, 1);
                        await config.update(
                            'localCollections',
                            collections,
                            vscode.ConfigurationTarget.Global,
                        );
                        ctx.localProvider.refresh();
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
                ctx.localProvider.refresh();
            },
        ),
    ];
}
