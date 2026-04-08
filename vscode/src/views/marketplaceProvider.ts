/**
 * Marketplace TreeDataProvider – three-level tree:
 *
 *  Repository
 *    └─ Category (Chat Modes, Instructions, Prompts, Agents, Skills)
 *        └─ Resource Item
 */

import * as vscode from 'vscode';
import {
    ResourceItem,
    ResourceCategory,
    ResourceRepository,
    CATEGORY_LABELS,
    CATEGORY_ICONS,
} from '../types';
import { ResourceClient } from '../github/resourceClient';

// ── Tree items ──────────────────────────────────────────────────

export class ResourceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly resource: ResourceItem,
        public readonly isInstalled: boolean = false,
        public readonly isFavorite: boolean = false,
    ) {
        super(resource.name, vscode.TreeItemCollapsibleState.None);

        const isSkillFolder =
            resource.category === ResourceCategory.Skills &&
            resource.file.type === 'dir';

        this.description = isSkillFolder
            ? resource.description || 'Skill Folder'
            : `${(resource.file.size / 1024).toFixed(1)}KB`;

        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${resource.name}**\n\n`);
        if (resource.description) {
            this.tooltip.appendMarkdown(`${resource.description}\n\n`);
        }
        this.tooltip.appendMarkdown(
            `Category: ${CATEGORY_LABELS[resource.category]}\n\n`,
        );
        this.tooltip.appendMarkdown(
            `Source: \`${resource.repo.owner}/${resource.repo.repo}\``,
        );

        this.iconPath = isSkillFolder
            ? new vscode.ThemeIcon('folder')
            : new vscode.ThemeIcon(CATEGORY_ICONS[resource.category]);

        if (isFavorite) {
            this.contextValue = 'favoriteResource';
        } else if (isInstalled) {
            this.contextValue = 'installedResource';
        } else {
            this.contextValue = 'resource';
        }

        // Click to preview
        this.command = {
            command: 'aiSkillsManager.preview',
            title: 'Preview',
            arguments: [this],
        };
    }
}

export class CategoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly category: ResourceCategory,
        public readonly repo: ResourceRepository,
        public readonly items: ResourceItem[],
    ) {
        super(
            CATEGORY_LABELS[category],
            vscode.TreeItemCollapsibleState.Collapsed,
        );
        this.iconPath = new vscode.ThemeIcon(CATEGORY_ICONS[category]);
        this.description = `${items.length}`;
        this.contextValue = 'category';
    }
}

export class RepoTreeItem extends vscode.TreeItem {
    constructor(
        public readonly repo: ResourceRepository,
        public readonly categoryCount: number,
    ) {
        super(
            repo.label || `${repo.owner}/${repo.repo}`,
            vscode.TreeItemCollapsibleState.Expanded,
        );
        this.iconPath = new vscode.ThemeIcon('repo');
        this.description = `${repo.owner}/${repo.repo}`;
        this.contextValue = 'repo';

        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${repo.owner}/${repo.repo}**\n\n`);
        if (repo.skillsPath) {
            this.tooltip.appendMarkdown(
                `Skills path: \`${repo.skillsPath}\`\n\n`,
            );
        }
        this.tooltip.appendMarkdown(`Branch: \`${repo.branch}\``);
    }
}

export class FavoritesTreeItem extends vscode.TreeItem {
    constructor(public readonly favoriteCount: number) {
        super(
            'Favorites',
            favoriteCount > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed,
        );
        this.iconPath = new vscode.ThemeIcon('star-full');
        this.description = `${favoriteCount}`;
        this.contextValue = 'favorites';
    }
}

// ── Provider ────────────────────────────────────────────────────

type MarketplaceItem = FavoritesTreeItem | RepoTreeItem | CategoryTreeItem | ResourceTreeItem;

