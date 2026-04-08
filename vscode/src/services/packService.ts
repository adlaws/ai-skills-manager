/**
 * Pack Service – install and create resource packs.
 *
 * A resource pack is a JSON file listing resources (by name) that should
 * be installed together. Packs can be loaded from a local file or created
 * from the set of currently installed resources.
 */

import * as vscode from 'vscode';
import { ResourcePack, PackResourceRef, ResourceItem, InstallScope, CATEGORY_LABELS, ResourceCategory } from '../types';
import { InstallationService } from './installationService';

export class PackService {
    constructor(
        private readonly installationService: InstallationService,
        private readonly getMarketplaceItems: () => ResourceItem[],
        private readonly getLocalItems: () => ResourceItem[],
    ) { }

    /**
     * Prompt the user to pick a pack file and install all resources in it.
     */
    async installPack(): Promise<{ installed: number; failed: number; skipped: number }> {
        const result = { installed: 0, failed: 0, skipped: 0 };

        // 1. Pick a pack file
        const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'Resource Pack': ['json'] },
            openLabel: 'Select Pack File',
            title: 'Install Resource Pack',
        });

        if (!fileUris || fileUris.length === 0) {
            return result;
        }

        // 2. Read and parse the pack file
        let pack: ResourcePack;
        try {
            const raw = new TextDecoder().decode(
                await vscode.workspace.fs.readFile(fileUris[0]),
            );
            pack = JSON.parse(raw);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to read pack file: ${msg}`);
            return result;
        }

        if (!pack.resources || !Array.isArray(pack.resources) || pack.resources.length === 0) {
            vscode.window.showWarningMessage('Pack file contains no resources.');
            return result;
        }

        // 3. Pick scope
        const scopePick = await vscode.window.showQuickPick(
            [
                { label: '$(folder) Workspace', scope: 'local' as InstallScope },
                { label: '$(home) Global', scope: 'global' as InstallScope },
            ],
            {
                placeHolder: 'Where should the pack resources be installed?',
                title: `Install Pack: ${pack.name} (${pack.resources.length} resources)`,
            },
        );

        if (!scopePick) {
            return result;
        }

        const scope = scopePick.scope;

        // 4. Resolve each resource reference to an actual item
        const allMarketplace = this.getMarketplaceItems();
        const allLocal = this.getLocalItems();

        // Batch metadata writes for all resources in the pack
        this.installationService.beginMetadataBatch();

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing pack "${pack.name}"…`,
                cancellable: true,
            },
            async (progress, token) => {
                const total = pack.resources.length;
                let processed = 0;

                for (const ref of pack.resources) {
                    if (token.isCancellationRequested) {
                        break;
                    }

                    progress.report({
                        message: `${ref.name} (${processed + 1}/${total})`,
                        increment: (1 / total) * 100,
                    });

                    const item = this.resolvePackRef(ref, allMarketplace, allLocal);

                    if (!item) {
                        result.skipped++;
                        console.warn(`Pack: resource "${ref.name}" not found in marketplace or local collections — skipped`);
                        processed++;
                        continue;
                    }

                    try {
                        // Determine if this is from local or marketplace
                        const isLocalItem = item.file.path && !item.file.download_url;
                        let success: boolean;

                        if (isLocalItem) {
                            success = await this.installationService.installFromLocal(item, scope);
                        } else {
                            success = await this.installationService.installResource(item, scope);
                        }

                        if (success) {
                            result.installed++;
                        } else {
                            result.failed++;
                        }
                    } catch {
                        result.failed++;
                    }

                    processed++;
                }
            },
        );

        // Flush all queued metadata writes (one per category file)
        await this.installationService.flushMetadataBatch();

        // 5. Report results
        const parts: string[] = [];
        if (result.installed > 0) {
            parts.push(`${result.installed} installed`);
        }
        if (result.skipped > 0) {
            parts.push(`${result.skipped} not found`);
        }
        if (result.failed > 0) {
            parts.push(`${result.failed} failed`);
        }

        const msgFn = result.failed > 0
            ? vscode.window.showWarningMessage
            : vscode.window.showInformationMessage;
        msgFn(`Pack "${pack.name}": ${parts.join(', ')}.`);

        return result;
    }

    /**
     * Create a pack file from the currently installed resources.
     */
    async createPack(
        installedResources: { name: string; category: ResourceCategory }[],
    ): Promise<boolean> {
        if (installedResources.length === 0) {
            vscode.window.showWarningMessage('No resources installed to create a pack from.');
            return false;
        }

        // 1. Pick which resources to include
        const picks = await vscode.window.showQuickPick(
            installedResources.map((r) => ({
                label: r.name,
                description: CATEGORY_LABELS[r.category],
                picked: true,
                resource: r,
            })),
            {
                canPickMany: true,
                placeHolder: 'Select which resources to include in the pack',
                title: 'Create Resource Pack',
            },
        );

        if (!picks || picks.length === 0) {
            return false;
        }

        // 2. Enter pack name
        const packName = await vscode.window.showInputBox({
            prompt: 'Enter a name for this resource pack',
            placeHolder: 'e.g. Python AI Starter Pack',
            validateInput: (v) => v.trim() ? null : 'Name is required',
        });

        if (!packName) {
            return false;
        }

        // 3. Optional description
        const description = await vscode.window.showInputBox({
            prompt: 'Optional description for this pack',
            placeHolder: 'e.g. Essential AI resources for Python development',
        });

        // 4. Build the pack manifest
        const pack: ResourcePack = {
            name: packName.trim(),
            description: description?.trim() || undefined,
            resources: picks.map((p) => {
                const ref: PackResourceRef = { name: p.resource.name };
                if (p.resource.category) {
                    ref.category = p.resource.category;
                }
                return ref;
            }),
        };

        // 5. Save the file
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(
                `${packName.trim().replace(/\s+/g, '-').toLowerCase()}.pack.json`,
            ),
            filters: { 'Resource Pack': ['json'] },
            title: 'Save Resource Pack',
        });

        if (!saveUri) {
            return false;
        }

        try {
            await vscode.workspace.fs.writeFile(
                saveUri,
                new TextEncoder().encode(JSON.stringify(pack, null, 2)),
            );
            const openChoice = await vscode.window.showInformationMessage(
                `Created pack "${packName}" with ${picks.length} resources.`,
                'Open File',
            );
            if (openChoice === 'Open File') {
                await vscode.window.showTextDocument(saveUri);
            }
            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to save pack file: ${msg}`);
            return false;
        }
    }

    // ── Private helpers ─────────────────────────────────────────

    private resolvePackRef(
        ref: PackResourceRef,
        marketplace: ResourceItem[],
        local: ResourceItem[],
    ): ResourceItem | undefined {
        // Try marketplace first (richer metadata), then local
        const sources = [...marketplace, ...local];

        return sources.find((item) => {
            if (item.name !== ref.name) {
                return false;
            }
            if (ref.category && item.category !== ref.category) {
                return false;
            }
            if (ref.repo) {
                const itemRepo = `${item.repo.owner}/${item.repo.repo}`;
                if (itemRepo !== ref.repo) {
                    return false;
                }
            }
            return true;
        });
    }
}
