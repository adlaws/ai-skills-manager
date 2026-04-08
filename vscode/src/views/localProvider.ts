/**
 * Local Collection TreeDataProvider – three-level tree:
 *
 *  Collection (local folder)
 *    └─ Category (Chat Modes, Instructions, Prompts, Agents, Skills)
 *        └─ Resource Item
 *
 * Scans configured local folders on disk that follow the standard
 * resource structure (category sub-folders with resource files/skill folders).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
    ResourceItem,
    ResourceCategory,
    ResourceRepository,
    LocalCollection,
    ALL_CATEGORIES,
    CATEGORY_LABELS,
    CATEGORY_ICONS,
    GitHubFile,
} from '../types';
import { parseFrontmatter } from '../services/frontmatterService';

// ── Tree items ──────────────────────────────────────────────────

export class LocalResourceTreeItem extends vscode.TreeItem {
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
            `Source: \`${resource.file.path}\``,
        );

        this.iconPath = isSkillFolder
            ? new vscode.ThemeIcon('folder')
            : new vscode.ThemeIcon(CATEGORY_ICONS[resource.category]);

        this.contextValue = isInstalled ? 'localInstalledResource' : 'localResource';

        // Click to preview
        this.command = {
            command: 'aiSkillsManager.viewDetails',
            title: 'View Details',
            arguments: [this],
        };
    }
}

export class LocalCategoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly category: ResourceCategory,
        public readonly collection: LocalCollection,
        public readonly items: ResourceItem[],
    ) {
        super(
            CATEGORY_LABELS[category],
            vscode.TreeItemCollapsibleState.Collapsed,
        );
        this.iconPath = new vscode.ThemeIcon(CATEGORY_ICONS[category]);
        this.description = `${items.length}`;
        this.contextValue = 'localCategory';
    }
}

export class LocalCollectionTreeItem extends vscode.TreeItem {
    constructor(
        public readonly collection: LocalCollection,
        public readonly categoryCount: number,
        public readonly missing: boolean = false,
    ) {
        super(
            collection.label || path.basename(collection.path),
            missing
                ? vscode.TreeItemCollapsibleState.None
                : vscode.TreeItemCollapsibleState.Expanded,
        );

        if (missing) {
            this.iconPath = new vscode.ThemeIcon(
                'warning',
                new vscode.ThemeColor('list.errorForeground'),
            );
            this.description = `${collection.path} (not found)`;
            this.contextValue = 'localCollectionMissing';

            this.tooltip = new vscode.MarkdownString();
            this.tooltip.supportThemeIcons = true;
            this.tooltip.appendMarkdown(
                `**${collection.label || path.basename(collection.path)}**\n\n`,
            );
            this.tooltip.appendMarkdown(
                `$(warning) **Folder not found**\n\n`,
            );
            this.tooltip.appendMarkdown(
                `The configured path does not exist:\n\n\`${collection.path}\`\n\n`,
            );
            this.tooltip.appendMarkdown(
                `Use **Disconnect Local Collection** to remove this entry, or create the folder on disk.`,
            );
        } else {
            this.iconPath = new vscode.ThemeIcon('folder-library');
            this.description = collection.path;
            this.contextValue = 'localCollection';

            this.tooltip = new vscode.MarkdownString();
            this.tooltip.appendMarkdown(
                `**${collection.label || path.basename(collection.path)}**\n\n`,
            );
            this.tooltip.appendMarkdown(`Path: \`${collection.path}\``);
        }
    }
}

// ── Provider ────────────────────────────────────────────────────

type LocalItem =
    | LocalCollectionTreeItem
    | LocalCategoryTreeItem
    | LocalResourceTreeItem;

export class LocalTreeDataProvider
    implements vscode.TreeDataProvider<LocalItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<
        LocalItem | undefined | null | void
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** collection path → (category → items[]) */
    private collectionData = new Map<
        string,
        Map<ResourceCategory, ResourceItem[]>
    >();
    private searchQuery = '';
    private installedNames = new Set<string>();
    private isLoading = false;
    private missingPaths = new Set<string>();
    private watchers = new Map<string, fs.FSWatcher>();
    private refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    private missingPathCheckInterval: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly _context: vscode.ExtensionContext,
    ) { }

    // ── Public API ──────────────────────────────────────────────

    async refresh(): Promise<void> {
        this.isLoading = true;
        this._onDidChangeTreeData.fire();
        try {
            await this.scanCollections();
        } catch (error) {
            console.error('Failed to refresh local collections:', error);
            vscode.window.showErrorMessage(
                'Failed to refresh local collections.',
            );
        } finally {
            this.isLoading = false;
            this._onDidChangeTreeData.fire();
        }
    }

    async loadResources(): Promise<void> {
        if (this.collectionData.size === 0 && !this.isLoading) {
            this.isLoading = true;
            this._onDidChangeTreeData.fire();
            try {
                await this.scanCollections();
            } catch (error) {
                console.error('Failed to load local collections:', error);
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
        for (const categoryMap of this.collectionData.values()) {
            for (const catItems of categoryMap.values()) {
                items.push(...catItems);
            }
        }
        return items;
    }

    getItemByName(name: string): ResourceItem | undefined {
        return this.getAllItems().find((i) => i.name === name);
    }

    /** Returns the set of collection paths whose directories are missing from disk. */
    getMissingPaths(): ReadonlySet<string> {
        return this.missingPaths;
    }

    dispose(): void {
        this.disposeWatchers();
        if (this.refreshDebounceTimer) {
            clearTimeout(this.refreshDebounceTimer);
        }
        if (this.missingPathCheckInterval) {
            clearInterval(this.missingPathCheckInterval);
        }
    }

    // ── Watchers ────────────────────────────────────────────────

    private disposeWatchers(): void {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
    }

    /**
     * Set up file-system watchers for each existing local collection
     * directory. Uses Node's `fs.watch` with recursive mode to detect
     * added, changed, or deleted files within collections. Also starts
     * a periodic interval to detect when missing folders appear on disk
     * or existing folders are removed.
     */
    private setupWatchers(): void {
        this.disposeWatchers();

        const collections = this.getEnabledCollections();
        for (const collection of collections) {
            if (this.missingPaths.has(collection.path)) {
                continue;
            }

            const rootUri = this.resolveCollectionPath(collection.path);
            if (!rootUri) {
                continue;
            }

            try {
                const watcher = fs.watch(
                    rootUri.fsPath,
                    { recursive: true },
                    () => {
                        this.debouncedRefresh();
                    },
                );
                watcher.on('error', (err) => {
                    console.warn(`File watcher error for ${collection.path}:`, err);
                    this.debouncedRefresh();
                });
                this.watchers.set(collection.path, watcher);
            } catch {
                // fs.watch may not be available or path may not be watchable
            }
        }

        // Periodic check for folder existence changes
        if (this.missingPathCheckInterval) {
            clearInterval(this.missingPathCheckInterval);
        }
        const watchIntervalSec = this.getWatchIntervalSeconds();
        this.missingPathCheckInterval = setInterval(() => {
            this.checkMissingPaths();
        }, watchIntervalSec * 1000);
    }

    private debouncedRefresh(): void {
        if (this.refreshDebounceTimer) {
            clearTimeout(this.refreshDebounceTimer);
        }
        this.refreshDebounceTimer = setTimeout(() => {
            this.refresh();
        }, 1000);
    }

    /**
     * Periodically checks whether missing collection folders have been
     * created, or existing ones deleted, and triggers a refresh if the
     * status has changed.
     */
    private async checkMissingPaths(): Promise<void> {
        const collections = this.getEnabledCollections();
        let changed = false;

        for (const collection of collections) {
            const rootUri = this.resolveCollectionPath(collection.path);
            const wasMissing = this.missingPaths.has(collection.path);
            const exists = rootUri
                ? await this.directoryExists(rootUri)
                : false;

            if (wasMissing && exists) {
                changed = true;
            } else if (!wasMissing && !exists) {
                changed = true;
            }
        }

        if (changed) {
            await this.refresh();
        }
    }

    // ── TreeDataProvider implementation ─────────────────────────

    getTreeItem(element: LocalItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: LocalItem): vscode.ProviderResult<LocalItem[]> {
        if (this.isLoading) {
            return [this.createMessageItem('Scanning local collections…', 'sync')];
        }

        if (!element) {
            // Root level: collections
            const collections = this.getEnabledCollections();

            if (collections.length === 0) {
                return [
                    this.createMessageItem(
                        'No local collections configured.',
                    ),
                ];
            }

            const children: LocalItem[] = [];
            for (const collection of collections) {
                if (this.missingPaths.has(collection.path)) {
                    children.push(
                        new LocalCollectionTreeItem(collection, 0, true),
                    );
                } else {
                    const data = this.collectionData.get(collection.path);
                    if (data && data.size > 0) {
                        children.push(
                            new LocalCollectionTreeItem(
                                collection,
                                data.size,
                            ),
                        );
                    } else {
                        const item = new LocalCollectionTreeItem(
                            collection,
                            0,
                        );
                        item.collapsibleState =
                            vscode.TreeItemCollapsibleState.None;
                        item.description = `${collection.path} (empty)`;
                        children.push(item);
                    }
                }
            }

            return children.length > 0
                ? children
                : [this.createMessageItem('No resources found in local collections.')];
        }

        if (element instanceof LocalCollectionTreeItem) {
            // Second level: categories
            const data = this.collectionData.get(
                element.collection.path,
            );
            if (!data) {
                return [];
            }

            const categories: LocalCategoryTreeItem[] = [];
            for (const [category, items] of data.entries()) {
                const filtered = this.filterItems(items);
                if (filtered.length > 0) {
                    categories.push(
                        new LocalCategoryTreeItem(
                            category,
                            element.collection,
                            filtered,
                        ),
                    );
                }
            }
            return categories;
        }

        if (element instanceof LocalCategoryTreeItem) {
            // Third level: resource items
            return this.filterItems(element.items).map(
                (item) =>
                    new LocalResourceTreeItem(
                        item,
                        this.installedNames.has(item.name),
                    ),
            );
        }

        return [];
    }

    // ── Scanning ────────────────────────────────────────────────

    private getWatchIntervalSeconds(): number {
        const config = vscode.workspace.getConfiguration('aiSkillsManager');
        const raw = config.get<number>('localCollectionWatchInterval', 30);
        return Math.max(5, Math.min(300, raw));
    }

    private getEnabledCollections(): LocalCollection[] {
        const config = vscode.workspace.getConfiguration('aiSkillsManager');
        const collections = config.get<LocalCollection[]>(
            'localCollections',
            [],
        );
        return collections.filter((c) => c.enabled !== false);
    }

    private async scanCollections(): Promise<void> {
        const collections = this.getEnabledCollections();
        const newData = new Map<
            string,
            Map<ResourceCategory, ResourceItem[]>
        >();

        const newMissingPaths = new Set<string>();

        for (const collection of collections) {
            const categoryMap = new Map<ResourceCategory, ResourceItem[]>();

            const rootUri = this.resolveCollectionPath(collection.path);
            if (!rootUri) {
                newMissingPaths.add(collection.path);
                continue;
            }

            if (!(await this.directoryExists(rootUri))) {
                newMissingPaths.add(collection.path);
                continue;
            }

            for (const category of ALL_CATEGORIES) {
                const categoryUri = vscode.Uri.joinPath(rootUri, category);
                if (!(await this.directoryExists(categoryUri))) {
                    continue;
                }

                const items = await this.scanCategory(
                    collection,
                    category,
                    categoryUri,
                );
                if (items.length > 0) {
                    categoryMap.set(category, items);
                }
            }

            newData.set(collection.path, categoryMap);
        }

        this.collectionData = newData;
        this.missingPaths = newMissingPaths;
        this.setupWatchers();
    }

    private async scanCategory(
        collection: LocalCollection,
        category: ResourceCategory,
        categoryUri: vscode.Uri,
    ): Promise<ResourceItem[]> {
        const items: ResourceItem[] = [];
        const fs = vscode.workspace.fs;

        try {
            const entries = await fs.readDirectory(categoryUri);

            for (const [name, type] of entries) {
                // Skip hidden/metadata files
                if (name.startsWith('.')) {
                    continue;
                }
                if (category === ResourceCategory.Skills) {
                    // Skills are directories containing SKILL.md
                    if (!(type & vscode.FileType.Directory)) {
                        continue;
                    }
                    const skillMdUri = vscode.Uri.joinPath(
                        categoryUri,
                        name,
                        'SKILL.md',
                    );
                    let description: string | undefined;
                    let license: string | undefined;
                    let compatibility: string | undefined;
                    try {
                        const raw = new TextDecoder().decode(
                            await fs.readFile(skillMdUri),
                        );
                        const parsed = parseFrontmatter(raw);
                        description = parsed.description || undefined;
                        license = parsed.license;
                        compatibility = parsed.compatibility;
                    } catch {
                        // No SKILL.md – skip this folder
                        continue;
                    }

                    const skillDirPath = vscode.Uri.joinPath(
                        categoryUri,
                        name,
                    ).fsPath;

                    const file: GitHubFile = {
                        name,
                        path: skillDirPath,
                        download_url: '',
                        size: 0,
                        type: 'dir',
                    };

                    items.push({
                        id: `local-collection:${collection.path}/${category}/${name}`,
                        name,
                        category,
                        file,
                        repo: this.buildLocalRepo(collection),
                        description,
                        license,
                        compatibility,
                        // fullContent and bodyContent loaded on demand in viewDetails
                    });
                } else {
                    // Other resources are individual files
                    if (!(type & vscode.FileType.File)) {
                        continue;
                    }
                    const fileUri = vscode.Uri.joinPath(categoryUri, name);
                    let size = 0;
                    try {
                        const stat = await fs.stat(fileUri);
                        size = stat.size;
                    } catch {
                        // ignore
                    }

                    const file: GitHubFile = {
                        name,
                        path: fileUri.fsPath,
                        download_url: fileUri.toString(),
                        size,
                        type: 'file',
                    };

                    items.push({
                        id: `local-collection:${collection.path}/${category}/${name}`,
                        name,
                        category,
                        file,
                        repo: this.buildLocalRepo(collection),
                        // content loaded on demand in viewDetails
                    });
                }
            }
        } catch {
            // Directory read failed
        }

        return items;
    }

    // ── Private helpers ─────────────────────────────────────────

    private buildLocalRepo(collection: LocalCollection): ResourceRepository {
        return {
            owner: '',
            repo: '',
            branch: '',
            enabled: true,
            label: collection.label || path.basename(collection.path),
        };
    }

    private resolveCollectionPath(
        collectionPath: string,
    ): vscode.Uri | undefined {
        const trimmed = collectionPath.trim();
        if (!trimmed) {
            return undefined;
        }

        if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
            const home = os.homedir();
            const resolved = path.join(
                home,
                trimmed.slice(1).replace(/^[/\\]+/, ''),
            );
            return vscode.Uri.file(resolved);
        }

        // Absolute path
        if (path.isAbsolute(trimmed)) {
            return vscode.Uri.file(trimmed);
        }

        // Relative path — resolve against workspace
        const wf = vscode.workspace.workspaceFolders?.[0];
        if (!wf) {
            return undefined;
        }
        return vscode.Uri.joinPath(wf.uri, trimmed);
    }

    private async directoryExists(uri: vscode.Uri): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            return (stat.type & vscode.FileType.Directory) !== 0;
        } catch {
            return false;
        }
    }

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
            'aiSkillsManager:localSearchActive',
            this.isSearchActive(),
        );
    }

    private createMessageItem(text: string, icon?: string): LocalItem {
        const item = new vscode.TreeItem(
            text,
            vscode.TreeItemCollapsibleState.None,
        );
        if (icon) {
            item.iconPath = new vscode.ThemeIcon(icon);
        }
        item.contextValue = 'message';
        return item as unknown as LocalItem;
    }
}
