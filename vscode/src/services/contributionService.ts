/**
 * Contribution Service – push local changes back to the source GitHub repository.
 *
 * Workflow:
 * 1. Verify the installed resource has source repo metadata
 * 2. Read local file(s) from disk
 * 3. Authenticate with `repo` scope (write access)
 * 4. Verify push access to the target repository
 * 5. Auto-generate a branch name (user can edit)
 * 6. Create branch via GitHub API
 * 7. Commit changed file(s) to the branch
 * 8. Create a pull request
 * 9. Show notification with link to the PR
 *
 * Single-file resources use the Contents API (PUT).
 * Multi-file resources (skills) use the Git Data API (blobs → tree → commit).
 */

import * as vscode from 'vscode';
import { InstalledResource, ResourceCategory, InstallMetadata, ResourceRepository } from '../types';
import { ResourceClient } from '../github/resourceClient';
import { PathService } from './pathService';

interface GitHubBlobResponse {
    sha: string;
    url: string;
}

interface GitHubTreeResponse {
    sha: string;
    url: string;
    tree: { path: string; mode: string; type: string; sha: string }[];
}

interface GitHubCommitResponse {
    sha: string;
    url: string;
    html_url: string;
}

interface GitHubRefResponse {
    ref: string;
    object: { sha: string; type: string };
}

interface GitHubPullRequestResponse {
    number: number;
    html_url: string;
    title: string;
}

interface GitHubRepoPermissions {
    push: boolean;
    pull: boolean;
    admin: boolean;
}

export class ContributionService {
    private static readonly API_URL = 'https://api.github.com';

    constructor(
        private readonly client: ResourceClient,
        private readonly pathService: PathService,
    ) { }

