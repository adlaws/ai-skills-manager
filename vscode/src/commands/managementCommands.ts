/**
 * Management commands: move scope, copy to local, open, create, pack,
 * validate, config export/import, usage detection, repository management,
 * propose changes, revert, and suggest addition.
 */

import * as vscode from 'vscode';
import { CommandContext } from './commandContext';
import { ResourceItem, InstalledResource, ResourceRepository, ResourceCategory } from '../types';
import { ResourceTreeItem } from '../views/marketplaceProvider';
import {
    InstalledResourceTreeItem,
} from '../views/installedProvider';
import { LocalResourceTreeItem } from '../views/localProvider';

export function registerManagementCommands(
    ctx: CommandContext,
): vscode.Disposable[] {
    return [
        // Move installed resource to global
        vscode.commands.registerCommand(
            'aiSkillsManager.moveToGlobal',
            async (
                clicked: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                const resources = ctx.resolveInstalledItems(clicked, selected);
                if (resources.length === 0) { return; }

                let anySuccess = false;
                for (const resource of resources) {
                    const ok = await ctx.installationService.moveResource(resource, 'global');
                    if (ok) { anySuccess = true; }
                }
                if (anySuccess) { await ctx.syncInstalledStatus(); }
            },
        ),

        // Move installed resource to workspace
        vscode.commands.registerCommand(
            'aiSkillsManager.moveToWorkspace',
            async (
                clicked: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                const resources = ctx.resolveInstalledItems(clicked, selected);
                if (resources.length === 0) { return; }

                let anySuccess = false;
                for (const resource of resources) {
                    const ok = await ctx.installationService.moveResource(resource, 'local');
                    if (ok) { anySuccess = true; }
                }
                if (anySuccess) { await ctx.syncInstalledStatus(); }
            },
        ),

        // Copy installed resource to a local collection
        vscode.commands.registerCommand(
            'aiSkillsManager.copyToLocalCollection',
            async (
                clicked: InstalledResourceTreeItem | InstalledResource,
                selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
            ) => {
                const resources = ctx.resolveInstalledItems(clicked, selected);
                if (resources.length === 0) { return; }

                let anySuccess = false;
                for (const resource of resources) {
                    const ok = await ctx.installationService.copyToLocalCollection(resource);
                    if (ok) { anySuccess = true; }
                }
                if (anySuccess) { await ctx.localProvider.refresh(); }
            },
        ),

        // Open installed resource
        vscode.commands.registerCommand(
            'aiSkillsManager.openResource',
            async (item: InstalledResourceTreeItem) => {
                if (item?.resource) {
                    await ctx.installationService.openResource(item.resource);
                }
            },
        ),

        // Create new resource from template
        vscode.commands.registerCommand(
            'aiSkillsManager.createResource',
            async () => {
                const success = await ctx.scaffoldingService.createResource();
                if (success) {
                    await ctx.syncInstalledStatus();
                }
            },
        ),

        // Install a resource pack from file
        vscode.commands.registerCommand(
            'aiSkillsManager.installPack',
            async () => {
                const result = await ctx.packService.installPack();
                if (result.installed > 0) {
                    await ctx.syncInstalledStatus();
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
                    ? ctx.resolveInstalledItems(clicked!, selected)
                    : undefined;

                const allResources = preSelected ??
                    ctx.installedProvider.getInstalledResources();

                const resources = allResources.map((r) => ({ name: r.name, category: r.category }));
                await ctx.packService.createPack(resources);
            },
        ),

        // Validate installed resources
        vscode.commands.registerCommand(
            'aiSkillsManager.validateResources',
            async () => {
                const resources = ctx.installedProvider.getInstalledResources();
                if (resources.length === 0) {
                    vscode.window.showInformationMessage('No resources installed to validate.');
                    return;
                }

                const issues = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Validating installed resources…',
                    },
                    () => ctx.validationService.validate(resources),
                );

                await ctx.validationService.showResults(issues, resources.length);
            },
        ),

        // Export configuration
        vscode.commands.registerCommand(
            'aiSkillsManager.exportConfig',
            async () => {
                await ctx.configService.exportConfig();
            },
        ),

        // Import configuration
        vscode.commands.registerCommand(
            'aiSkillsManager.importConfig',
            async () => {
                const success = await ctx.configService.importConfig();
                if (success) {
                    await Promise.all([
                        ctx.marketplaceProvider.refresh(),
                        ctx.localProvider.refresh(),
                        ctx.installedProvider.refresh(),
                    ]);
                }
            },
        ),

        // Detect resource usage in workspace
        vscode.commands.registerCommand(
            'aiSkillsManager.detectUsage',
            async () => {
                const resources = ctx.installedProvider.getInstalledResources();
                if (resources.length === 0) {
                    vscode.window.showInformationMessage('No resources installed to check usage for.');
                    return;
                }

                const result = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Scanning workspace for resource references…',
                    },
                    () => ctx.usageDetectionService.detectUsage(resources),
                );

                await ctx.usageDetectionService.showResults(result, resources);
            },
        ),

        // Focus marketplace (used in welcome content)
        vscode.commands.registerCommand(
            'aiSkillsManager.focusMarketplace',
            () => {
                vscode.commands.executeCommand('aiSkillsManager.marketplace.focus');
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
                            ctx.marketplaceProvider.refresh();
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
                            ctx.marketplaceProvider.refresh();
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
                        ctx.marketplaceProvider.refresh();
                    } else if (action?.id === 'remove') {
                        repos.splice(idx, 1);
                        await config.update(
                            'repositories',
                            repos,
                            vscode.ConfigurationTarget.Global,
                        );
                        ctx.marketplaceProvider.refresh();
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
                try {
                    // If invoked from command palette with no args, show a quick pick
                    if (!clicked) {
                        const allInstalled = ctx.installedProvider.getInstalledResources();
                        const withSource = allInstalled.filter((r) => {
                            const meta = ctx.installedProvider.getMetadata(r.name);
                            return ctx.contributionService.canProposeChanges(r, meta);
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

                        const meta = ctx.installedProvider.getMetadata(pick.resource.name);
                        await ctx.contributionService.proposeChanges(pick.resource, meta);
                        return;
                    }

                    const resources = ctx.resolveInstalledItems(clicked, selected);
                    if (resources.length === 0) {
                        return;
                    }

                    // Only process the first resource (propose changes is inherently per-resource)
                    const resource = resources[0];
                    const meta = ctx.installedProvider.getMetadata(resource.name);
                    await ctx.contributionService.proposeChanges(resource, meta);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`Failed to propose changes: ${msg}`);
                }
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
                    const allInstalled = ctx.installedProvider.getInstalledResources();
                    const withSource = allInstalled.filter((r) => {
                        const meta = ctx.installedProvider.getMetadata(r.name);
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

                    const meta = ctx.installedProvider.getMetadata(pick.resource.name);
                    const ok = await ctx.installationService.revertResource(pick.resource, meta);
                    if (ok) {
                        await ctx.syncInstalledStatus();
                        await ctx.checkForUpdates();
                        await ctx.checkForModifications();
                    }
                    return;
                }

                const resources = ctx.resolveInstalledItems(clicked, selected);
                if (resources.length === 0) {
                    return;
                }

                // Process first resource only (revert is inherently per-resource due to diff)
                const resource = resources[0];
                const meta = ctx.installedProvider.getMetadata(resource.name);
                const ok = await ctx.installationService.revertResource(resource, meta);
                if (ok) {
                    await ctx.syncInstalledStatus();
                    await ctx.checkForUpdates();
                    await ctx.checkForModifications();
                }
            },
        ),

        // Suggest addition of a resource to a target repository
        vscode.commands.registerCommand(
            'aiSkillsManager.suggestAddition',
            async (
                clicked?: ResourceTreeItem | ResourceItem | InstalledResourceTreeItem | InstalledResource | LocalResourceTreeItem,
                selected?: readonly (ResourceTreeItem | ResourceItem | InstalledResourceTreeItem | InstalledResource | LocalResourceTreeItem)[],
            ) => {
                try {
                    // ── Resolve the resource item(s) from whichever tree was used ──
                    let name: string | undefined;
                    let category: ResourceCategory | undefined;
                    let files: { relativePath: string; content: string }[] | undefined;

                    const item = selected && selected.length > 0 ? selected[0] : clicked;
                    if (!item) {
                        return;
                    }

                    if (item instanceof ResourceTreeItem) {
                        // Marketplace item
                        const resource = item.resource;
                        name = resource.name;
                        category = resource.category;
                        // Content is lazy-loaded — fetch from GitHub
                        if (category === ResourceCategory.Skills) {
                            const skillFiles = await ctx.client.fetchSkillFiles(
                                resource.repo,
                                resource.file.path,
                            );
                            files = skillFiles.map((f) => ({ relativePath: f.path, content: f.content }));
                        } else {
                            const content = await ctx.client.fetchRawContent(
                                resource.repo.owner,
                                resource.repo.repo,
                                resource.file.path,
                                resource.repo.branch,
                            );
                            files = [{ relativePath: resource.name, content }];
                        }
                    } else if (item instanceof LocalResourceTreeItem) {
                        // Local collection item — read from disk
                        const resource = item.resource;
                        name = resource.name;
                        category = resource.category;
                        const fileUri = vscode.Uri.file(resource.file.path);
                        const isSkill = category === ResourceCategory.Skills;
                        // For skills, the file.path points to the SKILL.md; get the parent dir
                        const dirUri = isSkill
                            ? vscode.Uri.joinPath(fileUri, '..')
                            : fileUri;
                        files = await ctx.contributionService.readFilesFromDisk(dirUri, name, category);
                    } else if (item instanceof InstalledResourceTreeItem) {
                        // Installed item — read from disk via existing helper
                        const resource = item.resource;
                        name = resource.name;
                        category = resource.category;
                        files = await ctx.contributionService.readLocalFiles(resource);
                    } else if ('category' in item && 'location' in item) {
                        // Plain InstalledResource object (e.g., from command palette)
                        const resource = item as InstalledResource;
                        name = resource.name;
                        category = resource.category;
                        files = await ctx.contributionService.readLocalFiles(resource);
                    } else if ('category' in item && 'file' in item) {
                        // Plain ResourceItem object
                        const resource = item as ResourceItem;
                        name = resource.name;
                        category = resource.category;
                        if (category === ResourceCategory.Skills) {
                            const skillFiles = await ctx.client.fetchSkillFiles(
                                resource.repo,
                                resource.file.path,
                            );
                            files = skillFiles.map((f) => ({ relativePath: f.path, content: f.content }));
                        } else {
                            const content = await ctx.client.fetchRawContent(
                                resource.repo.owner,
                                resource.repo.repo,
                                resource.file.path,
                                resource.repo.branch,
                            );
                            files = [{ relativePath: resource.name, content }];
                        }
                    }

                    if (!name || !category || !files || files.length === 0) {
                        vscode.window.showErrorMessage('Could not read resource content.');
                        return;
                    }

                    // ── Pick a target repository ──
                    const config = vscode.workspace.getConfiguration('aiSkillsManager');
                    const repos = config.get<ResourceRepository[]>('repositories', [])
                        .filter((r) => r.enabled);

                    if (repos.length === 0) {
                        vscode.window.showInformationMessage(
                            'No repositories configured. Add repositories in AI Skills Manager settings.',
                        );
                        return;
                    }

                    const repoPick = await vscode.window.showQuickPick(
                        repos.map((r) => ({
                            label: r.label || `${r.owner}/${r.repo}`,
                            description: r.skillsPath ? `skills path: ${r.skillsPath}` : undefined,
                            detail: `${r.owner}/${r.repo} (${r.branch})`,
                            repo: r,
                        })),
                        {
                            placeHolder: 'Select target repository for this resource',
                            title: 'Suggest Addition',
                        },
                    );

                    if (!repoPick) {
                        return; // Cancelled
                    }

                    await ctx.contributionService.suggestAddition(name, category, files, repoPick.repo);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`Failed to suggest addition: ${msg}`);
                }
            },
        ),
    ];
}
