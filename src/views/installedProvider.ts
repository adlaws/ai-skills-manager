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
} from '../types';
import { PathService } from '../services/pathService';

// ── Tree items ──────────────────────────────────────────────────

export class InstalledCategoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly category: ResourceCategory,
        public readonly resources: InstalledResource[],
    ) {
        super(
            CATEGORY_LABELS[category],
            vscode.TreeItemCollapsibleState.Expanded,
        );
        this.iconPath = new vscode.ThemeIcon(CATEGORY_ICONS[category]);
        this.description = `${resources.length}`;
        this.contextValue = 'installedCategory';
    }
}

export class InstalledResourceTreeItem extends vscode.TreeItem {
    constructor(public readonly resource: InstalledResource) {
        super(resource.name, vscode.TreeItemCollapsibleState.None);

        const scopeLabel = resource.scope === 'global' ? '$(home) Global' : '$(folder) Local';
        this.description = resource.description
            ? `${resource.description} • ${scopeLabel}`
            : scopeLabel;

        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${resource.name}**\n\n`);
        if (resource.description) {
            this.tooltip.appendMarkdown(`${resource.description}\n\n`);
        }
        this.tooltip.appendMarkdown(`*Scope: ${resource.scope === 'global' ? 'Global (home directory)' : 'Local (workspace)'}*\n\n`);
        this.tooltip.appendMarkdown(`*Location: ${resource.location}*`);

        this.iconPath =
            resource.category === ResourceCategory.Skills
                ? new vscode.ThemeIcon('folder')
                : new vscode.ThemeIcon(CATEGORY_ICONS[resource.category]);

        this.contextValue = resource.scope === 'global'
            ? 'installedResourceGlobal'
            : 'installedResourceLocal';
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

    // ── TreeDataProvider ────────────────────────────────────────

    getTreeItem(element: InstalledItem): vscode.TreeItem {
        return element;
    }

    getChildren(
        element?: InstalledItem,
    ): vscode.ProviderResult<InstalledItem[]> {
        if (element instanceof InstalledCategoryTreeItem) {
            return element.resources.map(
                (r) => new InstalledResourceTreeItem(r),
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
            (cat) =>
                new InstalledCategoryTreeItem(cat, byCategory.get(cat)!),
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
