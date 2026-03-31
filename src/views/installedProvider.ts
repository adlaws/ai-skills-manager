/**
 * Installed Resources TreeDataProvider – two-level tree:
 *
 *  Category (Chat Modes, Instructions, Prompts, Agents, Skills)
 *    └─ Installed Resource
 */

import * as vscode from 'vscode';
import {
    InstalledResource,
    ResourceCategory,
    ALL_CATEGORIES,
    CATEGORY_LABELS,
    CATEGORY_ICONS,
    InstallMetadata,
} from '../types';
import { PathService } from '../services/pathService';

// ── Tree items ──────────────────────────────────────────────────

export class InstalledCategoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly category: ResourceCategory,
        public readonly resources: InstalledResource[],
        public readonly updateCount: number = 0,
    ) {
        super(
            CATEGORY_LABELS[category],
            vscode.TreeItemCollapsibleState.Expanded,
        );
        this.iconPath = new vscode.ThemeIcon(CATEGORY_ICONS[category]);
        this.description = updateCount > 0
            ? `${resources.length} (${updateCount} update${updateCount > 1 ? 's' : ''})`
            : `${resources.length}`;
        this.contextValue = 'installedCategory';
    }
}

export class InstalledResourceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly resource: InstalledResource,
        public readonly hasUpdate: boolean = false,
    ) {
        super(resource.name, vscode.TreeItemCollapsibleState.None);

        const scopeLabel = resource.scope === 'global' ? '$(home) Global' : '$(folder) Workspace';
        const updateLabel = hasUpdate ? ' $(cloud-download) Update available' : '';
        this.description = resource.description
            ? `${resource.description} • ${scopeLabel}${updateLabel}`
            : `${scopeLabel}${updateLabel}`;

        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${resource.name}**\n\n`);
        if (resource.description) {
            this.tooltip.appendMarkdown(`${resource.description}\n\n`);
        }
        this.tooltip.appendMarkdown(`*Scope: ${resource.scope === 'global' ? 'Global (home directory)' : 'Workspace'}*\n\n`);
        this.tooltip.appendMarkdown(`*Location: ${resource.location}*`);
        if (hasUpdate) {
            this.tooltip.appendMarkdown(`\n\n$(cloud-download) **Update available** — a newer version exists in the source repository`);
        }
        this.tooltip.supportThemeIcons = true;

        this.iconPath =
            resource.category === ResourceCategory.Skills
                ? new vscode.ThemeIcon('folder')
                : new vscode.ThemeIcon(CATEGORY_ICONS[resource.category]);

        // Encode update status in context value for menu visibility
        const baseContext = resource.scope === 'global'
            ? 'installedResourceGlobal'
            : 'installedResourceWorkspace';
        this.contextValue = hasUpdate
            ? `${baseContext}Updatable`
            : baseContext;

        this.command = {
            command: 'aiSkillsManager.viewDetails',
            title: 'View Details',
            arguments: [this],
        };
    }
}

// ── Provider ────────────────────────────────────────────────────

type InstalledItem = InstalledCategoryTreeItem | InstalledResourceTreeItem;

export class InstalledTreeDataProvider
    implements vscode.TreeDataProvider<InstalledItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<
        InstalledItem | undefined | null | void
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private installedResources: InstalledResource[] = [];
    private readonly pathService: PathService;
    /** Map of resource name → install metadata (for update detection). */
    private installMetadata = new Map<string, InstallMetadata[string]>();
    /** Set of resource names that have updates available. */
    private updatableNames = new Set<string>();

    constructor(
        private readonly _context: vscode.ExtensionContext,
        pathService?: PathService,
    ) {
        this.pathService = pathService ?? new PathService();

        // Scan once on creation
        this.scanAll().then((resources) => {
            this.installedResources = resources;
            this._onDidChangeTreeData.fire();
        });
    }

    // ── Public API ──────────────────────────────────────────────

    async refresh(): Promise<void> {
        this.installedResources = await this.scanAll();
        this._onDidChangeTreeData.fire();
    }

    getInstalledNames(): Set<string> {
        return new Set(this.installedResources.map((r) => r.name));
    }

    getInstalledResources(): InstalledResource[] {
        return this.installedResources;
    }

    isInstalled(name: string): boolean {
        return this.installedResources.some((r) => r.name === name);
    }

    getInstalledByName(name: string): InstalledResource | undefined {
        return this.installedResources.find((r) => r.name === name);
    }

    /** Get install metadata for a resource. */
    getMetadata(name: string): InstallMetadata[string] | undefined {
        return this.installMetadata.get(name);
    }

    /** Set the names of resources that have updates available. */
    setUpdatableNames(names: Set<string>): void {
        this.updatableNames = names;
        this._onDidChangeTreeData.fire();
    }

    /** Get the set of resource names that have updates available. */
    getUpdatableNames(): Set<string> {
        return this.updatableNames;
    }

    /** Check if a resource has an update available. */
    hasUpdate(name: string): boolean {
        return this.updatableNames.has(name);
    }

    /** Get the count of resources with updates available. */
    getUpdatableCount(): number {
        return this.updatableNames.size;
    }

    /** Store loaded metadata for use by other components. */
    setInstallMetadata(metadata: Map<string, InstallMetadata[string]>): void {
        this.installMetadata = metadata;
    }

    // ── TreeDataProvider ────────────────────────────────────────

    getTreeItem(element: InstalledItem): vscode.TreeItem {
        return element;
    }

    getChildren(
        element?: InstalledItem,
    ): vscode.ProviderResult<InstalledItem[]> {
        if (element instanceof InstalledCategoryTreeItem) {
            return element.resources.map(
                (r) => new InstalledResourceTreeItem(r, this.updatableNames.has(r.name)),
            );
        }

        if (element) {
            return [];
        }

        // Root: group by category
        const byCategory = new Map<ResourceCategory, InstalledResource[]>();
        for (const resource of this.installedResources) {
            const list = byCategory.get(resource.category) ?? [];
            list.push(resource);
            byCategory.set(resource.category, list);
        }

        if (byCategory.size === 0) {
            return [];
        }

        return ALL_CATEGORIES.filter((cat) => byCategory.has(cat)).map(
            (cat) => {
                const resources = byCategory.get(cat)!;
                const updateCount = resources.filter((r) => this.updatableNames.has(r.name)).length;
                return new InstalledCategoryTreeItem(cat, resources, updateCount);
            },
        );
    }

    // ── Scanning ────────────────────────────────────────────────

    private async scanAll(): Promise<InstalledResource[]> {
        const workspaceFolder = this.pathService.getWorkspaceFolder();
        const fs = this.pathService.getFileSystem();
        const installed: InstalledResource[] = [];

        for (const category of ALL_CATEGORIES) {
            const locations = this.pathService.getScanLocations(category);

            for (const location of locations) {
                const wf = this.pathService.requiresWorkspaceFolder(location)
                    ? workspaceFolder
                    : undefined;
                const dir = this.pathService.resolveLocationToUri(
                    location,
                    wf,
                );
                if (!dir) {
                    continue;
                }

                if (!(await this.directoryExists(dir, fs))) {
                    continue;
                }

                try {
                    const entries = await fs.readDirectory(dir);

                    for (const [name, type] of entries) {
                        // Skip metadata files
                        if (name.startsWith('.')) {
                            continue;
                        }
                        if (category === ResourceCategory.Skills) {
                            // Skills are folders with SKILL.md
                            if (!(type & vscode.FileType.Directory)) {
                                continue;
                            }
                            const skillMd = vscode.Uri.joinPath(
                                dir,
                                name,
                                'SKILL.md',
                            );
                            try {
                                const content = await fs.readFile(skillMd);
                                const metadata = this.parseMetadata(
                                    new TextDecoder().decode(content),
                                );
                                installed.push({
                                    name: metadata.name || name,
                                    description:
                                        metadata.description ||
                                        'No description',
                                    category,
                                    location: `${location}/${name}`,
                                    installedAt: new Date().toISOString(),
                                    scope: this.pathService.getScopeForLocation(location),
                                });
                            } catch {
                                // No SKILL.md, skip
                            }
                        } else {
                            // Other resources are individual files
                            if (!(type & vscode.FileType.File)) {
                                continue;
                            }
                            installed.push({
                                name,
                                description: CATEGORY_LABELS[category],
                                category,
                                location: `${location}/${name}`,
                                installedAt: new Date().toISOString(),
                                scope: this.pathService.getScopeForLocation(location),
                            });
                        }
                    }
                } catch {
                    // Directory listing failed
                }
            }
        }

        return installed;
    }

    // ── Helpers ─────────────────────────────────────────────────

    private async directoryExists(
        uri: vscode.Uri,
        fileSystem: vscode.FileSystem,
    ): Promise<boolean> {
        try {
            const stat = await fileSystem.stat(uri);
            return (stat.type & vscode.FileType.Directory) !== 0;
        } catch {
            return false;
        }
    }

    private parseMetadata(content: string): {
        name?: string;
        description?: string;
    } {
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!match) {
            return {};
        }

        const yaml = match[1];
        const nameMatch = yaml.match(/^name:\s*(.+)$/m);
        const descMatch = yaml.match(/^description:\s*(.+)$/m);

        return {
            name: nameMatch?.[1].trim(),
            description: descMatch?.[1].trim(),
        };
    }
}
