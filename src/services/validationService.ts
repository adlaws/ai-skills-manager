/**
 * Validation Service – health checks for installed resources.
 *
 * Checks for common issues: missing files, empty resources, invalid
 * SKILL.md frontmatter, and unreadable content.
 */

import * as vscode from 'vscode';
import {
    InstalledResource,
    ResourceCategory,
    CATEGORY_LABELS,
} from '../types';
import { PathService } from './pathService';

// ── Issue types ─────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
    resource: InstalledResource;
    severity: ValidationSeverity;
    message: string;
    detail?: string;
}

// ── Service ─────────────────────────────────────────────────────

export class ValidationService {
    constructor(private readonly pathService: PathService) { }

    /**
     * Validate all installed resources and return a list of issues.
     */
    async validate(
        resources: InstalledResource[],
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        for (const resource of resources) {
            const resourceIssues = await this.validateResource(resource);
            issues.push(...resourceIssues);
        }

        return issues;
    }

    /**
     * Validate a single installed resource.
     */
    private async validateResource(
        resource: InstalledResource,
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];
        const wf = this.pathService.getWorkspaceFolderForLocation(resource.location);
        const uri = this.pathService.resolveLocationToUri(resource.location, wf);

        if (!uri) {
            issues.push({
                resource,
                severity: 'error',
                message: 'Cannot resolve location',
                detail: `Location: ${resource.location}`,
            });
            return issues;
        }

        // Check if the resource exists on disk
        try {
            const stat = await vscode.workspace.fs.stat(uri);

            if (resource.category === ResourceCategory.Skills) {
                // Skills: validate directory structure
                if (!(stat.type & vscode.FileType.Directory)) {
                    issues.push({
                        resource,
                        severity: 'error',
                        message: 'Expected a directory but found a file',
                    });
                    return issues;
                }

                // Check for SKILL.md
                const skillMdUri = vscode.Uri.joinPath(uri, 'SKILL.md');
                try {
                    const content = new TextDecoder().decode(
                        await vscode.workspace.fs.readFile(skillMdUri),
                    );

                    if (content.trim().length === 0) {
                        issues.push({
                            resource,
                            severity: 'warning',
                            message: 'SKILL.md is empty',
                        });
                    } else {
                        // Validate frontmatter
                        const fmMatch = content.match(
                            /^---\r?\n([\s\S]*?)\r?\n---/,
                        );
                        if (!fmMatch) {
                            issues.push({
                                resource,
                                severity: 'warning',
                                message: 'SKILL.md has no YAML frontmatter',
                                detail: 'Expected frontmatter block wrapped in --- delimiters',
                            });
                        } else {
                            const yaml = fmMatch[1];
                            if (!yaml.match(/^name:\s*.+$/m)) {
                                issues.push({
                                    resource,
                                    severity: 'warning',
                                    message: 'SKILL.md frontmatter missing "name" field',
                                });
                            }
                            if (!yaml.match(/^description:\s*.+$/m)) {
                                issues.push({
                                    resource,
                                    severity: 'info',
                                    message: 'SKILL.md frontmatter missing "description" field',
                                });
                            }
                        }
                    }
                } catch {
                    issues.push({
                        resource,
                        severity: 'error',
                        message: 'Missing SKILL.md',
                        detail: 'Skill folders must contain a SKILL.md file',
                    });
                }

                // Check if directory is empty (besides SKILL.md)
                try {
                    const entries = await vscode.workspace.fs.readDirectory(uri);
                    if (entries.length === 0) {
                        issues.push({
                            resource,
                            severity: 'error',
                            message: 'Skill folder is empty',
                        });
                    } else if (entries.length === 1 && entries[0][0] === 'SKILL.md') {
                        issues.push({
                            resource,
                            severity: 'info',
                            message: 'Skill folder only contains SKILL.md (no implementation files)',
                        });
                    }
                } catch {
                    issues.push({
                        resource,
                        severity: 'error',
                        message: 'Cannot read skill folder contents',
                    });
                }
            } else {
                // Single-file resources
                if (!(stat.type & vscode.FileType.File)) {
                    issues.push({
                        resource,
                        severity: 'error',
                        message: 'Expected a file but found a directory',
                    });
                    return issues;
                }

                // Check if file is empty
                if (stat.size === 0) {
                    issues.push({
                        resource,
                        severity: 'warning',
                        message: 'Resource file is empty (0 bytes)',
                    });
                } else {
                    // Try to read content to check readability
                    try {
                        const content = new TextDecoder().decode(
                            await vscode.workspace.fs.readFile(uri),
                        );

                        // Check for markdown resources with no content
                        if (
                            resource.name.endsWith('.md') &&
                            content.trim().length < 10
                        ) {
                            issues.push({
                                resource,
                                severity: 'info',
                                message: 'Resource file has very little content',
                            });
                        }

                        // Validate frontmatter for resources that should have it
                        if (
                            resource.name.endsWith('.instructions.md') ||
                            resource.name.endsWith('.chatmode.md') ||
                            resource.name.endsWith('.prompt.md') ||
                            resource.name.endsWith('.agent.md')
                        ) {
                            if (!content.match(/^---\r?\n/)) {
                                issues.push({
                                    resource,
                                    severity: 'info',
                                    message: 'Resource file has no YAML frontmatter',
                                    detail: 'Most resource types benefit from a frontmatter block with metadata',
                                });
                            }
                        }
                    } catch {
                        issues.push({
                            resource,
                            severity: 'warning',
                            message: 'Resource file could not be read as text',
                        });
                    }
                }
            }
        } catch {
            issues.push({
                resource,
                severity: 'error',
                message: 'Resource not found on disk',
                detail: `Expected at: ${uri.fsPath}`,
            });
        }

