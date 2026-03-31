/**
 * Usage Detection Service – scans workspace files for references to
 * installed resources.
 *
 * Searches well-known configuration files and markdown documents for
 * resource names to determine which installed resources are actually
 * being referenced in the current workspace.
 */

import * as vscode from 'vscode';
import { InstalledResource, CATEGORY_LABELS } from '../types';

// ── Types ───────────────────────────────────────────────────────

export interface UsageResult {
    /** Resource name → list of file references. */
    usageMap: Map<string, UsageReference[]>;
    /** Set of resource names that are in use. */
    inUseNames: Set<string>;
    /** Set of resource names that appear unused. */
    unusedNames: Set<string>;
}

export interface UsageReference {
    /** Uri of the file containing the reference. */
    uri: vscode.Uri;
    /** Line number (1-based). */
    line: number;
    /** The line text containing the reference. */
    text: string;
}

// ── Files to scan ───────────────────────────────────────────────

/**
 * Glob patterns for files likely to reference AI resources.
 */
const SCAN_PATTERNS = [
    '**/.github/copilot-instructions.md',
    '**/.vscode/settings.json',
    '**/.vscode/mcp.json',
    '**/copilot-instructions.md',
    '**/.copilot-codegeneration-instructions.md',
    '**/.github/instructions/*.md',
    '**/.github/prompts/*.md',
    '**/.github/chatmodes/*.md',
    '**/.github/agents/*.md',
    '**/AGENTS.md',
    '**/CLAUDE.md',
    '**/.claude/settings.json',
    '**/.cursorrules',
    '**/package.json',
];

// ── Service ─────────────────────────────────────────────────────

export class UsageDetectionService {
    /**
     * Scan workspace files for references to installed resource names.
     */
    async detectUsage(
        resources: InstalledResource[],
    ): Promise<UsageResult> {
        const usageMap = new Map<string, UsageReference[]>();
        const inUseNames = new Set<string>();
        const unusedNames = new Set<string>();

        if (resources.length === 0) {
            return { usageMap, inUseNames, unusedNames };
        }

        // Build basename set (without extension) for fuzzy matching
        const baseNames = new Map<string, string>();
        for (const r of resources) {
            const base = r.name.replace(/\.[^.]+$/, '').replace(/\.(chatmode|instructions|prompt|agent)$/, '');
            baseNames.set(base.toLowerCase(), r.name);
            baseNames.set(r.name.toLowerCase(), r.name);
        }

        // Collect all files to scan
        const fileUris: vscode.Uri[] = [];
        for (const pattern of SCAN_PATTERNS) {
            try {
                const found = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 50);
                fileUris.push(...found);
            } catch {
                // Pattern didn't match — continue
            }
        }

        // Deduplicate
        const seen = new Set<string>();
        const uniqueUris = fileUris.filter((uri) => {
            if (seen.has(uri.fsPath)) { return false; }
            seen.add(uri.fsPath);
            return true;
        });

        // Scan each file for resource name references
        for (const uri of uniqueUris) {
            try {
                const content = new TextDecoder().decode(
                    await vscode.workspace.fs.readFile(uri),
                );
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const lineLower = lines[i].toLowerCase();

                    for (const [searchName, resourceName] of baseNames) {
                        if (lineLower.includes(searchName)) {
                            const refs = usageMap.get(resourceName) ?? [];
                            refs.push({
                                uri,
                                line: i + 1,
                                text: lines[i].trim(),
                            });
                            usageMap.set(resourceName, refs);
                            inUseNames.add(resourceName);
                        }
                    }
                }
            } catch {
                // File unreadable — skip
            }
        }

        // Determine unused resources
        for (const r of resources) {
            if (!inUseNames.has(r.name)) {
                unusedNames.add(r.name);
            }
        }

        return { usageMap, inUseNames, unusedNames };
    }

    /**
     * Show usage results in a quick pick.
     */
    async showResults(
        result: UsageResult,
        resources: InstalledResource[],
    ): Promise<void> {
        const items: {
            label: string;
            description: string;
            detail?: string;
            resource?: InstalledResource;
            ref?: UsageReference;
        }[] = [];

        // In-use resources
        for (const r of resources) {
            const refs = result.usageMap.get(r.name);
            if (refs && refs.length > 0) {
                items.push({
                    label: `$(check) ${r.name}`,
                    description: `${CATEGORY_LABELS[r.category]} — ${refs.length} reference${refs.length !== 1 ? 's' : ''}`,
                    resource: r,
                });

                // Add sub-items for each reference
                for (const ref of refs.slice(0, 3)) { // Limit to 3 per resource
                    const relativePath = vscode.workspace.asRelativePath(ref.uri);
                    items.push({
                        label: `    $(file) ${relativePath}:${ref.line}`,
                        description: ref.text.substring(0, 80),
                        ref,
                    });
                }
                if (refs.length > 3) {
                    items.push({
                        label: `    … and ${refs.length - 3} more reference${refs.length - 3 !== 1 ? 's' : ''}`,
                        description: '',
                    });
                }
            }
        }

        // Separator
        if (result.unusedNames.size > 0 && items.length > 0) {
            items.push({
                label: '',
                description: '───────────────────────',
            });
        }

        // Unused resources
        for (const r of resources) {
            if (result.unusedNames.has(r.name)) {
                items.push({
                    label: `$(circle-slash) ${r.name}`,
                    description: `${CATEGORY_LABELS[r.category]} — not referenced in workspace`,
                    resource: r,
                });
            }
        }

        const summaryText = `${result.inUseNames.size} in use, ${result.unusedNames.size} unused`;

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: summaryText,
            title: 'Resource Usage Detection',
        });

        if (pick?.ref) {
            // Open the file at the reference location
            const doc = await vscode.workspace.openTextDocument(pick.ref.uri);
            await vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(
                    new vscode.Position(pick.ref.line - 1, 0),
                    new vscode.Position(pick.ref.line - 1, pick.ref.text.length),
                ),
            });
        } else if (pick?.resource) {
            // View details for the resource
            await vscode.commands.executeCommand(
                'aiSkillsManager.viewDetails',
                pick.resource,
            );
        }
    }
}
