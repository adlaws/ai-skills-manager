/**
 * Installation Service – handles installing and uninstalling resources.
 *
 * Skills (folder-based) are downloaded as complete directories.
 * Other resources (single files) are downloaded individually.
 */

import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { ResourceItem, InstalledResource, ResourceCategory, InstallScope, LocalCollection } from '../types';
import { ResourceClient } from '../github/resourceClient';
import { PathService } from './pathService';

export class InstallationService {
    constructor(
        private readonly client: ResourceClient,
        private readonly _context: vscode.ExtensionContext,
        private readonly pathService: PathService,
    ) { }

    // ── Public API ──────────────────────────────────────────────

    /**
     * Install a marketplace resource to the configured location.
     */
    async installResource(item: ResourceItem, scope: InstallScope = 'local'): Promise<boolean> {
        if (
            item.category === ResourceCategory.Skills &&
            item.file.type === 'dir'
        ) {
            return this.installSkillFolder(item, scope);
        }
        return this.installSingleFile(item, scope);
    }

    /**
     * Uninstall an installed resource.
     */
    async uninstallResource(resource: InstalledResource): Promise<boolean> {
        const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(
            resource.location,
        );

        if (
            this.pathService.requiresWorkspaceFolder(resource.location) &&
            !workspaceFolder
        ) {
            return false;
        }

        const isFolder = resource.category === ResourceCategory.Skills;

        const confirm = await vscode.window.showWarningMessage(
            `Remove "${resource.name}"? This will delete the ${isFolder ? 'folder' : 'file'}.`,
            { modal: true },
            'Remove',
        );

        if (confirm !== 'Remove') {
            return false;
        }

        try {
            const uri = this.pathService.resolveLocationToUri(
                resource.location,
                workspaceFolder,
            );
            if (!uri) {
                vscode.window.showErrorMessage(
                    'Failed to resolve resource location.',
                );
                return false;
            }
            await vscode.workspace.fs.delete(uri, {
                recursive: true,
                useTrash: true,
            });
            vscode.window.showInformationMessage(`Removed "${resource.name}"`);
            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to remove: ${msg}`);
            return false;
        }
    }

    /**
     * Open an installed resource in the editor / explorer.
     */
    async openResource(resource: InstalledResource): Promise<void> {
        const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(
            resource.location,
        );
        const uri = this.pathService.resolveLocationToUri(
            resource.location,
            workspaceFolder,
        );

        if (!uri) {
            vscode.window.showErrorMessage(
                'Failed to resolve resource location.',
            );
            return;
        }

        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type & vscode.FileType.Directory) {
                const skillMd = vscode.Uri.joinPath(uri, 'SKILL.md');
                try {
                    await vscode.workspace.fs.stat(skillMd);
                    await vscode.window.showTextDocument(skillMd);
                } catch {
                    await vscode.commands.executeCommand(
                        'revealInExplorer',
                        uri,
                    );
                }
            } else {
                await vscode.window.showTextDocument(uri);
            }
        } catch {
            vscode.window.showErrorMessage('Failed to open resource.');
        }
    }

    /**
     * Install a resource from a local collection (copy from source path to install location).
     */
    async installFromLocal(item: ResourceItem, scope: InstallScope = 'local'): Promise<boolean> {
        const isSkill =
            item.category === ResourceCategory.Skills &&
            item.file.type === 'dir';

        const targetUri = this.resolveTarget(item, scope);
        if (!targetUri) {
            return false;
        }

        const sourceUri = vscode.Uri.file(item.file.path);

        if (isSkill) {
            if (await this.promptOverwriteDir(targetUri, item.name)) {
                return false;
            }
        } else {
            try {
                await vscode.workspace.fs.stat(targetUri);
                const overwrite = await vscode.window.showWarningMessage(
                    `"${item.name}" already exists. Overwrite?`,
                    { modal: true },
                    'Overwrite',
                );
                if (overwrite !== 'Overwrite') {
                    return false;
                }
            } catch {
                // Doesn't exist yet – proceed
            }
        }

        try {
            const parentDir = vscode.Uri.joinPath(targetUri, '..');
            await vscode.workspace.fs.createDirectory(parentDir);
            await vscode.workspace.fs.copy(sourceUri, targetUri, {
                overwrite: true,
            });

            const scopeLabel = scope === 'global' ? 'globally' : 'to workspace';
            vscode.window.showInformationMessage(
                `Installed "${item.name}" ${scopeLabel}`,
            );
            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to install: ${msg}`);
            return false;
        }
    }

    /**
     * Copy an installed resource into a local collection's category folder.
     */
    async copyToLocalCollection(resource: InstalledResource): Promise<boolean> {
        const collections = this.getEnabledLocalCollections();
        if (collections.length === 0) {
            vscode.window.showWarningMessage(
                'No local collections configured. Add one via Settings (`aiSkillsManager.localCollections`).',
            );
            return false;
        }

        // Resolve the source URI
        const sourceWf = this.pathService.getWorkspaceFolderForLocation(resource.location);
        const sourceUri = this.pathService.resolveLocationToUri(resource.location, sourceWf);
        if (!sourceUri) {
            vscode.window.showErrorMessage('Failed to resolve resource location.');
            return false;
        }

        // Pick a collection if more than one
        let collection: LocalCollection;
        if (collections.length === 1) {
            collection = collections[0];
        } else {
            const pick = await vscode.window.showQuickPick(
                collections.map((c) => ({
                    label: c.label || path.basename(c.path),
                    description: c.path,
                    collection: c,
                })),
                {
                    placeHolder: 'Select a local collection to copy to',
                    title: 'Copy to Local Collection',
                },
            );
            if (!pick) {
                return false;
            }
            collection = pick.collection;
        }

        // Resolve collection root
        const collectionRoot = this.resolveCollectionPath(collection.path);
        if (!collectionRoot) {
            vscode.window.showErrorMessage('Failed to resolve collection path.');
            return false;
        }

        // Target: <collection>/<category>/<resourceName>
        const targetUri = vscode.Uri.joinPath(
            collectionRoot,
            resource.category,
            resource.name,
        );

        // Check for overwrite
        try {
            await vscode.workspace.fs.stat(targetUri);
            const overwrite = await vscode.window.showWarningMessage(
                `"${resource.name}" already exists in "${collection.label || path.basename(collection.path)}". Overwrite?`,
                { modal: true },
                'Overwrite',
            );
            if (overwrite !== 'Overwrite') {
                return false;
            }
            await vscode.workspace.fs.delete(targetUri, { recursive: true });
        } catch {
            // Doesn't exist – proceed
        }

        try {
            // Ensure category directory exists
            const categoryDir = vscode.Uri.joinPath(collectionRoot, resource.category);
            await vscode.workspace.fs.createDirectory(categoryDir);

            await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: true });

            vscode.window.showInformationMessage(
                `Copied "${resource.name}" to ${collection.label || path.basename(collection.path)}`,
            );
            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to copy: ${msg}`);
            return false;
        }
    }

    /**
     * Move an installed resource between global and local scope.
     */
    async moveResource(
        resource: InstalledResource,
        targetScope: InstallScope,
    ): Promise<boolean> {
        const sourceWf = this.pathService.getWorkspaceFolderForLocation(
            resource.location,
        );
        const sourceUri = this.pathService.resolveLocationToUri(
            resource.location,
            sourceWf,
        );
        if (!sourceUri) {
            vscode.window.showErrorMessage('Failed to resolve source location.');
            return false;
        }

        const targetInstallLocation = this.pathService.getInstallLocationForScope(
            resource.category,
            targetScope,
        );
        const targetWf =
            this.pathService.getWorkspaceFolderForLocation(targetInstallLocation);

        if (
            this.pathService.requiresWorkspaceFolder(targetInstallLocation) &&
            !targetWf
        ) {
            vscode.window.showErrorMessage(
                'No workspace folder open. Please open a folder first.',
            );
            return false;
        }

        const targetUri = this.pathService.resolveInstallTargetForScope(
            resource.category,
            resource.name,
            targetScope,
            targetWf,
        );
        if (!targetUri) {
            vscode.window.showErrorMessage(
                'Failed to resolve target install location.',
            );
            return false;
        }

        const scopeLabel = targetScope === 'global' ? 'Global' : 'Workspace';
        const isFolder = resource.category === ResourceCategory.Skills;

        try {
            // Check if target already exists
            try {
                await vscode.workspace.fs.stat(targetUri);
                const overwrite = await vscode.window.showWarningMessage(
                    `"${resource.name}" already exists at the ${scopeLabel.toLowerCase()} location. Overwrite?`,
                    { modal: true },
                    'Overwrite',
                );
                if (overwrite !== 'Overwrite') {
                    return false;
                }
                await vscode.workspace.fs.delete(targetUri, {
                    recursive: true,
                });
            } catch {
                // doesn't exist – good
            }

            // Create parent directories
            const parentDir = vscode.Uri.joinPath(targetUri, '..');
            await vscode.workspace.fs.createDirectory(parentDir);

            // Copy
            await vscode.workspace.fs.copy(sourceUri, targetUri, {
                overwrite: true,
            });

            // Remove source
            await vscode.workspace.fs.delete(sourceUri, {
                recursive: isFolder,
                useTrash: true,
            });

            vscode.window.showInformationMessage(
                `Moved "${resource.name}" to ${scopeLabel}`,
            );
            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
                `Failed to move resource: ${msg}`,
            );
            return false;
        }
    }

    // ── Private: Skill folder installation ──────────────────────

    private async installSkillFolder(item: ResourceItem, scope: InstallScope): Promise<boolean> {
        const targetDir = this.resolveTarget(item, scope);
        if (!targetDir) {
            return false;
        }

        if (await this.promptOverwriteDir(targetDir, item.name)) {
            return false;
        }

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing ${item.name}…`,
                cancellable: true,
            },
            async (progress, token) => {
                try {
                    progress.report({ increment: 0, message: 'Fetching files…' });

                    if (token.isCancellationRequested) {
                        return false;
                    }

                    let files: { path: string; content: string }[];

                    if (item.repo.skillsPath) {
                        files = await this.client.fetchSkillFiles(
                            item.repo,
                            item.file.path,
                        );
                    } else {
                        const dirContents =
                            await this.client.fetchDirectoryContents(
                                item.repo,
                                item.file.path,
                            );
                        const fileEntries = dirContents.filter(
                            (f) => f.type === 'file',
                        );
                        files = await Promise.all(
                            fileEntries.map(async (f) => {
                                const basePath = item.file.path + '/';
                                const relativePath = f.path.startsWith(basePath)
                                    ? f.path.substring(basePath.length)
                                    : f.name;
                                const content =
                                    await this.client.fetchFileContent(
                                        f.download_url,
                                    );
                                return { path: relativePath, content };
                            }),
                        );
                    }

                    if (token.isCancellationRequested) {
                        return false;
                    }

                    progress.report({
                        increment: 50,
                        message: 'Writing files…',
                    });

                    await vscode.workspace.fs.createDirectory(targetDir);

                    let written = 0;
                    for (const file of files) {
                        if (token.isCancellationRequested) {
                            await vscode.workspace.fs.delete(targetDir, {
                                recursive: true,
                            });
                            return false;
                        }

                        const filePath = vscode.Uri.joinPath(
                            targetDir,
                            file.path,
                        );
                        const parentDir = vscode.Uri.joinPath(filePath, '..');
                        await vscode.workspace.fs.createDirectory(parentDir);
                        await vscode.workspace.fs.writeFile(
                            filePath,
                            new TextEncoder().encode(file.content),
                        );

                        written++;
                        progress.report({
                            increment: 50 * (written / files.length),
                            message: `Writing ${file.path}…`,
                        });
                    }

                    vscode.window.showInformationMessage(
                        `Installed skill "${item.name}"`,
                    );
                    return true;
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(
                        `Failed to install: ${msg}`,
                    );
                    try {
                        await vscode.workspace.fs.delete(targetDir, {
                            recursive: true,
                        });
                    } catch {
                        // ignore cleanup errors
                    }
                    return false;
                }
            },
        );
    }

    // ── Private: Single file installation ───────────────────────

    private async installSingleFile(item: ResourceItem, scope: InstallScope): Promise<boolean> {
        const targetFile = this.resolveTarget(item, scope);
        if (!targetFile) {
            return false;
        }

        try {
            await vscode.workspace.fs.stat(targetFile);
            const overwrite = await vscode.window.showWarningMessage(
                `"${item.name}" already exists. Overwrite?`,
                { modal: true },
                'Overwrite',
            );
            if (overwrite !== 'Overwrite') {
                return false;
            }
        } catch {
            // Doesn't exist yet
        }

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Downloading ${item.name}…`,
                cancellable: false,
            },
            async (progress) => {
                try {
                    progress.report({
                        increment: 0,
                        message: 'Fetching content…',
                    });
                    const content = await this.client.fetchFileContent(
                        item.file.download_url,
                    );

                    progress.report({
                        increment: 50,
                        message: 'Writing file…',
                    });
                    const parentDir = vscode.Uri.joinPath(targetFile, '..');
                    await vscode.workspace.fs.createDirectory(parentDir);
                    await vscode.workspace.fs.writeFile(
                        targetFile,
                        new TextEncoder().encode(content),
                    );

                    const openChoice =
                        await vscode.window.showInformationMessage(
                            `Downloaded "${item.name}"`,
                            'Open File',
                        );
                    if (openChoice === 'Open File') {
                        await vscode.window.showTextDocument(targetFile);
                    }
                    return true;
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(
                        `Failed to download: ${msg}`,
                    );
                    return false;
                }
            },
        );
    }

    // ── Helpers ─────────────────────────────────────────────────

    private resolveTarget(item: ResourceItem, scope: InstallScope = 'local'): vscode.Uri | undefined {
        const installLocation = this.pathService.getInstallLocationForScope(
            item.category,
            scope,
        );
        const workspaceFolder =
            this.pathService.getWorkspaceFolderForLocation(installLocation);

        if (
            this.pathService.requiresWorkspaceFolder(installLocation) &&
            !workspaceFolder
        ) {
            vscode.window.showErrorMessage(
                'No workspace folder open. Please open a folder first.',
            );
            return undefined;
        }

        const target = this.pathService.resolveInstallTargetForScope(
            item.category,
            item.name,
            scope,
            workspaceFolder,
        );
        if (!target) {
            vscode.window.showErrorMessage(
                'Failed to resolve install location.',
            );
            return undefined;
        }
        return target;
    }

    /**
     * Check whether the target directory already exists and prompt for overwrite.
     * Returns `true` if the user cancelled (i.e. do NOT proceed).
     */
    private async promptOverwriteDir(
        targetDir: vscode.Uri,
        name: string,
    ): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(targetDir);
            const overwrite = await vscode.window.showWarningMessage(
                `"${name}" is already installed. Overwrite?`,
                { modal: true },
                'Overwrite',
            );
            if (overwrite !== 'Overwrite') {
                return true;
            }
            await vscode.workspace.fs.delete(targetDir, { recursive: true });
            return false;
        } catch {
            return false;
        }
    }

    private getEnabledLocalCollections(): LocalCollection[] {
        const config = vscode.workspace.getConfiguration('aiSkillsManager');
        const collections = config.get<LocalCollection[]>('localCollections', []);
        return collections.filter((c) => c.enabled !== false);
    }

    private resolveCollectionPath(collectionPath: string): vscode.Uri | undefined {
        const trimmed = collectionPath.trim();
        if (!trimmed) {
            return undefined;
        }
        if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
            const resolved = path.join(
                os.homedir(),
                trimmed.slice(1).replace(/^[/\\]+/, ''),
            );
            return vscode.Uri.file(resolved);
        }
        if (path.isAbsolute(trimmed)) {
            return vscode.Uri.file(trimmed);
        }
        const wf = vscode.workspace.workspaceFolders?.[0];
        if (!wf) {
            return undefined;
        }
        return vscode.Uri.joinPath(wf.uri, trimmed);
    }
}