        return issues;
    }

    /**
     * Show validation results in a quick pick + output channel.
     */
    async showResults(issues: ValidationIssue[], total: number): Promise<void> {
        if (issues.length === 0) {
            vscode.window.showInformationMessage(
                `All ${total} installed resource${total !== 1 ? 's' : ''} passed validation.`,
            );
            return;
        }

        const errors = issues.filter((i) => i.severity === 'error').length;
        const warnings = issues.filter((i) => i.severity === 'warning').length;
        const infos = issues.filter((i) => i.severity === 'info').length;

        const summary = [
            errors > 0 ? `${errors} error${errors !== 1 ? 's' : ''}` : '',
            warnings > 0 ? `${warnings} warning${warnings !== 1 ? 's' : ''}` : '',
            infos > 0 ? `${infos} info${infos !== 1 ? 's' : ''}` : '',
        ]
            .filter(Boolean)
            .join(', ');

        const icons: Record<ValidationSeverity, string> = {
            error: '$(error)',
            warning: '$(warning)',
            info: '$(info)',
        };

        const picks = issues.map((issue) => ({
            label: `${icons[issue.severity]} ${issue.resource.name}`,
            description: CATEGORY_LABELS[issue.resource.category],
            detail: `${issue.message}${issue.detail ? ` — ${issue.detail}` : ''}`,
            issue,
        }));

        const pick = await vscode.window.showQuickPick(picks, {
            placeHolder: `Found ${summary} across ${total} resource${total !== 1 ? 's' : ''}`,
            title: 'Validation Results',
        });

        if (pick) {
            // Open the resource
            const wf = this.pathService.getWorkspaceFolderForLocation(pick.issue.resource.location);
            const uri = this.pathService.resolveLocationToUri(pick.issue.resource.location, wf);
            if (uri) {
                try {
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.type & vscode.FileType.Directory) {
                        const skillMd = vscode.Uri.joinPath(uri, 'SKILL.md');
                        try {
                            await vscode.workspace.fs.stat(skillMd);
                            await vscode.window.showTextDocument(skillMd);
                        } catch {
                            await vscode.commands.executeCommand('revealInExplorer', uri);
                        }
                    } else {
                        await vscode.window.showTextDocument(uri);
                    }
                } catch {
                    // Resource not found
                }
            }
        }
    }
}