    /**
     * Propose changes for an installed resource back to its source repository.
     *
     * @param resource The installed resource to push changes for
     * @param metadata The install metadata (SHA + source repo info)
     */
    async proposeChanges(
        resource: InstalledResource,
        metadata: InstallMetadata[string] | undefined,
    ): Promise<void> {
        // 1. Validate source repo metadata
        const sourceRepo = metadata?.sourceRepo ?? resource.sourceRepo;
        if (!sourceRepo) {
            vscode.window.showErrorMessage(
                `Cannot propose changes for "${resource.name}" — it wasn't installed from a marketplace repository, so there's no upstream to push to.`,
            );
            return;
        }

        const { owner, repo, filePath } = sourceRepo;

        // Look up the current configured branch for this repo (the metadata
        // branch may be stale if the user changed their config after install).
        const configuredRepos = vscode.workspace
            .getConfiguration('aiSkillsManager')
            .get<ResourceRepository[]>('repositories', []);
        const matchingRepo = configuredRepos.find(
            (r) => r.owner === owner && r.repo === repo,
        );
        const sourceBranch = matchingRepo?.branch ?? sourceRepo.branch;

        // 2. Get write-scoped auth token
        const token = await this.client.getWriteAuthToken();
        if (!token) {
            vscode.window.showErrorMessage(
                'GitHub authentication with write access is required to propose changes. Please sign in when prompted.',
            );
            return;
        }

        // 3. Verify push access
        const hasPushAccess = await this.checkPushAccess(token, owner, repo);
        if (!hasPushAccess) {
            vscode.window.showErrorMessage(
                `You don't have write access to ${owner}/${repo} with the current GitHub account. ` +
                `Fork-based contributions may be supported in a future update.`,
            );
            return;
        }

        // 4. Read local content from disk
        const localFiles = await this.readLocalFiles(resource);
        if (localFiles.length === 0) {
            vscode.window.showErrorMessage(
                `Could not read local files for "${resource.name}".`,
            );
            return;
        }

        // 5. Prompt for branch name
        const defaultBranch = this.generateBranchName(resource);
        const branchName = await vscode.window.showInputBox({
            prompt: 'Branch name for your proposed changes',
            value: defaultBranch,
            placeHolder: defaultBranch,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Branch name is required';
                }
                if (!/^[a-zA-Z0-9._\-/]+$/.test(value)) {
                    return 'Branch name contains invalid characters';
                }
                return undefined;
            },
        });
        if (!branchName) {
            return; // Cancelled
        }

        // 6. Prompt for PR title and description
        const defaultTitle = `Update ${resource.name}`;
        const prTitle = await vscode.window.showInputBox({
            prompt: 'Pull request title',
            value: defaultTitle,
            placeHolder: defaultTitle,
        });
        if (!prTitle) {
            return; // Cancelled
        }

        const prDescription = await vscode.window.showInputBox({
            prompt: 'Pull request description (optional)',
            placeHolder: 'Describe your changes…',
        });

        // 7. Execute the push workflow with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Proposing changes for "${resource.name}"…`,
                cancellable: false,
            },
            async (progress) => {
                try {
                    // Get latest commit SHA of the source branch
                    progress.report({ message: 'Getting latest commit…' });
                    const baseSha = await this.getBranchHeadSha(token, owner, repo, sourceBranch);
                    if (!baseSha) {
                        throw new Error(`Could not get HEAD SHA for branch "${sourceBranch}".`);
                    }

                    // Create branch
                    progress.report({ message: 'Creating branch…' });
                    const branchCreated = await this.createBranch(token, owner, repo, branchName, baseSha);
                    if (!branchCreated) {
                        throw new Error(
                            `Could not create branch "${branchName}". It may already exist — try a different name.`,
                        );
                    }

                    // Commit files
                    progress.report({ message: 'Pushing changes…' });
                    const isSkill = resource.category === ResourceCategory.Skills;

                    if (isSkill && localFiles.length > 1) {
                        // Multi-file commit via Git Data API
                        await this.commitMultipleFiles(
                            token, owner, repo, branchName, baseSha,
                            filePath, localFiles, `Update ${resource.name}`,
                        );
                    } else {
                        // Single file commit via Contents API
                        for (const file of localFiles) {
                            const fullPath = isSkill
                                ? `${filePath}/${file.relativePath}`
                                : filePath;
                            await this.commitSingleFile(
                                token, owner, repo, branchName,
                                fullPath, file.content,
                                `Update ${resource.name}`,
                            );
                        }
                    }

                    // Create PR
                    progress.report({ message: 'Creating pull request…' });
                    const body = [
                        prDescription || '',
                        '',
                        '---',
                        '_Proposed via [AI Skills Manager](https://marketplace.visualstudio.com/items?itemName=adlaws.ai-skills-manager)_',
                    ].join('\n');

                    const pr = await this.createPullRequest(
                        token, owner, repo,
                        branchName, sourceBranch,
                        prTitle, body,
                    );

                    if (pr) {
                        const action = await vscode.window.showInformationMessage(
                            `Pull request #${pr.number} created successfully!`,
                            'Open in Browser',
                        );
                        if (action === 'Open in Browser') {
                            vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
                        }
                    }
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to propose changes: ${msg}`);
                }
            },
        );
    }

    /**
     * Check whether the user has suitable metadata and can propose changes.
     * Used to control visibility of the "Propose Changes" button/menu.
     */
    canProposeChanges(
        resource: InstalledResource,
        metadata: InstallMetadata[string] | undefined,
    ): boolean {
        const sourceRepo = metadata?.sourceRepo ?? resource.sourceRepo;
        return !!(sourceRepo?.owner && sourceRepo?.repo && sourceRepo?.filePath);
    }

    /**
     * Suggest adding a resource to a target repository.
     *
     * Creates a branch and pull request with the resource file(s) in the
     * appropriate category folder of the target repo.
     *
     * @param name Resource name
     * @param category Resource category
     * @param files Pre-resolved resource file(s)
     * @param targetRepo Target repository configuration
     */
    async suggestAddition(
        name: string,
        category: ResourceCategory,
        files: { relativePath: string; content: string }[],
        targetRepo: ResourceRepository,
    ): Promise<void> {
        const { owner, repo, branch: targetBranch } = targetRepo;

        // 1. Validate: skills-only repos can only accept skills
        if (targetRepo.skillsPath && category !== ResourceCategory.Skills) {
            vscode.window.showWarningMessage(
                `"${owner}/${repo}" is configured as a skills-only repository and cannot accept ${category} resources.`,
            );
            return;
        }

        // 2. Get write-scoped auth token
        const token = await this.client.getWriteAuthToken();
        if (!token) {
            vscode.window.showErrorMessage(
                'GitHub authentication with write access is required. Please sign in when prompted.',
            );
            return;
        }

        // 3. Verify push access
        const hasPushAccess = await this.checkPushAccess(token, owner, repo);
        if (!hasPushAccess) {
            vscode.window.showErrorMessage(
                `You don't have write access to ${owner}/${repo} with the current GitHub account.`,
            );
            return;
        }

        // 4. Compute target path
        const basePath = this.computeTargetPath(name, category, targetRepo);

        // 5. Check if resource already exists in target repo
        const existingSha = await this.getFileSha(
            token, owner, repo, targetBranch,
            category === ResourceCategory.Skills ? `${basePath}/SKILL.md` : basePath,
        );
        if (existingSha) {
            const proceed = await vscode.window.showWarningMessage(
                `A resource at "${basePath}" already exists in ${owner}/${repo}. The pull request will show the differences.`,
                'Continue Anyway',
                'Cancel',
            );
            if (proceed !== 'Continue Anyway') {
                return;
            }
        }

        // 6. Prompt for branch name
        const sanitized = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const timestamp = new Date().toISOString().slice(0, 10);
        const defaultBranch = `ai-skills-manager/suggest/${category}/${sanitized}/${timestamp}`;
        const branchName = await vscode.window.showInputBox({
            prompt: 'Branch name for your suggestion',
            value: defaultBranch,
            placeHolder: defaultBranch,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Branch name is required';
                }
                if (!/^[a-zA-Z0-9._\-/]+$/.test(value)) {
                    return 'Branch name contains invalid characters';
                }
                return undefined;
            },
        });
        if (!branchName) {
            return; // Cancelled
        }

        // 7. Prompt for PR title and description
        const defaultTitle = `Add ${category} "${name}"`;
        const prTitle = await vscode.window.showInputBox({
            prompt: 'Pull request title',
            value: defaultTitle,
            placeHolder: defaultTitle,
        });
        if (!prTitle) {
            return; // Cancelled
        }

        const prDescription = await vscode.window.showInputBox({
            prompt: 'Pull request description (optional)',
            placeHolder: 'Describe why this resource should be added…',
        });

        // 8. Execute the push workflow with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Suggesting "${name}" to ${owner}/${repo}…`,
                cancellable: false,
            },
            async (progress) => {
                try {
                    progress.report({ message: 'Getting latest commit…' });
                    const baseSha = await this.getBranchHeadSha(token, owner, repo, targetBranch);
                    if (!baseSha) {
                        throw new Error(`Could not get HEAD SHA for branch "${targetBranch}".`);
                    }

                    progress.report({ message: 'Creating branch…' });
                    const branchCreated = await this.createBranch(token, owner, repo, branchName, baseSha);
                    if (!branchCreated) {
                        throw new Error(
                            `Could not create branch "${branchName}". It may already exist — try a different name.`,
                        );
                    }

                    progress.report({ message: 'Pushing files…' });
                    const isSkill = category === ResourceCategory.Skills;
                    const commitMessage = `Add ${category} "${name}"`;

                    if (isSkill && files.length > 1) {
                        await this.commitMultipleFiles(
                            token, owner, repo, branchName, baseSha,
                            basePath, files, commitMessage,
                        );
                    } else {
                        for (const file of files) {
                            const fullPath = isSkill
                                ? `${basePath}/${file.relativePath}`
                                : basePath;
                            await this.commitSingleFile(
                                token, owner, repo, branchName,
                                fullPath, file.content, commitMessage,
                            );
                        }
                    }

                    progress.report({ message: 'Creating pull request…' });
                    const body = [
                        prDescription || '',
                        '',
                        '---',
                        `_Suggested via [AI Skills Manager](https://marketplace.visualstudio.com/items?itemName=adlaws.ai-skills-manager)_`,
                    ].join('\n');

                    const pr = await this.createPullRequest(
                        token, owner, repo,
                        branchName, targetBranch,
                        prTitle, body,
                    );

                    if (pr) {
                        const action = await vscode.window.showInformationMessage(
                            `Pull request #${pr.number} created on ${owner}/${repo}!`,
                            'Open in Browser',
                        );
                        if (action === 'Open in Browser') {
                            vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
                        }
                    }
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to suggest addition: ${msg}`);
                }
            },
        );
    }

    /**
     * Read the local file(s) for an installed resource.
     * Returns an array of { relativePath, content } entries.
     */
    async readLocalFiles(
        resource: InstalledResource,
    ): Promise<{ relativePath: string; content: string }[]> {
        const wf = this.pathService.getWorkspaceFolderForLocation(resource.location);
        const baseUri = this.pathService.resolveLocationToUri(resource.location, wf);
        if (!baseUri) {
            return [];
        }

        const isSkill = resource.category === ResourceCategory.Skills;

        if (isSkill) {
            return this.readSkillFiles(baseUri);
        } else {
            // Single file resource
            try {
                const content = new TextDecoder().decode(
                    await vscode.workspace.fs.readFile(baseUri),
                );
                return [{ relativePath: resource.name, content }];
            } catch {
                return [];
            }
        }
    }

    /**
     * Read file(s) from a local collection or disk path.
     * For skills (directories), recursively reads all files.
     * For single files, reads the file content.
     */
    async readFilesFromDisk(
        uri: vscode.Uri,
        name: string,
        category: ResourceCategory,
    ): Promise<{ relativePath: string; content: string }[]> {
        const isSkill = category === ResourceCategory.Skills;

        if (isSkill) {
            return this.readSkillFiles(uri);
        } else {
            try {
                const content = new TextDecoder().decode(
                    await vscode.workspace.fs.readFile(uri),
                );
                return [{ relativePath: name, content }];
            } catch {
                return [];
            }
        }
    }

    // ── Private: GitHub API operations ──────────────────────────

    /**
     * Compute the target path for a resource in the target repository.
     */
    private computeTargetPath(
        name: string,
        category: ResourceCategory,
        targetRepo: ResourceRepository,
    ): string {
        if (category === ResourceCategory.Skills && targetRepo.skillsPath) {
            return `${targetRepo.skillsPath}/${name}`;
        }
        return `${category}/${name}`;
    }

    /**
     * Check if the authenticated user has push access to the repo.
     */
    private async checkPushAccess(
        token: string,
        owner: string,
        repo: string,
    ): Promise<boolean> {
        try {
            const response = await fetch(
                `${ContributionService.API_URL}/repos/${owner}/${repo}`,
                {
                    headers: this.authHeaders(token),
                },
            );
            if (!response.ok) {
                return false;
            }
            const data = (await response.json()) as { permissions?: GitHubRepoPermissions };
            return data.permissions?.push === true;
        } catch {
            return false;
        }
    }

    /**
     * Get the HEAD commit SHA of a branch.
     */
    private async getBranchHeadSha(
        token: string,
        owner: string,
        repo: string,
        branch: string,
    ): Promise<string | undefined> {
        try {
            const response = await fetch(
                `${ContributionService.API_URL}/repos/${owner}/${repo}/git/ref/heads/${branch}`,
                {
                    headers: this.authHeaders(token),
                },
            );
            if (!response.ok) {
                return undefined;
            }
            const data = (await response.json()) as GitHubRefResponse;
            return data.object.sha;
        } catch {
            return undefined;
        }
    }

    /**
     * Create a new branch from a base commit SHA.
     */
    private async createBranch(
        token: string,
        owner: string,
        repo: string,
        branchName: string,
        baseSha: string,
    ): Promise<boolean> {
        try {
            const response = await fetch(
                `${ContributionService.API_URL}/repos/${owner}/${repo}/git/refs`,
                {
                    method: 'POST',
                    headers: this.authHeaders(token),
                    body: JSON.stringify({
                        ref: `refs/heads/${branchName}`,
                        sha: baseSha,
                    }),
                },
            );

            if (response.status === 422) {
                // Branch already exists
                return false;
            }

            return response.ok || response.status === 201;
        } catch {
            return false;
        }
    }

    /**
     * Commit a single file using the Contents API (PUT).
     * This handles getting the current file SHA for updates.
     */
    private async commitSingleFile(
        token: string,
        owner: string,
        repo: string,
        branch: string,
        filePath: string,
        content: string,
        commitMessage: string,
    ): Promise<void> {
        // Get the current file SHA (needed for updating existing files)
        const existingSha = await this.getFileSha(token, owner, repo, branch, filePath);

        const body: Record<string, unknown> = {
            message: commitMessage,
            content: Buffer.from(content).toString('base64'),
            branch,
        };

        if (existingSha) {
            body.sha = existingSha;
        }

        const response = await fetch(
            `${ContributionService.API_URL}/repos/${owner}/${repo}/contents/${filePath}`,
            {
                method: 'PUT',
                headers: this.authHeaders(token),
                body: JSON.stringify(body),
            },
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to commit ${filePath}: ${response.status} ${error}`);
        }
    }

    /**
     * Commit multiple files atomically using the Git Data API.
     * Creates blobs → tree → commit → updates the branch ref.
     */
    private async commitMultipleFiles(
        token: string,
        owner: string,
        repo: string,
        branch: string,
        baseSha: string,
        basePath: string,
        files: { relativePath: string; content: string }[],
        commitMessage: string,
    ): Promise<void> {
        // 1. Create blobs for each file
        const blobShas: { path: string; sha: string }[] = [];
        for (const file of files) {
            const blobResponse = await fetch(
                `${ContributionService.API_URL}/repos/${owner}/${repo}/git/blobs`,
                {
                    method: 'POST',
                    headers: this.authHeaders(token),
                    body: JSON.stringify({
                        content: Buffer.from(file.content).toString('base64'),
                        encoding: 'base64',
                    }),
                },
            );

            if (!blobResponse.ok) {
                throw new Error(`Failed to create blob for ${file.relativePath}`);
            }

            const blob = (await blobResponse.json()) as GitHubBlobResponse;
            blobShas.push({
                path: `${basePath}/${file.relativePath}`,
                sha: blob.sha,
            });
        }

        // 2. Get the base tree SHA from the base commit
        const baseCommitResponse = await fetch(
            `${ContributionService.API_URL}/repos/${owner}/${repo}/git/commits/${baseSha}`,
            {
                headers: this.authHeaders(token),
            },
        );
        if (!baseCommitResponse.ok) {
            throw new Error('Failed to get base commit');
        }
        const baseCommit = (await baseCommitResponse.json()) as { tree: { sha: string } };

        // 3. Create a new tree with the updated files
        const treeItems = blobShas.map((b) => ({
            path: b.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: b.sha,
        }));

        const treeResponse = await fetch(
            `${ContributionService.API_URL}/repos/${owner}/${repo}/git/trees`,
            {
                method: 'POST',
                headers: this.authHeaders(token),
                body: JSON.stringify({
                    base_tree: baseCommit.tree.sha,
                    tree: treeItems,
                }),
            },
        );
        if (!treeResponse.ok) {
            throw new Error('Failed to create tree');
        }
        const newTree = (await treeResponse.json()) as GitHubTreeResponse;

        // 4. Create a new commit pointing to the new tree
        const commitResponse = await fetch(
            `${ContributionService.API_URL}/repos/${owner}/${repo}/git/commits`,
            {
                method: 'POST',
                headers: this.authHeaders(token),
                body: JSON.stringify({
                    message: commitMessage,
                    tree: newTree.sha,
                    parents: [baseSha],
                }),
            },
        );
        if (!commitResponse.ok) {
            throw new Error('Failed to create commit');
        }
        const newCommit = (await commitResponse.json()) as GitHubCommitResponse;

        // 5. Update the branch ref to point to the new commit
        const updateRefResponse = await fetch(
            `${ContributionService.API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`,
            {
                method: 'PATCH',
                headers: this.authHeaders(token),
                body: JSON.stringify({
                    sha: newCommit.sha,
                }),
            },
        );
        if (!updateRefResponse.ok) {
            throw new Error('Failed to update branch reference');
        }
    }

    /**
     * Create a pull request.
     */
    private async createPullRequest(
        token: string,
        owner: string,
        repo: string,
        head: string,
        base: string,
        title: string,
        body: string,
    ): Promise<GitHubPullRequestResponse | undefined> {
        try {
            const response = await fetch(
                `${ContributionService.API_URL}/repos/${owner}/${repo}/pulls`,
                {
                    method: 'POST',
                    headers: this.authHeaders(token),
                    body: JSON.stringify({ title, body, head, base }),
                },
            );

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Failed to create PR: ${response.status} ${error}`);
            }

            return (await response.json()) as GitHubPullRequestResponse;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to create pull request: ${msg}`);
            return undefined;
        }
    }

    /**
     * Get the SHA of an existing file on a branch (needed for Contents API updates).
     */
    private async getFileSha(
        token: string,
        owner: string,
        repo: string,
        branch: string,
        filePath: string,
    ): Promise<string | undefined> {
        try {
            const response = await fetch(
                `${ContributionService.API_URL}/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
                {
                    headers: this.authHeaders(token),
                },
            );
            if (!response.ok) {
                return undefined;
            }

            const data = (await response.json()) as { sha?: string };
            return data.sha;
        } catch {
            return undefined;
        }
    }

    // ── Private: Local file reading ─────────────────────────────

    /**
     * Recursively read all files in a skill directory.
     */
    private async readSkillFiles(
        dirUri: vscode.Uri,
        basePath: string = '',
    ): Promise<{ relativePath: string; content: string }[]> {
        const files: { relativePath: string; content: string }[] = [];

        try {
            const entries = await vscode.workspace.fs.readDirectory(dirUri);

            for (const [name, type] of entries) {
                // Skip metadata file
                if (name === '.ai-skills-meta.json') {
                    continue;
                }

                const childUri = vscode.Uri.joinPath(dirUri, name);
                const relativePath = basePath ? `${basePath}/${name}` : name;

                if (type === vscode.FileType.File) {
                    try {
                        const content = new TextDecoder().decode(
                            await vscode.workspace.fs.readFile(childUri),
                        );
                        files.push({ relativePath, content });
                    } catch {
                        // Skip unreadable files
                    }
                } else if (type === vscode.FileType.Directory) {
                    const subFiles = await this.readSkillFiles(childUri, relativePath);
                    files.push(...subFiles);
                }
            }
        } catch {
            // Directory unreadable
        }

        return files;
    }

    // ── Private: Helpers ────────────────────────────────────────

    /**
     * Generate a branch name from the resource metadata.
     */
    private generateBranchName(resource: InstalledResource): string {
        const sanitized = resource.name
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        return `ai-skills-manager/${resource.category}/${sanitized}/${timestamp}`;
    }

    /**
     * Build standard auth headers for GitHub API.
     */
    private authHeaders(token: string): Record<string, string> {
        return {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `token ${token}`,
            'User-Agent': 'VSCode-AI-Skills-Manager',
            'Content-Type': 'application/json',
        };
    }
}
