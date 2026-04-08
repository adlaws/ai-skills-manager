/**
 * Install-related commands: install, install globally, uninstall,
 * check for updates, update resource, and update all.
 */

import * as vscode from 'vscode';
import { CommandContext } from './commandContext';
import { ResourceItem, InstalledResource } from '../types';
import { ResourceTreeItem } from '../views/marketplaceProvider';
import { InstalledResourceTreeItem } from '../views/installedProvider';

export function registerInstallCommands(
    ctx: CommandContext,
): vscode.Disposable[] {
    return [
        // Install / download (local)
        vscode.commands.registerCommand(
            'aiSkillsManager.install',
            async (
                clicked: ResourceTreeItem | ResourceItem,
                selected?: readonly (ResourceTreeItem | ResourceItem)[],
            ) => {
                const items = ctx.resolveMarketplaceItems(clicked, selected);
                if (items.length === 0) { return; }

                let anySuccess = false;
                if (items.length === 1) {
                    anySuccess = await ctx.installationService.installResource(items[0], 'local');
                } else {
                    ctx.installationService.beginMetadataBatch();
                    await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: 'Installing resources…', cancellable: true },
                        async (progress, token) => {
                            for (let i = 0; i < items.length; i++) {
                                if (token.isCancellationRequested) { break; }
                                progress.report({ message: `${items[i].name} (${i + 1}/${items.length})`, increment: (1 / items.length) * 100 });
                                const ok = await ctx.installationService.installResource(items[i], 'local');
                                if (ok) { anySuccess = true; }
                            }
                        },
                    );
                    await ctx.installationService.flushMetadataBatch();
                }
                if (anySuccess) { await ctx.syncInstalledStatus(); }
            },
        ),

        // Install globally
        vscode.commands.registerCommand(
            'aiSkillsManager.installGlobally',
            async (
                clicked: ResourceTreeItem | ResourceItem,
                selected?: readonly (ResourceTreeItem | ResourceItem)[],
            ) => {
                const items = ctx.resolveMarketplaceItems(clicked, selected);
                if (items.length === 0) { return; }

                let anySuccess = false;
                if (items.length === 1) {
                    anySuccess = await ctx.installationService.installResource(items[0], 'global');
                } else {
                    ctx.installationService.beginMetadataBatch();
                    await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: 'Installing resources globally…', cancellable: true },
                        async (progress, token) => {
                            for (let i = 0; i < items.length; i++) {
                                if (token.isCancellationRequested) { break; }
                                progress.report({ message: `${items[i].name} (${i + 1}/${items.length})`, increment: (1 / items.length) * 100 });
                                const ok = await ctx.installationService.installResource(items[i], 'global');
                                if (ok) { anySuccess = true; }
                            }
                        },
                    );
                    await ctx.installationService.flushMetadataBatch();
                }
                if (anySuccess) { await ctx.syncInstalledStatus(); }
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
                    const resources = ctx.resolveInstalledItems(
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
                        const ok = await ctx.installationService.uninstallResourceSilent(resource);
                        if (ok) {
                            await ctx.installationService.removeInstallMetadata(resource);
                            anySuccess = true;
                        }
                    }
                    if (anySuccess) { await ctx.syncInstalledStatus(); }
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
                    installed = ctx.installedProvider
                        .getInstalledResources()
                        .find((r) => r.name === item.name);
                }

                if (installed) {
                    const success =
                        await ctx.installationService.uninstallResource(installed);
                    if (success) {
                        await ctx.installationService.removeInstallMetadata(installed);
                        await ctx.syncInstalledStatus();
                    }
                }
            },
        ),

        // Check for updates
        vscode.commands.registerCommand(
            'aiSkillsManager.checkForUpdates',
            async () => {
                await ctx.checkForUpdates();
            },
        ),

        // Update a single resource (or multiple selected)
        vscode.commands.registerCommand(
            'aiSkillsManager.updateResource',
            async (
                clicked: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                const resources = ctx.resolveInstalledItems(clicked, selected);
                if (resources.length === 0) { return; }

                let anySuccess = false;
                for (const resource of resources) {
                    const marketplaceItem = ctx.marketplaceProvider.getItemByName(resource.name);
                    const ok = await ctx.installationService.updateResource(resource, marketplaceItem);
                    if (ok) { anySuccess = true; }
                }
                if (anySuccess) {
                    await ctx.syncInstalledStatus();
                    await ctx.checkForUpdates();
                    await ctx.checkForModifications();
                }
            },
        ),

        // Update all resources with available updates
        vscode.commands.registerCommand(
            'aiSkillsManager.updateAll',
            async () => {
                const updatableNames = ctx.installedProvider.getUpdatableNames();
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

                            const resource = ctx.installedProvider.getInstalledByName(name);
                            if (!resource) {
                                continue;
                            }

                            progress.report({
                                message: `${name} (${processed + 1}/${total})`,
                                increment: (1 / total) * 100,
                            });

                            const marketplaceItem = ctx.marketplaceProvider.getItemByName(name);
                            const success = await ctx.installationService.updateResource(
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

                await ctx.syncInstalledStatus();
                await ctx.checkForUpdates();
                await ctx.checkForModifications();

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
    ];
}
