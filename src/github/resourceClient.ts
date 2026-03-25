/**
 * Unified GitHub client for fetching resources from repositories.
 *
 * - **Full repos** (no skillsPath): Uses GitHub Contents API to list
 *   well-known category folders (chatmodes/, instructions/, …).
 * - **Skills repos** (with skillsPath): Uses Git Trees API for
 *   efficient scanning of skill folders containing SKILL.md.
 * - **Raw content**: Fetched from raw.githubusercontent.com (no rate limit).
 */

import * as vscode from 'vscode';
import {
    ResourceRepository,
    ResourceCategory,
    ResourceItem,
    GitHubFile,
    GitTreeResponse,
    CacheEntry,
    ALL_CATEGORIES,
} from '../types';

export class ResourceClient {
    private static readonly API_URL = 'https://api.github.com';
    private static readonly RAW_URL = 'https://raw.githubusercontent.com';
    private cache: Map<string, CacheEntry<unknown>> = new Map();
    private cachedAuthToken: string | undefined;
    private authTokenChecked = false;

    constructor(private readonly context: vscode.ExtensionContext) { }

    // ── Public API ──────────────────────────────────────────────

    /**
     * Fetch all resources from every **enabled** repository, grouped
     * by repo key → category → items.
     */
    async fetchAllResources(): Promise<{
        data: Map<string, Map<ResourceCategory, ResourceItem[]>>;
        failed: Set<string>;
    }> {
        const config = vscode.workspace.getConfiguration('aiSkillsManager');
        const repos = config.get<ResourceRepository[]>('repositories', []);
        const enabledRepos = repos.filter((r) => r.enabled !== false);

        const data = new Map<string, Map<ResourceCategory, ResourceItem[]>>();
        const failed = new Set<string>();

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Fetching resources…' },
            async (progress) => {
                for (const repo of enabledRepos) {
                    const key = this.repoKey(repo);
                    progress.report({ message: key });
                    try {
                        const repoData = await this.fetchResourcesFromRepo(repo);
                        data.set(key, repoData);
                    } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        console.warn(`Failed to fetch from ${key}: ${msg}`);
                        failed.add(key);
                    }
                }
            },
        );

        if (failed.size > 0) {
            const names = [...failed].join(', ');
            vscode.window.showWarningMessage(
                `Failed to load ${failed.size} repo(s): ${names}. Check your network or GitHub token.`,
            );
        }

        return { data, failed };
    }

    /**
     * Fetch resources from a single repository, keyed by category.
     */
    async fetchResourcesFromRepo(
        repo: ResourceRepository,
    ): Promise<Map<ResourceCategory, ResourceItem[]>> {
        const categoryMap = new Map<ResourceCategory, ResourceItem[]>();

        if (repo.skillsPath) {
            // Skills-only repo → Git Trees API
            const skills = await this.fetchSkillsViaTreesApi(repo);
            if (skills.length > 0) {
                categoryMap.set(ResourceCategory.Skills, skills);
            }
        } else {
            // Full repo → scan all category folders via Contents API
            const results = await Promise.allSettled(
                ALL_CATEGORIES.map(async (category) => {
                    const items = await this.fetchCategoryContents(repo, category);
                    return { category, items };
                }),
            );

            let anySucceeded = false;
            let lastError: string | undefined;

            for (const result of results) {
                if (result.status === 'fulfilled') {
                    anySucceeded = true;
                    if (result.value.items.length > 0) {
                        categoryMap.set(result.value.category, result.value.items);
                    }
                } else {
                    lastError = result.reason instanceof Error
                        ? result.reason.message
                        : String(result.reason);
                }
            }

            // If every single category call failed, propagate the error
            if (!anySucceeded && lastError) {
                throw new Error(lastError);
            }
        }

        return categoryMap;
    }

    /**
     * Fetch raw text content from a URL (e.g. download_url).
     */
    async fetchFileContent(url: string): Promise<string> {
        const cacheKey = `content:${url}`;
        const cached = this.getFromCache<string>(cacheKey);
        if (cached) {
            return cached;
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch content: ${response.status}`);
        }

        const content = await response.text();
        this.setCache(cacheKey, content);
        return content;
    }

    /**
     * Fetch raw content via raw.githubusercontent.com.
     */
    async fetchRawContent(
        owner: string,
        repo: string,
        filePath: string,
        branch: string,
    ): Promise<string> {
        const url = `${ResourceClient.RAW_URL}/${owner}/${repo}/${branch}/${filePath}`;
        return this.fetchFileContent(url);
    }

    /**
     * Recursively list all files in a directory (Contents API).
     */
    async fetchDirectoryContents(
        repo: ResourceRepository,
        dirPath: string,
    ): Promise<GitHubFile[]> {
        const url = `${ResourceClient.API_URL}/repos/${repo.owner}/${repo.repo}/contents/${dirPath}`;
        const response = await this.fetchWithAuth(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch directory: ${response.status}`);
        }

        const items = (await response.json()) as GitHubFile[];
        const allFiles: GitHubFile[] = [];

        for (const item of items) {
            allFiles.push(item);
            if (item.type === 'dir') {
                const subFiles = await this.fetchDirectoryContents(repo, item.path);
                allFiles.push(...subFiles);
            }
        }

        return allFiles;
    }

    /**
     * Fetch all files for a skill folder (Trees API), returning
     * relative path + content for each file.
     */
    async fetchSkillFiles(
        repo: ResourceRepository,
        skillPath: string,
    ): Promise<{ path: string; content: string }[]> {
        const tree = await this.fetchRepoTree(repo);

        const skillFiles = tree.tree.filter(
            (item) =>
                item.type === 'blob' && item.path.startsWith(skillPath + '/'),
        );

        return Promise.all(
            skillFiles.map(async (item) => {
                const relativePath = item.path.substring(skillPath.length + 1);
                const content = await this.fetchRawContent(
                    repo.owner,
                    repo.repo,
                    item.path,
                    repo.branch,
                );
                return { path: relativePath, content };
            }),
        );
    }

    /** Clear all cached data. */
    clearCache(): void {
        this.cache.clear();
        this.cachedAuthToken = undefined;
        this.authTokenChecked = false;
    }

    // ── Private: Contents API (full repos) ──────────────────────

    private async fetchCategoryContents(
        repo: ResourceRepository,
        category: ResourceCategory,
    ): Promise<ResourceItem[]> {
        const cacheKey = `category:${this.repoKey(repo)}/${category}`;
        const cached = this.getFromCache<ResourceItem[]>(cacheKey);
        if (cached) {
            return cached;
        }

        const url = `${ResourceClient.API_URL}/repos/${repo.owner}/${repo.repo}/contents/${category}`;

        try {
            const response = await this.fetchWithAuth(url);

            if (!response.ok) {
                if (response.status === 404) {
                    return [];
                }
                throw new Error(`GitHub API error: ${response.status}`);
            }

            this.checkRateLimit(response);

            const files = (await response.json()) as GitHubFile[];

            // Skills → directories only; everything else → files only
            const items = files
                .filter((f) => {
                    if (category === ResourceCategory.Skills) {
                        return f.type === 'dir';
                    }
                    return f.type === 'file';
                })
                .map((f) => this.toResourceItem(f, category, repo));

            // For skills from Contents API, try to enrich with SKILL.md metadata
            if (category === ResourceCategory.Skills) {
                await this.enrichSkillItems(items, repo);
            }

            this.setCache(cacheKey, items);
            return items;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes('404')) {
                return [];
            }
            // Propagate non-404 errors (rate limit, network, etc.)
            throw error;
        }
    }

    /**
     * Enrich skill items with SKILL.md frontmatter data.
     */
    private async enrichSkillItems(
        items: ResourceItem[],
        repo: ResourceRepository,
    ): Promise<void> {
        await Promise.allSettled(
            items.map(async (item) => {
                try {
                    const content = await this.fetchRawContent(
                        repo.owner,
                        repo.repo,
                        `${item.file.path}/SKILL.md`,
                        repo.branch,
                    );
                    const parsed = this.parseSkillMd(content);
                    if (parsed.name) {
                        item.name = parsed.name;
                    }
                    item.description = parsed.description || 'No description available';
                    item.license = parsed.license;
                    item.compatibility = parsed.compatibility;
                    item.fullContent = content;
                    item.bodyContent = parsed.body;
                } catch {
                    // SKILL.md not found – leave item as-is
                }
            }),
        );
    }

    // ── Private: Trees API (skills repos) ───────────────────────

    private async fetchSkillsViaTreesApi(
        repo: ResourceRepository,
    ): Promise<ResourceItem[]> {
        if (repo.singleSkill && repo.skillsPath) {
            return this.fetchSingleSkill(repo, repo.skillsPath);
        }

        const tree = await this.fetchRepoTree(repo);
        const basePath = repo.skillsPath || 'skills';

        const skillMdFiles = tree.tree.filter(
            (item) =>
                item.type === 'blob' &&
                item.path.startsWith(basePath + '/') &&
                item.path.endsWith('/SKILL.md'),
        );

        const skillPaths = skillMdFiles.map((item) =>
            item.path.substring(0, item.path.lastIndexOf('/')),
        );

        const items = await Promise.all(
            skillPaths.map(async (skillPath) => {
                try {
                    return await this.fetchSkillMetadata(repo, skillPath);
                } catch {
                    return null;
                }
            }),
        );

        return items.filter((s): s is ResourceItem => s !== null);
    }

    private async fetchSingleSkill(
        repo: ResourceRepository,
        skillPath: string,
    ): Promise<ResourceItem[]> {
        try {
            const item = await this.fetchSkillMetadata(repo, skillPath);
            return item ? [item] : [];
        } catch {
            return [];
        }
    }

    private async fetchSkillMetadata(
        repo: ResourceRepository,
        skillPath: string,
    ): Promise<ResourceItem | null> {
        const skillMdPath = `${skillPath}/SKILL.md`;
        try {
            const content = await this.fetchRawContent(
                repo.owner,
                repo.repo,
                skillMdPath,
                repo.branch,
            );
            const parsed = this.parseSkillMd(content);
            const skillName = skillPath.split('/').pop() || skillPath;

            return {
                id: `skill-${repo.owner}-${repo.repo}-${skillName}`,
                name: parsed.name || skillName,
                category: ResourceCategory.Skills,
                file: {
                    name: skillName,
                    path: skillPath,
                    download_url: '',
                    size: content.length,
                    type: 'dir',
                    sha: undefined,
                },
                repo,
                description: parsed.description || 'No description available',
                license: parsed.license,
                compatibility: parsed.compatibility,
                fullContent: content,
                bodyContent: parsed.body,
            };
        } catch {
            return null;
        }
    }

    private async fetchRepoTree(
        repo: ResourceRepository,
    ): Promise<GitTreeResponse> {
        const cacheKey = `tree:${this.repoKey(repo)}@${repo.branch}`;
        const cached = this.getFromCache<GitTreeResponse>(cacheKey);
        if (cached) {
            return cached;
        }

        const url = `${ResourceClient.API_URL}/repos/${repo.owner}/${repo.repo}/git/trees/${repo.branch}?recursive=1`;
        const response = await this.fetchWithAuth(url);

        if (!response.ok) {
            throw new Error(
                `GitHub API error: ${response.status} ${response.statusText}`,
            );
        }

        this.checkRateLimit(response);
        const data = (await response.json()) as GitTreeResponse;

        if (data.truncated) {
            console.warn(
                `Tree for ${repo.owner}/${repo.repo} was truncated. Some resources may be missing.`,
            );
        }

        this.setCache(cacheKey, data);
        return data;
    }

    // ── Private: Authentication ─────────────────────────────────

    private async fetchWithAuth(url: string): Promise<Response> {
        const headers: Record<string, string> = {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'VSCode-AI-Skills-Manager',
        };

        const token = await this.getAuthToken();
        if (token) {
            headers['Authorization'] = `token ${token}`;
        }

        return fetch(url, { headers });
    }

    /**
     * Get a GitHub auth token, using (in order):
     * 1. Configured `githubToken` setting
     * 2. Cached token from a previous VS Code auth session
     * 3. VS Code's built-in GitHub authentication (silent)
     * 4. VS Code's built-in GitHub authentication (prompt user)
     */
    private async getAuthToken(): Promise<string | undefined> {
        // 1. Explicit config token always wins
        const config = vscode.workspace.getConfiguration('aiSkillsManager');
        const configToken = config.get<string>('githubToken', '');
        if (configToken) {
            return configToken;
        }

        // 2. Return cached token if available
        if (this.cachedAuthToken) {
            return this.cachedAuthToken;
        }

        // 3. Try silent auth first (no UI)
        try {
            const session = await vscode.authentication.getSession(
                'github',
                [],
                { createIfNone: false, silent: true },
            );
            if (session?.accessToken) {
                this.cachedAuthToken = session.accessToken;
                return this.cachedAuthToken;
            }
        } catch {
            // Silent auth not available
        }

        // 4. Prompt user once per session (not on every request)
        if (!this.authTokenChecked) {
            this.authTokenChecked = true;
            try {
                const session = await vscode.authentication.getSession(
                    'github',
                    [],
                    { createIfNone: true },
                );
                if (session?.accessToken) {
                    this.cachedAuthToken = session.accessToken;
                    return this.cachedAuthToken;
                }
            } catch {
                // User declined or auth failed
            }
        }

        return undefined;
    }

    // ── Private: Helpers ────────────────────────────────────────

    private repoKey(repo: ResourceRepository): string {
        return `${repo.owner}/${repo.repo}`;
    }

    private toResourceItem(
        file: GitHubFile,
        category: ResourceCategory,
        repo: ResourceRepository,
    ): ResourceItem {
        return {
            id: `${category}-${file.name}-${repo.owner}-${repo.repo}`,
            name: file.name,
            category,
            file,
            repo,
        };
    }

    private checkRateLimit(response: Response): void {
        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining && parseInt(remaining) < 10) {
            console.warn(`GitHub API rate limit low: ${remaining} remaining`);
        }
    }

    // ── SKILL.md parsing ────────────────────────────────────────

    private parseSkillMd(content: string): {
        name: string;
        description: string;
        license?: string;
        compatibility?: string;
        body: string;
    } {
        const frontmatterMatch = content.match(
            /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/,
        );

        if (!frontmatterMatch) {
            return { name: '', description: '', body: content };
        }

        const yaml = frontmatterMatch[1];
        const body = frontmatterMatch[2];

        const get = (key: string): string => {
            const match = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
            return match ? match[1].trim() : '';
        };

        return {
            name: get('name'),
            description: get('description'),
            license: get('license') || undefined,
            compatibility: get('compatibility') || undefined,
            body,
        };
    }

    // ── Cache ───────────────────────────────────────────────────

    private getFromCache<T>(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }

        const config = vscode.workspace.getConfiguration('aiSkillsManager');
        const timeout = config.get<number>('cacheTimeout', 3600) * 1000;

        if (Date.now() - entry.timestamp > timeout) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.data as T;
    }

    private setCache<T>(key: string, data: T): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }
}
