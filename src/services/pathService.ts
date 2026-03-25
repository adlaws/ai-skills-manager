/**
 * Path Service – resolves install / scan locations for all resource categories.
 *
 * Each category has its own configurable install location, all defaulting
 * to subfolders under `.agents/`.  Paths starting with `~/` are resolved
 * relative to the user's home directory; all others are resolved relative
 * to the first workspace folder.
 */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ResourceCategory, DEFAULT_INSTALL_PATHS, DEFAULT_GLOBAL_INSTALL_PATHS, InstallScope } from '../types';

export class PathService {
    // ── Workspace / FS accessors (easy to mock in tests) ────────

    getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    getFileSystem(): vscode.FileSystem {
        return vscode.workspace.fs;
    }

    getHomeDirectory(): string {
        return os.homedir();
    }

    // ── Install location per category ───────────────────────────

    /**
     * Read the configured install location string for a given category.
     */
    getInstallLocation(category: ResourceCategory): string {
        const config = vscode.workspace.getConfiguration('aiSkillsManager');
        return config.get<string>(
            `installLocation.${category}`,
            DEFAULT_INSTALL_PATHS[category],
        );
    }

    /**
     * Read the configured global install location string for a given category.
     */
    getGlobalInstallLocation(category: ResourceCategory): string {
        const config = vscode.workspace.getConfiguration('aiSkillsManager');
        return config.get<string>(
            `globalInstallLocation.${category}`,
            DEFAULT_GLOBAL_INSTALL_PATHS[category],
        );
    }

    /**
     * Get the install location for a given scope + category.
     */
    getInstallLocationForScope(category: ResourceCategory, scope: InstallScope): string {
        return scope === 'global'
            ? this.getGlobalInstallLocation(category)
            : this.getInstallLocation(category);
    }

    /**
     * Locations to scan when enumerating installed resources for a category.
     * Includes the configured local and global locations plus well-known defaults.
     */
    getScanLocations(category: ResourceCategory): string[] {
        const configured = this.getInstallLocation(category);
        const globalConfigured = this.getGlobalInstallLocation(category);
        const wellKnown = new Set<string>([
            DEFAULT_INSTALL_PATHS[category],
            `.github/${category}`,
            DEFAULT_GLOBAL_INSTALL_PATHS[category],
        ]);
        wellKnown.add(configured);
        wellKnown.add(globalConfigured);
        return [...wellKnown];
    }

    /**
     * Determine the scope of an installed resource based on its location string.
     */
    getScopeForLocation(location: string): InstallScope {
        return this.isHomeLocation(location) ? 'global' : 'local';
    }

    // ── Path helpers ────────────────────────────────────────────

    isHomeLocation(location: string): boolean {
        return location.trim().startsWith('~');
    }

    requiresWorkspaceFolder(location: string): boolean {
        return !this.isHomeLocation(location);
    }

    getWorkspaceFolderForLocation(
        location: string,
    ): vscode.WorkspaceFolder | undefined {
        if (!this.requiresWorkspaceFolder(location)) {
            return undefined;
        }
        return this.getWorkspaceFolder();
    }

    /**
     * Resolve a location string (e.g. `.agents/skills/my-skill`) to a `vscode.Uri`.
     */
    resolveLocationToUri(
        location: string,
        workspaceFolder?: vscode.WorkspaceFolder,
    ): vscode.Uri | undefined {
        const loc = location.trim();

        if (this.isHomeLocation(loc)) {
            const resolvedPath = path.join(
                this.getHomeDirectory(),
                loc.slice(1).replace(/^[/\\]+/, ''),
            );
            return vscode.Uri.file(this.normalizePath(resolvedPath));
        }

        if (!workspaceFolder) {
            return undefined;
        }

        const segments = this.normalizeWorkspaceLocation(loc)
            .split(/[\\/]+/)
            .filter((s) => s.length > 0);
        return vscode.Uri.joinPath(workspaceFolder.uri, ...segments);
    }

    /**
     * Resolve the target URI for installing a resource.
     */
    resolveInstallTarget(
        category: ResourceCategory,
        resourceName: string,
        workspaceFolder?: vscode.WorkspaceFolder,
    ): vscode.Uri | undefined {
        return this.resolveInstallTargetForScope(category, resourceName, 'local', workspaceFolder);
    }

    /**
     * Resolve the target URI for installing a resource at the given scope.
     */
    resolveInstallTargetForScope(
        category: ResourceCategory,
        resourceName: string,
        scope: InstallScope,
        workspaceFolder?: vscode.WorkspaceFolder,
    ): vscode.Uri | undefined {
        const trimmed = resourceName.trim();
        if (!trimmed || trimmed === '.' || trimmed.includes('..')) {
            return undefined;
        }

        const installLocation = this.getInstallLocationForScope(category, scope);
        const resolvedWf =
            workspaceFolder ?? this.getWorkspaceFolderForLocation(installLocation);
        const baseDir = this.resolveLocationToUri(installLocation, resolvedWf);

        if (!baseDir) {
            return undefined;
        }

        return vscode.Uri.joinPath(baseDir, trimmed);
    }

    // ── Internal normalisers ────────────────────────────────────

    private normalizeWorkspaceLocation(location: string): string {
        const normalized = path.posix.normalize(location.replace(/\\/g, '/'));
        const root = path.posix.parse(normalized).root;
        if (normalized.length <= root.length) {
            return normalized;
        }
        return normalized.replace(/\/+$/, '');
    }

    private normalizePath(value: string): string {
        const normalized = path.normalize(value);
        const root = path.parse(normalized).root;
        if (normalized.length <= root.length) {
            return normalized;
        }
        return normalized.replace(/[\\/]+$/, '');
    }
}
