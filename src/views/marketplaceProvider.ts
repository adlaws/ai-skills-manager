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

        this.contextValue = isInstalled ? 'installedResource' : 'resource';

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

// ── Provider ────────────────────────────────────────────────────

type MarketplaceItem = RepoTreeItem | CategoryTreeItem | ResourceTreeItem;

export class MarketplaceTreeDataProvider
    implements vscode.TreeDataProvider<MarketplaceItem> {
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
    private installedNames = new Set<string>();
    private isLoading = false;
    private failedRepos = new Set<string>();

    constructor(
        private readonly client: ResourceClient,
        private readonly _context: vscode.ExtensionContext,
    ) { }

    // ── Public API ──────────────────────────────────────────────

    async refresh(): Promise<void> {
        this.isLoading = true;
        this.failedRepos.clear();
        this._onDidChangeTreeData.fire();

        try {
            this.client.clearCache();
            const { data, failed } = await this.client.fetchAllResources();
            this.repoData = data;
            this.failedRepos = failed;
        } catch (error) {
            console.error('Failed to refresh marketplace:', error);
            vscode.window.showErrorMessage('Failed to refresh marketplace.');
        } finally {
            this.isLoading = false;
            this._onDidChangeTreeData.fire();
        }
    }

    async loadResources(): Promise<void> {
        if (this.repoData.size === 0 && !this.isLoading) {
            this.isLoading = true;
            this.failedRepos.clear();
            this._onDidChangeTreeData.fire();

            try {
                const { data, failed } = await this.client.fetchAllResources();
                this.repoData = data;
                this.failedRepos = failed;
            } catch (error) {
                console.error('Failed to load resources:', error);
            } finally {
                this.isLoading = false;
                this._onDidChangeTreeData.fire();
            }
        }
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase();
        this._onDidChangeTreeData.fire();
        this.updateSearchContext();
    }

    clearSearch(): void {
        this.searchQuery = '';
        this._onDidChangeTreeData.fire();
        this.updateSearchContext();
    }

    isSearchActive(): boolean {
        return this.searchQuery.length > 0;
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
            // Root level: repositories
            if (this.repoData.size === 0) {
                return [
                    this.createMessageItem(
                        'No resources found. Check your repository settings.',
                    ),
                ];
            }

            const config =
                vscode.workspace.getConfiguration('aiSkillsManager');
            const repos = config.get<ResourceRepository[]>('repositories', []);
            const enabledRepos = repos.filter((r) => r.enabled !== false);

            const children = enabledRepos
                .filter((repo) =>
                    this.repoData.has(`${repo.owner}/${repo.repo}`),
                )
                .map((repo) => {
                    const data = this.repoData.get(
                        `${repo.owner}/${repo.repo}`,
                    )!;
                    return new RepoTreeItem(repo, data.size);
                });

            if (this.failedRepos.size > 0) {
                for (const repoKey of this.failedRepos) {
                    const failedItem = new vscode.TreeItem(
                        `${repoKey} (failed to load)`,
                        vscode.TreeItemCollapsibleState.None,
                    );
                    failedItem.iconPath = new vscode.ThemeIcon('warning');
                    failedItem.tooltip = `Failed to fetch resources from ${repoKey}. This is usually caused by GitHub API rate limiting. Try signing in to GitHub or setting a personal access token.`;
                    failedItem.contextValue = 'failedRepo';
                    children.push(failedItem as unknown as RepoTreeItem);
                }
            }

            return children.length > 0
                ? children
                : [this.createMessageItem('No resources found.')];
        }

        if (element instanceof RepoTreeItem) {
            // Second level: categories
            const repoKey = `${element.repo.owner}/${element.repo.repo}`;
            const data = this.repoData.get(repoKey);
            if (!data) {
                return [];
            }

            const categories: CategoryTreeItem[] = [];
            for (const [category, items] of data.entries()) {
                const filtered = this.filterItems(items);
                if (filtered.length > 0) {
                    categories.push(
                        new CategoryTreeItem(category, element.repo, filtered),
                    );
                }
            }
            return categories;
        }

        if (element instanceof CategoryTreeItem) {
            // Third level: resource items
            return this.filterItems(element.items).map(
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

    private filterItems(items: ResourceItem[]): ResourceItem[] {
        if (!this.searchQuery) {
            return items;
        }
        return items.filter(
            (item) =>
                item.name.toLowerCase().includes(this.searchQuery) ||
                (item.description?.toLowerCase().includes(this.searchQuery) ??
                    false),
        );
    }

    private updateSearchContext(): void {
        vscode.commands.executeCommand(
            'setContext',
            'aiSkillsManager:searchActive',
            this.isSearchActive(),
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
}
