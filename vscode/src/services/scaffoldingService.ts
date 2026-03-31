/**
 * Scaffolding Service – creates new resources from built-in templates.
 *
 * Supports creating Chat Modes, Instructions, Prompts, Agents, and Skills
 * with sensible template content.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { ResourceCategory, CATEGORY_LABELS, InstallScope } from '../types';
import { PathService } from './pathService';

// ── Templates ───────────────────────────────────────────────────

const TEMPLATES: Record<ResourceCategory, (name: string) => { filename: string; content: string; files?: { path: string; content: string }[] }> = {
    [ResourceCategory.ChatModes]: (name: string) => ({
        filename: `${name}.chatmode.md`,
        content: `---
description: ${name} chat mode
tools: []
---

# ${name}

Describe the behaviour of this chat mode here. This defines how the AI
assistant should behave when this mode is active.

## Guidelines

- Provide clear, focused responses
- Follow the conventions appropriate to this mode
`,
    }),

    [ResourceCategory.Instructions]: (name: string) => ({
        filename: `${name}.instructions.md`,
        content: `---
description: ${name} instructions
applyTo: "**/*"
---

# ${name}

These instructions guide the AI assistant's behaviour.

## Rules

- Follow project conventions
- Be concise and accurate

## Context

Add any relevant context about when these instructions should apply.
`,
    }),

    [ResourceCategory.Prompts]: (name: string) => ({
        filename: `${name}.prompt.md`,
        content: `---
description: ${name} prompt
mode: agent
tools: []
---

# ${name}

Describe the task this prompt should accomplish.

## Steps

1. First, analyse the problem
2. Then, propose a solution
3. Finally, implement the changes

## Additional Context

Add any relevant variables or context here using \`#\` references.
`,
    }),

    [ResourceCategory.Agents]: (name: string) => ({
        filename: `${name}.agent.md`,
        content: `---
description: ${name} agent
tools: []
---

# ${name}

You are a specialised AI agent focused on a specific task domain.

## Capabilities

- Describe what this agent can do
- List the tools it should use
- Define its area of expertise

## Behaviour

Define how this agent should behave, respond, and interact.
`,
    }),

    [ResourceCategory.Skills]: (name: string) => ({
        filename: name, // Skills use a directory name
        content: '', // Not used directly — uses files array
        files: [
            {
                path: 'SKILL.md',
                content: `---
name: ${name}
description: A brief description of what this skill does
license: MIT
compatibility: Claude 3.5 Sonnet, Claude 3 Opus
---

## ${name}

Describe this skill's purpose and capabilities.

## Usage

\`\`\`
Explain how to use this skill in a conversation.
\`\`\`

## Examples

Provide examples of inputs and expected outputs.
`,
            },
            {
                path: 'README.md',
                content: `# ${name}

A brief overview of this skill.

## Installation

Install via the AI Skills Manager extension or copy the folder to your
\`.agents/skills/\` directory.

## Contributing

Describe how others can contribute to this skill.
`,
            },
        ],
    }),
};

// ── Service ─────────────────────────────────────────────────────

export class ScaffoldingService {
    constructor(private readonly pathService: PathService) { }

    /**
     * Prompt the user to create a new resource, selecting category,
     * name, and scope, then scaffold the resource from a template.
     */
    async createResource(): Promise<boolean> {
        // 1. Pick a category
        const categoryPick = await vscode.window.showQuickPick(
            Object.values(ResourceCategory).map((cat) => ({
                label: CATEGORY_LABELS[cat],
                description: cat,
                category: cat,
            })),
            {
                placeHolder: 'What type of resource do you want to create?',
                title: 'Create New Resource',
            },
        );

        if (!categoryPick) {
            return false;
        }

        const category = categoryPick.category;

        // 2. Enter a name
        const name = await vscode.window.showInputBox({
            prompt: `Enter a name for the new ${CATEGORY_LABELS[category].toLowerCase()}`,
            placeHolder: category === ResourceCategory.Skills ? 'my-awesome-skill' : 'my-resource',
            validateInput: (value) => {
                const trimmed = value.trim();
                if (!trimmed) {
                    return 'Name is required';
                }
                if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
                    return 'Name cannot contain path separators or ".."';
                }
                // For non-skills, the name should not contain the extension
                // (the template adds it)
                if (category !== ResourceCategory.Skills) {
                    const extensions: Record<string, string> = {
                        [ResourceCategory.ChatModes]: '.chatmode.md',
                        [ResourceCategory.Instructions]: '.instructions.md',
                        [ResourceCategory.Prompts]: '.prompt.md',
                        [ResourceCategory.Agents]: '.agent.md',
                    };
                    const ext = extensions[category];
                    if (ext && trimmed.endsWith(ext)) {
                        return `Just enter the base name (without ${ext})`;
                    }
                }
                return null;
            },
        });

