/**
 * Installation Service – handles installing and uninstalling resources.
 *
 * Skills (folder-based) are downloaded as complete directories.
 * Other resources (single files) are downloaded individually.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { ResourceItem, InstalledResource, ResourceCategory, InstallScope, LocalCollection, InstallMetadata } from '../types';
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
        let result: boolean;
        if (
            item.category === ResourceCategory.Skills &&
            item.file.type === 'dir'
        ) {
            result = await this.installSkillFolder(item, scope);
        } else {
            result = await this.installSingleFile(item, scope);
        }

        // Persist install metadata (SHA + source repo) for update detection
        if (result && item.file.sha && item.repo?.owner && item.repo?.repo) {
            await this.saveInstallMetadata(item, scope);
        }

        return result;
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

        return this.deleteResource(resource, workspaceFolder);
    }

    /**
     * Uninstall an installed resource without prompting for confirmation.
     * Used for bulk operations where the caller has already confirmed.
     */
    async uninstallResourceSilent(resource: InstalledResource): Promise<boolean> {
        const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(
            resource.location,
        );

        if (
            this.pathService.requiresWorkspaceFolder(resource.location) &&
            !workspaceFolder
        ) {
            return false;
        }

        return this.deleteResource(resource, workspaceFolder);
    }

    /** Shared deletion logic for uninstallResource and uninstallResourceSilent. */
    private async deleteResource(
        resource: InstalledResource,
        workspaceFolder: vscode.WorkspaceFolder | undefined,
    ): Promise<boolean> {
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
            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to remove "${resource.name}": ${msg}`);
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
                const action = await vscode.window.showWarningMessage(
                    `"${item.name}" already exists. What would you like to do?`,
                    { modal: true },
                    'Overwrite',
                    'Compare',
                );
                if (action === 'Compare') {
                    await vscode.commands.executeCommand(
                        'vscode.diff',
                        targetUri,
                        sourceUri,
                        `${item.name}: Installed ↔ Incoming`,
                    );
                    const confirm = await vscode.window.showInformationMessage(
                        `Overwrite "${item.name}" with the incoming version?`,
                        'Overwrite',
                        'Cancel',
                    );
                    if (confirm !== 'Overwrite') {
                        return false;
                    }
                } else if (action !== 'Overwrite') {
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

        const result = await vscode.window.withProgress(
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

        if (result) {
            vscode.window.showInformationMessage(
                `Installed skill "${item.name}"`,
            );
        }

        return result;
    }

    // ── Private: Single file installation ───────────────────────

    private async installSingleFile(item: ResourceItem, scope: InstallScope): Promise<boolean> {
        const targetFile = this.resolveTarget(item, scope);
        if (!targetFile) {
            return false;
        }

        let existsOnDisk = false;
        try {
            await vscode.workspace.fs.stat(targetFile);
            existsOnDisk = true;
        } catch {
            // Doesn't exist yet
        }

        if (existsOnDisk) {
            const action = await vscode.window.showWarningMessage(
                `"${item.name}" already exists. What would you like to do?`,
                { modal: true },
                'Overwrite',
                'Compare',
            );
            if (action === 'Compare') {
                // Fetch the new content and show diff
                try {
                    const newContent = await this.client.fetchFileContent(
                        item.file.download_url,
                    );
                    const tempUri = vscode.Uri.parse(
                        `untitled:${item.name}.incoming`,
                    );
                    await vscode.workspace.openTextDocument(tempUri);
                    const edit = new vscode.WorkspaceEdit();
                    edit.insert(tempUri, new vscode.Position(0, 0), newContent);
                    await vscode.workspace.applyEdit(edit);

                    await vscode.commands.executeCommand(
                        'vscode.diff',
                        targetFile,
                        tempUri,
                        `${item.name}: Local ↔ Incoming`,
                    );

                    // After viewing the diff, ask again
                    const confirm = await vscode.window.showInformationMessage(
                        `Overwrite "${item.name}" with the incoming version?`,
                        'Overwrite',
                        'Cancel',
                    );
                    if (confirm !== 'Overwrite') {
                        return false;
                    }
                } catch {
                    // Fall through to normal install if diff fails
                }
            } else if (action !== 'Overwrite') {
                return false;
            }
        }

        const result = await vscode.window.withProgress(
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

        if (result) {
            const openChoice =
                await vscode.window.showInformationMessage(
                    `Downloaded "${item.name}"`,
                    'Open File',
                );
            if (openChoice === 'Open File') {
                await vscode.window.showTextDocument(targetFile);
            }
        }

        return result;
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
     * For skills, offers a "Compare" option that diffs SKILL.md files.
     * Returns `true` if the user cancelled (i.e. do NOT proceed).
     */
    private async promptOverwriteDir(
        targetDir: vscode.Uri,
        name: string,
    ): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(targetDir);
            const action = await vscode.window.showWarningMessage(
                `"${name}" is already installed. What would you like to do?`,
                { modal: true },
                'Overwrite',
                'Compare SKILL.md',
            );

            if (action === 'Compare SKILL.md') {
                // Show diff of SKILL.md (local vs installed)
                const localSkillMd = vscode.Uri.joinPath(targetDir, 'SKILL.md');
                try {
                    await vscode.workspace.fs.stat(localSkillMd);
                    // Show the existing SKILL.md file — the incoming one isn't yet
                    // available as a file. Just open the installed one so the user
                    // can review it before deciding.
                    await vscode.window.showTextDocument(localSkillMd);
                    const confirm = await vscode.window.showInformationMessage(
                        `This is the currently installed SKILL.md for "${name}". Overwrite with the new version?`,
                        'Overwrite',
                        'Cancel',
                    );
                    if (confirm !== 'Overwrite') {
                        return true;
                    }
                } catch {
                    // No existing SKILL.md — proceed with overwrite
                }
            } else if (action !== 'Overwrite') {
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

    // ── Install metadata persistence ────────────────────────────

    private static readonly META_FILENAME = '.ai-skills-meta.json';

    /**
     * Compute a SHA-256 content hash for a resource on disk.
     * For single files: hash of the file content.
     * For skills (directories): sorted (relativePath + content) pairs hashed together.
     */
    async computeContentHash(
        location: string,
        category: ResourceCategory,
    ): Promise<string | undefined> {
        try {
            const wf = this.pathService.getWorkspaceFolderForLocation(location);
            const uri = this.pathService.resolveLocationToUri(location, wf);
            if (!uri) { return undefined; }

            const isSkill = category === ResourceCategory.Skills;

            if (isSkill) {
                return this.computeDirectoryHash(uri);
            } else {
                const content = await vscode.workspace.fs.readFile(uri);
                return crypto.createHash('sha256').update(content).digest('hex');
            }
        } catch {
            return undefined;
        }
    }

    /**
     * Compute a SHA-256 hash for a directory by hashing all file contents
     * sorted by relative path. Uses the same algorithm at install time and
     * check time for consistency.
     */
    private async computeDirectoryHash(dirUri: vscode.Uri): Promise<string> {
        const entries: { relativePath: string; content: Uint8Array }[] = [];
        await this.collectFiles(dirUri, dirUri, entries);
        entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

        const hash = crypto.createHash('sha256');
        for (const entry of entries) {
            hash.update(entry.relativePath);
            hash.update(entry.content);
        }
        return hash.digest('hex');
    }

    private async collectFiles(
        baseUri: vscode.Uri,
        currentUri: vscode.Uri,
        entries: { relativePath: string; content: Uint8Array }[],
    ): Promise<void> {
        const dirEntries = await vscode.workspace.fs.readDirectory(currentUri);
        for (const [name, type] of dirEntries) {
            if (name.startsWith('.')) { continue; }
            const childUri = vscode.Uri.joinPath(currentUri, name);
            if (type & vscode.FileType.Directory) {
                await this.collectFiles(baseUri, childUri, entries);
            } else if (type & vscode.FileType.File) {
                const content = await vscode.workspace.fs.readFile(childUri);
                const relativePath = childUri.path.substring(baseUri.path.length + 1);
                entries.push({ relativePath, content });
            }
        }
    }

    /**
     * Save install metadata (SHA + source repo) for update detection.
     * Metadata is stored in a `.ai-skills-meta.json` file in the category
     * install directory (the parent of the resource file/folder).
     */
    async saveInstallMetadata(item: ResourceItem, scope: InstallScope): Promise<void> {
        try {
            const installLocation = this.pathService.getInstallLocationForScope(item.category, scope);
            const wf = this.pathService.getWorkspaceFolderForLocation(installLocation);
            const baseDir = this.pathService.resolveLocationToUri(installLocation, wf);
            if (!baseDir) {
                return;
            }

            // Compute content hash of what we just installed
            const resourceLocation = `${installLocation}/${item.name}`;
            const contentHash = await this.computeContentHash(resourceLocation, item.category);

            const metaUri = vscode.Uri.joinPath(baseDir, InstallationService.META_FILENAME);
            let metadata: InstallMetadata = {};

            // Read existing metadata
            try {
                const existing = new TextDecoder().decode(
                    await vscode.workspace.fs.readFile(metaUri),
                );
                metadata = JSON.parse(existing);
            } catch {
                // File doesn't exist yet
            }

            metadata[item.name] = {
                sha: item.file.sha || '',
                installedAt: new Date().toISOString(),
                sourceRepo: item.repo?.owner && item.repo?.repo
                    ? {
                        owner: item.repo.owner,
                        repo: item.repo.repo,
                        branch: item.repo.branch,
                        filePath: item.file.path,
                    }
                    : undefined,
                contentHash,
            };

            await vscode.workspace.fs.writeFile(
                metaUri,
                new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
            );
        } catch {
            // Non-critical — silently ignore metadata errors
        }
    }

    /**
     * Read install metadata for a given category + scope.
     */
    async readInstallMetadata(
        category: ResourceCategory,
        scope: InstallScope,
    ): Promise<InstallMetadata> {
        try {
            const installLocation = this.pathService.getInstallLocationForScope(category, scope);
            const wf = this.pathService.getWorkspaceFolderForLocation(installLocation);
            const baseDir = this.pathService.resolveLocationToUri(installLocation, wf);
            if (!baseDir) {
                return {};
            }

            const metaUri = vscode.Uri.joinPath(baseDir, InstallationService.META_FILENAME);
            const raw = new TextDecoder().decode(
                await vscode.workspace.fs.readFile(metaUri),
            );
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }

    /**
     * Read all install metadata across all categories and scopes.
     */
    async readAllInstallMetadata(): Promise<Map<string, InstallMetadata[string]>> {
        const allMeta = new Map<string, InstallMetadata[string]>();

        for (const category of Object.values(ResourceCategory)) {
            for (const scope of ['local', 'global'] as InstallScope[]) {
                const meta = await this.readInstallMetadata(category, scope);
                for (const [name, entry] of Object.entries(meta)) {
                    allMeta.set(name, entry);
                }
            }
        }

        return allMeta;
    }

    /**
     * Remove install metadata for a given resource.
     */
    async removeInstallMetadata(resource: InstalledResource): Promise<void> {
        try {
            // Determine the category directory from the resource location
            const parts = resource.location.split('/');
            parts.pop(); // remove resource name
            const categoryLocation = parts.join('/');

            const wf = this.pathService.getWorkspaceFolderForLocation(categoryLocation);
            const baseDir = this.pathService.resolveLocationToUri(categoryLocation, wf);
            if (!baseDir) {
                return;
            }

            const metaUri = vscode.Uri.joinPath(baseDir, InstallationService.META_FILENAME);
            let metadata: InstallMetadata = {};

            try {
                const existing = new TextDecoder().decode(
                    await vscode.workspace.fs.readFile(metaUri),
                );
                metadata = JSON.parse(existing);
            } catch {
                return;
            }

            delete metadata[resource.name];

            await vscode.workspace.fs.writeFile(
                metaUri,
                new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
            );
        } catch {
            // Non-critical
        }
    }

    /**
     * Update an installed resource by re-downloading from its source repo.
     */
    async updateResource(
        resource: InstalledResource,
        marketplaceItem?: ResourceItem,
    ): Promise<boolean> {
        if (!resource.sourceRepo && !marketplaceItem) {
            vscode.window.showWarningMessage(
                `Cannot update "${resource.name}" — no source repository information available.`,
            );
            return false;
        }

        // If we have a marketplace item, use the normal install flow
        if (marketplaceItem) {
            // Silently overwrite by deleting existing first
            try {
                const wf = this.pathService.getWorkspaceFolderForLocation(resource.location);
                const uri = this.pathService.resolveLocationToUri(resource.location, wf);
                if (uri) {
                    await vscode.workspace.fs.delete(uri, { recursive: true });
                }
            } catch {
                // Ignore — may not exist
            }

            const success = await this.installResource(marketplaceItem, resource.scope);
            if (success) {
                vscode.window.showInformationMessage(
                    `Updated "${resource.name}" to latest version`,
                );
            }
            return success;
        }

        return false;
    }

    /**
     * Revert an installed resource to the version in the source repository.
     * Fetches upstream content, optionally shows a diff, then overwrites.
     * Returns true if the revert succeeded.
     */
    async revertResource(
        resource: InstalledResource,
        metadata?: InstallMetadata[string],
        showDiff: boolean = true,
    ): Promise<boolean> {
        const sourceRepo = metadata?.sourceRepo ?? resource.sourceRepo;
        if (!sourceRepo?.owner || !sourceRepo?.repo || !sourceRepo?.filePath) {
            vscode.window.showWarningMessage(
                `Cannot revert "${resource.name}" — no source repository information available.`,
            );
            return false;
        }

        const { owner, repo: repoName, branch, filePath } = sourceRepo;
        const isSkill = resource.category === ResourceCategory.Skills;

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Reverting "${resource.name}"…`,
                cancellable: true,
            },
            async (progress, token) => {
                try {
                    progress.report({ increment: 0, message: 'Fetching upstream content…' });

                    const wf = this.pathService.getWorkspaceFolderForLocation(resource.location);
                    const localUri = this.pathService.resolveLocationToUri(resource.location, wf);
                    if (!localUri) {
                        vscode.window.showErrorMessage(`Cannot resolve local path for "${resource.name}".`);
                        return false;
                    }

                    if (token.isCancellationRequested) { return false; }

                    if (isSkill) {
                        // Multi-file skill — fetch all files from upstream
                        const repoObj = { owner, repo: repoName, branch, enabled: true };
                        let upstreamFiles: { path: string; content: string }[];

                        try {
                            upstreamFiles = await this.client.fetchSkillFiles(repoObj, filePath);
                        } catch {
                            // Fall back to Contents API
                            const dirContents = await this.client.fetchDirectoryContents(repoObj, filePath);
                            const fileEntries = dirContents.filter(f => f.type === 'file');
                            upstreamFiles = await Promise.all(
                                fileEntries.map(async (f) => {
                                    const basePath = filePath + '/';
                                    const relativePath = f.path.startsWith(basePath)
                                        ? f.path.substring(basePath.length)
                                        : f.name;
                                    const content = await this.client.fetchFileContent(f.download_url);
                                    return { path: relativePath, content };
                                }),
                            );
                        }

                        if (token.isCancellationRequested) { return false; }

                        if (showDiff) {
                            // Show diff of the main SKILL.md file
                            const mainFile = upstreamFiles.find(f =>
                                f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'),
                            );
                            if (mainFile) {
                                const localSkillMd = vscode.Uri.joinPath(localUri, 'SKILL.md');
                                const tempUri = vscode.Uri.parse(`untitled:${resource.name}.upstream`);
                                await vscode.workspace.openTextDocument(tempUri);
                                const edit = new vscode.WorkspaceEdit();
                                edit.insert(tempUri, new vscode.Position(0, 0), mainFile.content);
                                await vscode.workspace.applyEdit(edit);

                                await vscode.commands.executeCommand(
                                    'vscode.diff',
                                    localSkillMd,
                                    tempUri,
                                    `${resource.name}: Local ↔ Repository`,
                                );
                            }

                            const confirm = await vscode.window.showWarningMessage(
                                `Revert "${resource.name}" to the repository version? This will discard all local changes (${upstreamFiles.length} file${upstreamFiles.length > 1 ? 's' : ''}).`,
                                { modal: true },
                                'Revert',
                            );
                            if (confirm !== 'Revert') { return false; }
                        }

                        progress.report({ increment: 50, message: 'Writing files…' });

                        // Delete existing and rewrite all files
                        await vscode.workspace.fs.delete(localUri, { recursive: true });
                        await vscode.workspace.fs.createDirectory(localUri);

                        for (const file of upstreamFiles) {
                            const fileUri = vscode.Uri.joinPath(localUri, file.path);
                            const parentDir = vscode.Uri.joinPath(fileUri, '..');
                            await vscode.workspace.fs.createDirectory(parentDir);
                            await vscode.workspace.fs.writeFile(
                                fileUri,
                                new TextEncoder().encode(file.content),
                            );
                        }
                    } else {
                        // Single-file resource
                        const upstreamContent = await this.client.fetchRawContent(
                            owner, repoName, filePath, branch,
                        );

                        if (token.isCancellationRequested) { return false; }

                        if (showDiff) {
                            const tempUri = vscode.Uri.parse(`untitled:${resource.name}.upstream`);
                            await vscode.workspace.openTextDocument(tempUri);
                            const edit = new vscode.WorkspaceEdit();
                            edit.insert(tempUri, new vscode.Position(0, 0), upstreamContent);
                            await vscode.workspace.applyEdit(edit);

                            await vscode.commands.executeCommand(
                                'vscode.diff',
                                localUri,
                                tempUri,
                                `${resource.name}: Local ↔ Repository`,
                            );

                            const confirm = await vscode.window.showWarningMessage(
                                `Revert "${resource.name}" to the repository version? This will discard all local changes.`,
                                { modal: true },
                                'Revert',
                            );
                            if (confirm !== 'Revert') { return false; }
                        }

                        progress.report({ increment: 50, message: 'Writing file…' });

                        await vscode.workspace.fs.writeFile(
                            localUri,
                            new TextEncoder().encode(upstreamContent),
                        );
                    }

                    // Update the metadata SHA and contentHash to match upstream
                    progress.report({ increment: 40, message: 'Updating metadata…' });
                    const upstreamSha = await this.client.fetchResourceSha(
                        owner, repoName, branch, filePath,
                    );
                    // Recompute contentHash from what we just wrote
                    const newContentHash = await this.computeContentHash(
                        resource.location, resource.category,
                    );
                    if (upstreamSha && metadata) {
                        metadata.sha = upstreamSha;
                        metadata.contentHash = newContentHash;
                        // Re-save metadata
                        const installLocation = this.pathService.getInstallLocationForScope(
                            resource.category, resource.scope,
                        );
                        const metaWf = this.pathService.getWorkspaceFolderForLocation(installLocation);
                        const baseDir = this.pathService.resolveLocationToUri(installLocation, metaWf);
                        if (baseDir) {
                            const metaUri = vscode.Uri.joinPath(baseDir, InstallationService.META_FILENAME);
                            let allMetadata: InstallMetadata = {};
                            try {
                                const existing = new TextDecoder().decode(
                                    await vscode.workspace.fs.readFile(metaUri),
                                );
                                allMetadata = JSON.parse(existing);
                            } catch { /* ignore */ }
                            allMetadata[resource.name] = {
                                sha: upstreamSha,
                                installedAt: metadata.installedAt,
                                sourceRepo: metadata.sourceRepo,
                                contentHash: newContentHash,
                            };
                            await vscode.workspace.fs.writeFile(
                                metaUri,
                                new TextEncoder().encode(JSON.stringify(allMetadata, null, 2)),
                            );
                        }
                    }

                    vscode.window.showInformationMessage(
                        `Reverted "${resource.name}" to the repository version.`,
                    );
                    return true;
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to revert "${resource.name}": ${msg}`);
                    return false;
                }
            },
        );
    }
}
