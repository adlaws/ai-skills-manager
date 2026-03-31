/**
 * Config Service – export and import full extension configuration.
 *
 * Serialises repositories, local collections, install locations,
 * and favorites to a JSON file that can be shared or applied on
 * another machine.
 */

import * as vscode from 'vscode';
import { ResourceRepository, LocalCollection, ALL_CATEGORIES } from '../types';

// ── Exported config shape ───────────────────────────────────────

interface ExportedConfig {
    version: 1;
    exportedAt: string;
    repositories?: ResourceRepository[];
    localCollections?: LocalCollection[];
    installLocations?: Record<string, string>;
    globalInstallLocations?: Record<string, string>;
    favorites?: string[];
    cacheTimeout?: number;
    githubToken?: string; // excluded by default
}

// ── Service ─────────────────────────────────────────────────────

export class ConfigService {
    constructor(private readonly context: vscode.ExtensionContext) { }

    /**
     * Export the current configuration to a JSON file.
     */
    async exportConfig(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('aiSkillsManager');

        // Gather configuration
        const exported: ExportedConfig = {
            version: 1,
            exportedAt: new Date().toISOString(),
        };

        // Repositories
        const repos = config.get<ResourceRepository[]>('repositories');
        if (repos && repos.length > 0) {
            exported.repositories = repos;
        }

        // Local collections (without absolute paths by default – warn user)
        const collections = config.get<LocalCollection[]>('localCollections');
        if (collections && collections.length > 0) {
            exported.localCollections = collections;
        }

        // Install locations (only non-default)
        const installLocations: Record<string, string> = {};
        const globalInstallLocations: Record<string, string> = {};

        for (const category of ALL_CATEGORIES) {
            const local = config.get<string>(`installLocation.${category}`);
            if (local) {
                installLocations[category] = local;
            }
            const global = config.get<string>(`globalInstallLocation.${category}`);
            if (global) {
                globalInstallLocations[category] = global;
            }
        }

        if (Object.keys(installLocations).length > 0) {
            exported.installLocations = installLocations;
        }
        if (Object.keys(globalInstallLocations).length > 0) {
            exported.globalInstallLocations = globalInstallLocations;
        }

        // Favorites
        const favorites = this.context.globalState.get<string[]>(
            'aiSkillsManager.favorites',
            [],
        );
        if (favorites.length > 0) {
            exported.favorites = favorites;
        }

        // Cache timeout
        const cacheTimeout = config.get<number>('cacheTimeout');
        if (cacheTimeout !== undefined && cacheTimeout !== 3600) {
            exported.cacheTimeout = cacheTimeout;
        }

        // Save to file
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('ai-skills-manager-config.json'),
            filters: { 'JSON Configuration': ['json'] },
            title: 'Export Configuration',
        });

        if (!saveUri) {
            return false;
        }

        try {
            await vscode.workspace.fs.writeFile(
                saveUri,
                new TextEncoder().encode(JSON.stringify(exported, null, 2)),
            );
            const action = await vscode.window.showInformationMessage(
                'Configuration exported successfully.',
                'Open File',
            );
            if (action === 'Open File') {
                await vscode.window.showTextDocument(saveUri);
            }
            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to export: ${msg}`);
            return false;
        }
    }

    /**
     * Import configuration from a JSON file.
     */
    async importConfig(): Promise<boolean> {
        const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'JSON Configuration': ['json'] },
            openLabel: 'Import',
            title: 'Import Configuration',
        });

        if (!fileUris || fileUris.length === 0) {
            return false;
        }

        let imported: ExportedConfig;
        try {
            const raw = new TextDecoder().decode(
                await vscode.workspace.fs.readFile(fileUris[0]),
            );
            imported = JSON.parse(raw);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to read config file: ${msg}`);
            return false;
        }

        if (!imported.version || imported.version !== 1) {
            vscode.window.showErrorMessage('Unsupported configuration file format.');
            return false;
        }

        // Let user pick what to import
        const options: { label: string; id: string; picked: boolean }[] = [];

        if (imported.repositories) {
            options.push({
                label: `Repositories (${imported.repositories.length})`,
                id: 'repositories',
                picked: true,
            });
        }
        if (imported.localCollections) {
            options.push({
                label: `Local Collections (${imported.localCollections.length})`,
                id: 'localCollections',
                picked: true,
            });
        }
        if (imported.installLocations || imported.globalInstallLocations) {
            options.push({
                label: 'Install Locations',
                id: 'installLocations',
                picked: true,
            });
        }
        if (imported.favorites) {
            options.push({
                label: `Favorites (${imported.favorites.length})`,
                id: 'favorites',
                picked: true,
            });
        }
        if (imported.cacheTimeout !== undefined) {
            options.push({
                label: `Cache Timeout (${imported.cacheTimeout}s)`,
                id: 'cacheTimeout',
                picked: true,
            });
        }

        if (options.length === 0) {
            vscode.window.showWarningMessage('Configuration file is empty.');
            return false;
        }

        const picks = await vscode.window.showQuickPick(options, {
            canPickMany: true,
            placeHolder: 'Select which settings to import',
            title: `Import from ${imported.exportedAt ? new Date(imported.exportedAt).toLocaleDateString() : 'unknown date'}`,
        });

        if (!picks || picks.length === 0) {
            return false;
        }

        // Ask about merge strategy for repos/collections
        let mergeStrategy: 'replace' | 'merge' = 'replace';
        const hasList = picks.some((p) =>
            p.id === 'repositories' || p.id === 'localCollections',
        );
        if (hasList) {
            const strategy = await vscode.window.showQuickPick(
                [
                    {
                        label: 'Merge',
                        description: 'Add new entries, keep existing ones',
                        id: 'merge' as const,
                    },
                    {
                        label: 'Replace',
                        description: 'Replace existing entries entirely',
                        id: 'replace' as const,
                    },
                ],
                { placeHolder: 'How should lists be handled?' },
            );
            if (!strategy) {
                return false;
            }
            mergeStrategy = strategy.id;
        }

        const selectedIds = new Set(picks.map((p) => p.id));
        const config = vscode.workspace.getConfiguration('aiSkillsManager');

        try {
            // Repositories
            if (selectedIds.has('repositories') && imported.repositories) {
                if (mergeStrategy === 'merge') {
                    const existing = config.get<ResourceRepository[]>('repositories', []);
                    const existingKeys = new Set(
                        existing.map((r) => `${r.owner}/${r.repo}`),
                    );
                    const newRepos = imported.repositories.filter(
                        (r) => !existingKeys.has(`${r.owner}/${r.repo}`),
                    );
                    await config.update(
                        'repositories',
                        [...existing, ...newRepos],
                        vscode.ConfigurationTarget.Global,
                    );
                } else {
                    await config.update(
                        'repositories',
                        imported.repositories,
                        vscode.ConfigurationTarget.Global,
                    );
                }
            }

            // Local collections
            if (selectedIds.has('localCollections') && imported.localCollections) {
                if (mergeStrategy === 'merge') {
                    const existing = config.get<LocalCollection[]>('localCollections', []);
                    const existingPaths = new Set(existing.map((c) => c.path));
                    const newCollections = imported.localCollections.filter(
                        (c) => !existingPaths.has(c.path),
                    );
                    await config.update(
                        'localCollections',
                        [...existing, ...newCollections],
                        vscode.ConfigurationTarget.Global,
                    );
                } else {
                    await config.update(
                        'localCollections',
                        imported.localCollections,
                        vscode.ConfigurationTarget.Global,
                    );
                }
            }

            // Install locations
            if (selectedIds.has('installLocations')) {
                if (imported.installLocations) {
                    for (const [cat, loc] of Object.entries(imported.installLocations)) {
                        await config.update(
                            `installLocation.${cat}`,
                            loc,
                            vscode.ConfigurationTarget.Global,
                        );
                    }
                }
                if (imported.globalInstallLocations) {
                    for (const [cat, loc] of Object.entries(imported.globalInstallLocations)) {
                        await config.update(
                            `globalInstallLocation.${cat}`,
                            loc,
                            vscode.ConfigurationTarget.Global,
                        );
                    }
                }
            }

            // Favorites
            if (selectedIds.has('favorites') && imported.favorites) {
                const existing = this.context.globalState.get<string[]>(
                    'aiSkillsManager.favorites',
                    [],
                );
                const merged = [...new Set([...existing, ...imported.favorites])];
                await this.context.globalState.update(
                    'aiSkillsManager.favorites',
                    merged,
                );
            }

            // Cache timeout
            if (selectedIds.has('cacheTimeout') && imported.cacheTimeout !== undefined) {
                await config.update(
                    'cacheTimeout',
                    imported.cacheTimeout,
                    vscode.ConfigurationTarget.Global,
                );
            }

            vscode.window.showInformationMessage(
                `Imported ${picks.length} configuration section${picks.length !== 1 ? 's' : ''} successfully.`,
            );
            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to import: ${msg}`);
            return false;
        }
    }
}