        if (!name) {
            return false;
        }

        const trimmedName = name.trim();

        // 3. Pick a scope
        const scopePick = await vscode.window.showQuickPick(
            [
                {
                    label: '$(folder) Workspace',
                    description: 'Create in the current workspace',
                    scope: 'local' as InstallScope,
                },
                {
                    label: '$(home) Global',
                    description: 'Create in the home directory (shared across workspaces)',
                    scope: 'global' as InstallScope,
                },
            ],
            {
                placeHolder: 'Where should the resource be created?',
                title: 'Select Scope',
            },
        );

        if (!scopePick) {
            return false;
        }

        const scope = scopePick.scope;

        // 4. Resolve target
        const installLocation = this.pathService.getInstallLocationForScope(category, scope);
        const wf = this.pathService.getWorkspaceFolderForLocation(installLocation);

        if (this.pathService.requiresWorkspaceFolder(installLocation) && !wf) {
            vscode.window.showErrorMessage(
                'No workspace folder open. Please open a folder first.',
            );
            return false;
        }

        const baseDir = this.pathService.resolveLocationToUri(installLocation, wf);
        if (!baseDir) {
            vscode.window.showErrorMessage('Failed to resolve install location.');
            return false;
        }

        // 5. Generate from template
        const template = TEMPLATES[category](trimmedName);

        try {
            if (category === ResourceCategory.Skills && template.files) {
                // Skills are directories with multiple files
                const skillDir = vscode.Uri.joinPath(baseDir, trimmedName);

                try {
                    await vscode.workspace.fs.stat(skillDir);
                    vscode.window.showWarningMessage(
                        `Skill "${trimmedName}" already exists at that location.`,
                    );
                    return false;
                } catch {
                    // Doesn't exist — good
                }

                await vscode.workspace.fs.createDirectory(skillDir);

                for (const file of template.files) {
                    const fileUri = vscode.Uri.joinPath(skillDir, file.path);
                    const parentDir = vscode.Uri.joinPath(fileUri, '..');
                    await vscode.workspace.fs.createDirectory(parentDir);
                    await vscode.workspace.fs.writeFile(
                        fileUri,
                        new TextEncoder().encode(file.content),
                    );
                }

                // Open the SKILL.md file
                const skillMd = vscode.Uri.joinPath(skillDir, 'SKILL.md');
                await vscode.window.showTextDocument(skillMd);

                vscode.window.showInformationMessage(
                    `Created skill "${trimmedName}" at ${path.relative(wf?.uri.fsPath || '', skillDir.fsPath) || skillDir.fsPath}`,
                );
            } else {
                // Single-file resources
                const fileUri = vscode.Uri.joinPath(baseDir, template.filename);

                try {
                    await vscode.workspace.fs.stat(fileUri);
                    vscode.window.showWarningMessage(
                        `"${template.filename}" already exists at that location.`,
                    );
                    return false;
                } catch {
                    // Doesn't exist — good
                }

                await vscode.workspace.fs.createDirectory(baseDir);
                await vscode.workspace.fs.writeFile(
                    fileUri,
                    new TextEncoder().encode(template.content),
                );

                await vscode.window.showTextDocument(fileUri);

                vscode.window.showInformationMessage(
                    `Created "${template.filename}"`,
                );
            }

            return true;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to create resource: ${msg}`);
            return false;
        }
    }
}