export class MarketplaceTreeDataProvider
    implements vscode.TreeDataProvider<MarketplaceItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<
        MarketplaceItem | undefined | null | void
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** repo key → (category → items[]) */
    private repoData = new Map<
        string,
        Map<ResourceCategory, ResourceItem[]>
    >();
    private searchQuery = '';
    private tagFilter = '';
    private installedNames = new Set<string>();
    private isLoading = false;
    private isRefreshing = false;
    private failedRepos = new Set<string>();
    /** Pre-computed filtered view of repoData, rebuilt when query/tag/data changes. */
    private filteredRepoData = new Map<string, Map<ResourceCategory, ResourceItem[]>>();
    /** Cached filtered favorite item count (rebuilt with filteredRepoData). */
    private filteredFavoriteCount = 0;
    private static readonly FAVORITES_KEY = 'aiSkillsManager.favorites';

    constructor(
        private readonly client: ResourceClient,
        private readonly _context: vscode.ExtensionContext,
    ) { }

    // ── Public API ──────────────────────────────────────────────

    async refresh(): Promise<void> {
        if (this.isRefreshing) {
            return;
        }
        this.isRefreshing = true;
        this.isLoading = true;
        this.failedRepos.clear();
        this._onDidChangeTreeData.fire();

        try {
            this.client.clearCache();
            const { data, failed, enrichmentComplete } = await this.client.fetchAllResources();
            this.repoData = data;
            this.failedRepos = failed;
            enrichmentComplete.then(() => {
                this.rebuildFilteredData();
                this._onDidChangeTreeData.fire();
            });
        } catch (error) {
            console.error('Failed to refresh marketplace:', error);
            vscode.window.showErrorMessage('Failed to refresh marketplace.');
        } finally {
            this.isLoading = false;
            this.isRefreshing = false;
            this.rebuildFilteredData();
            this._onDidChangeTreeData.fire();
        }
    }

    /**
     * Refresh a single repository's resources without touching other repos.
     */
    async refreshRepo(repo: ResourceRepository): Promise<void> {
        const repoKey = `${repo.owner}/${repo.repo}`;
        this.client.clearCacheForRepo(repo);

        try {
            const repoData = await this.client.fetchResourcesFromRepo(repo);
            this.repoData.set(repoKey, repoData);
            this.failedRepos.delete(repoKey);
        } catch (error) {
            console.error(`Failed to refresh repo ${repoKey}:`, error);
            this.repoData.delete(repoKey);
            this.failedRepos.add(repoKey);
            vscode.window.showErrorMessage(`Failed to refresh ${repoKey}.`);
        }

        this.rebuildFilteredData();
        this._onDidChangeTreeData.fire();
    }

    async loadResources(): Promise<void> {
        if (this.repoData.size === 0 && !this.isLoading) {
            this.isLoading = true;
            this.failedRepos.clear();
            this._onDidChangeTreeData.fire();

            try {
                const { data, failed, enrichmentComplete } = await this.client.fetchAllResources();
                this.repoData = data;
                this.failedRepos = failed;
                // Refresh tree again once background skill enrichment completes
                enrichmentComplete.then(() => {
                    this.rebuildFilteredData();
                    this._onDidChangeTreeData.fire();
                });
            } catch (error) {
                console.error('Failed to load resources:', error);
            } finally {
                this.isLoading = false;
                this.rebuildFilteredData();
                this._onDidChangeTreeData.fire();
            }
        }
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase();
        this.rebuildFilteredData();
        this._onDidChangeTreeData.fire();
        this.updateSearchContext();
    }

    clearSearch(): void {
        this.searchQuery = '';
        this.rebuildFilteredData();
        this._onDidChangeTreeData.fire();
        this.updateSearchContext();
    }

    isSearchActive(): boolean {
        return this.searchQuery.length > 0;
    }

    setTagFilter(tag: string): void {
        this.tagFilter = tag.toLowerCase();
        this.rebuildFilteredData();
        this._onDidChangeTreeData.fire();
        this.updateTagFilterContext();
    }

    clearTagFilter(): void {
        this.tagFilter = '';
        this.rebuildFilteredData();
        this._onDidChangeTreeData.fire();
        this.updateTagFilterContext();
    }

    isTagFilterActive(): boolean {
        return this.tagFilter.length > 0;
    }

    /**
     * Collect all unique tags from all loaded resources.
     */
    getAllTags(): string[] {
        const tagSet = new Set<string>();
        for (const item of this.getAllItems()) {
            if (item.tags) {
                for (const tag of item.tags) {
                    tagSet.add(tag.toLowerCase());
                }
            }
        }
        return [...tagSet].sort();
    }

    setInstalledNames(names: Set<string>): void {
        this.installedNames = names;
        this._onDidChangeTreeData.fire();
    }

    getAllItems(): ResourceItem[] {
        const items: ResourceItem[] = [];
        for (const categoryMap of this.repoData.values()) {
            for (const catItems of categoryMap.values()) {
                items.push(...catItems);
            }
        }
        return items;
    }

    getItemByName(name: string): ResourceItem | undefined {
        return this.getAllItems().find((i) => i.name === name);
    }

    // ── Favorites ───────────────────────────────────────────────

    getFavoriteIds(): Set<string> {
        const raw = this._context.globalState.get<string[]>(
            MarketplaceTreeDataProvider.FAVORITES_KEY,
            [],
        );
        return new Set(raw);
    }

    isFavorite(itemId: string): boolean {
        return this.getFavoriteIds().has(itemId);
    }

    async toggleFavorite(itemId: string): Promise<void> {
        const favorites = this.getFavoriteIds();
        if (favorites.has(itemId)) {
            favorites.delete(itemId);
        } else {
            favorites.add(itemId);
        }
        await this._context.globalState.update(
            MarketplaceTreeDataProvider.FAVORITES_KEY,
            [...favorites],
        );
        this.rebuildFilteredData();
        this._onDidChangeTreeData.fire();
    }

    async removeFavorite(itemId: string): Promise<void> {
        const favorites = this.getFavoriteIds();
        favorites.delete(itemId);
        await this._context.globalState.update(
            MarketplaceTreeDataProvider.FAVORITES_KEY,
            [...favorites],
        );
        this.rebuildFilteredData();
        this._onDidChangeTreeData.fire();
    }

    getFavoriteItems(): ResourceItem[] {
        const favoriteIds = this.getFavoriteIds();
        return this.getAllItems().filter((item) => favoriteIds.has(item.id));
    }

    // ── TreeDataProvider implementation ─────────────────────────

    getTreeItem(element: MarketplaceItem): vscode.TreeItem {
        return element;
    }

    getChildren(
        element?: MarketplaceItem,
    ): vscode.ProviderResult<MarketplaceItem[]> {
        if (this.isLoading) {
            return [this.createMessageItem('Loading resources…', 'sync')];
        }

        if (!element) {
            // Root level: favorites (if any) + repositories
            if (this.repoData.size === 0) {
                return [
                    this.createMessageItem(
                        'No resources found. Check your repository settings.',
                    ),
                ];
            }

            const children: MarketplaceItem[] = [];

            // Show Favorites section using pre-computed count (lazy — no full scan)
            if (this.filteredFavoriteCount > 0) {
                children.push(new FavoritesTreeItem(this.filteredFavoriteCount));
            }

            const config =
                vscode.workspace.getConfiguration('aiSkillsManager');
            const repos = config.get<ResourceRepository[]>('repositories', []);
            const enabledRepos = repos.filter((r) => r.enabled !== false);

            const repoChildren = enabledRepos
                .filter((repo) =>
                    this.filteredRepoData.has(`${repo.owner}/${repo.repo}`),
                )
                .map((repo) => {
                    const data = this.filteredRepoData.get(
                        `${repo.owner}/${repo.repo}`,
                    )!;
                    return new RepoTreeItem(repo, data.size);
                });

            children.push(...repoChildren);

            if (this.failedRepos.size > 0) {
                for (const repoKey of this.failedRepos) {
                    const failedItem = new vscode.TreeItem(
                        `${repoKey} (failed to load)`,
                        vscode.TreeItemCollapsibleState.None,
                    );
                    failedItem.iconPath = new vscode.ThemeIcon('warning');
                    failedItem.tooltip = `Failed to fetch resources from ${repoKey}. This is usually caused by GitHub API rate limiting. Try signing in to GitHub or setting a personal access token.`;
                    failedItem.contextValue = 'failedRepo';
                    children.push(failedItem as unknown as MarketplaceItem);
                }
            }

            return children.length > 0
                ? children
                : [this.createMessageItem('No resources found.')];
        }

        if (element instanceof FavoritesTreeItem) {
            // Favorites children: compute full list only on expansion
            const favoriteItems = this.getFavoriteItems();
            return this.filterItems(favoriteItems).map(
                (item) =>
                    new ResourceTreeItem(
                        item,
                        this.installedNames.has(item.name),
                        true, // isFavorite
                    ),
            );
        }

        if (element instanceof RepoTreeItem) {
            // Second level: categories (from pre-computed filtered data)
            const repoKey = `${element.repo.owner}/${element.repo.repo}`;
            const data = this.filteredRepoData.get(repoKey);
            if (!data) {
                return [];
            }

            const categories: CategoryTreeItem[] = [];
            for (const [category, items] of data.entries()) {
                categories.push(
                    new CategoryTreeItem(category, element.repo, items),
                );
            }
            return categories;
        }

        if (element instanceof CategoryTreeItem) {
            // Third level: resource items (already filtered via pre-computed data)
            return element.items.map(
                (item) =>
                    new ResourceTreeItem(
                        item,
                        this.installedNames.has(item.name),
                    ),
            );
        }

        return [];
    }

    // ── Private helpers ─────────────────────────────────────────

    /**
     * Rebuild the pre-computed filtered view of repoData.
     * Called when search query, tag filter, or underlying data changes.
     */
    private rebuildFilteredData(): void {
        this.filteredRepoData = new Map();
        for (const [repoKey, categoryMap] of this.repoData) {
            const filteredCategoryMap = new Map<ResourceCategory, ResourceItem[]>();
            for (const [category, items] of categoryMap) {
                const filtered = this.filterItems(items);
                if (filtered.length > 0) {
                    filteredCategoryMap.set(category, filtered);
                }
            }
            if (filteredCategoryMap.size > 0) {
                this.filteredRepoData.set(repoKey, filteredCategoryMap);
            }
        }

        // Pre-compute filtered favorites count
        if (this._context?.globalState) {
            const favoriteIds = this.getFavoriteIds();
            if (favoriteIds.size > 0) {
                const favoriteItems = this.getAllItems().filter((item) => favoriteIds.has(item.id));
                this.filteredFavoriteCount = this.filterItems(favoriteItems).length;
            } else {
                this.filteredFavoriteCount = 0;
            }
        } else {
            this.filteredFavoriteCount = 0;
        }
    }

    private filterItems(items: ResourceItem[]): ResourceItem[] {
        let filtered = items;

        // Apply text search
        if (this.searchQuery) {
            filtered = filtered.filter(
                (item) =>
                    item.name.toLowerCase().includes(this.searchQuery) ||
                    (item.description?.toLowerCase().includes(this.searchQuery) ??
                        false),
            );
        }

        // Apply tag filter
        if (this.tagFilter) {
            filtered = filtered.filter(
                (item) =>
                    item.tags?.some((t) => t.toLowerCase() === this.tagFilter) ?? false,
            );
        }

        return filtered;
    }

    private updateSearchContext(): void {
        vscode.commands.executeCommand(
            'setContext',
            'aiSkillsManager:searchActive',
            this.isSearchActive(),
        );
    }

    private updateTagFilterContext(): void {
        vscode.commands.executeCommand(
            'setContext',
            'aiSkillsManager:tagFilterActive',
            this.isTagFilterActive(),
        );
    }

    private createMessageItem(text: string, icon?: string): MarketplaceItem {
        const item = new vscode.TreeItem(
            text,
            vscode.TreeItemCollapsibleState.None,
        );
        if (icon) {
            item.iconPath = new vscode.ThemeIcon(icon);
        }
        item.contextValue = 'message';
        return item as unknown as MarketplaceItem;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}
