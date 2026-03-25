/**
 * Resource Detail Panel – rich webview showing resource documentation,
 * install/uninstall buttons, and source link.
 *
 * Works for all resource categories.  Skills show parsed SKILL.md;
 * other resources show the file content.
 */

import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { ResourceItem, ResourceCategory, CATEGORY_LABELS, InstalledResource } from '../types';
import { InstalledTreeDataProvider } from './installedProvider';
import { PathService } from '../services/pathService';

export class ResourceDetailPanel {
    public static readonly viewType = 'aiSkillsManager.resourceDetail';

    private static panels: Map<string, ResourceDetailPanel> = new Map();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _item: ResourceItem;
    private readonly _extensionUri: vscode.Uri;
    private readonly _installedProvider: InstalledTreeDataProvider;
    private readonly _pathService: PathService;
    private _disposables: vscode.Disposable[] = [];

    // ── Constructor / factory ───────────────────────────────────

    private constructor(
        panel: vscode.WebviewPanel,
        item: ResourceItem,
        extensionUri: vscode.Uri,
        installedProvider: InstalledTreeDataProvider,
        pathService: PathService,
    ) {
        this._panel = panel;
        this._item = item;
        this._extensionUri = extensionUri;
        this._installedProvider = installedProvider;
        this._pathService = pathService;

        this._update();

        this._panel.onDidDispose(
            () => this.dispose(),
            null,
            this._disposables,
        );

        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables,
        );

        this._installedProvider.onDidChangeTreeData(
            () => this._update(),
            null,
            this._disposables,
        );

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'install':
                        await vscode.commands.executeCommand(
                            'aiSkillsManager.install',
                            this._item,
                        );
                        break;
                    case 'installGlobally':
                        await vscode.commands.executeCommand(
                            'aiSkillsManager.installGlobally',
                            this._item,
                        );
                        break;
                    case 'uninstall':
                        await vscode.commands.executeCommand(
                            'aiSkillsManager.uninstall',
                            this._item,
                        );
                        break;
                    case 'moveToGlobal': {
                        const installed = this._installedProvider.getInstalledByName(this._item.name);
                        if (installed) {
                            await vscode.commands.executeCommand(
                                'aiSkillsManager.moveToGlobal',
                                installed,
                            );
                        }
                        break;
                    }
                    case 'moveToLocal': {
                        const installed = this._installedProvider.getInstalledByName(this._item.name);
                        if (installed) {
                            await vscode.commands.executeCommand(
                                'aiSkillsManager.moveToLocal',
                                installed,
                            );
                        }
                        break;
                    }
                    case 'openExternal':
                        if (message.url) {
                            vscode.env.openExternal(
                                vscode.Uri.parse(message.url),
                            );
                        }
                        break;
                }
            },
            null,
            this._disposables,
        );
    }

    public static createOrShow(
        item: ResourceItem,
        extensionUri: vscode.Uri,
        installedProvider: InstalledTreeDataProvider,
        pathService?: PathService,
    ): ResourceDetailPanel {
        const column = vscode.window.activeTextEditor?.viewColumn;

        const existing = ResourceDetailPanel.panels.get(item.id);
        if (existing) {
            existing._panel.reveal(column);
            existing._update();
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            ResourceDetailPanel.viewType,
            item.name,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            },
        );

        const instance = new ResourceDetailPanel(
            panel,
            item,
            extensionUri,
            installedProvider,
            pathService ?? new PathService(),
        );
        ResourceDetailPanel.panels.set(item.id, instance);
        return instance;
    }

    // ── Update / dispose ────────────────────────────────────────

    private _update(): void {
        this._panel.title = this._item.name;
        this._panel.webview.html = this._getHtmlForWebview();
    }

    public dispose(): void {
        ResourceDetailPanel.panels.delete(this._item.id);
        this._panel.dispose();

        while (this._disposables.length) {
            const d = this._disposables.pop();
            d?.dispose();
        }
    }

    // ── HTML generation ─────────────────────────────────────────

    private _getHtmlForWebview(): string {
        const item = this._item;

        const hasRepo = !!(item.repo?.owner && item.repo?.repo);

        const isSkill =
            item.category === ResourceCategory.Skills &&
            item.file.type === 'dir';

        const sourceUrl = hasRepo
            ? isSkill
                ? `https://github.com/${item.repo.owner}/${item.repo.repo}/tree/${item.repo.branch}/${item.file.path}`
                : `https://github.com/${item.repo.owner}/${item.repo.repo}/blob/${item.repo.branch}/${item.file.path}`
            : '';

        const isInstalled = this._installedProvider.isInstalled(item.name);
        const installedResource: InstalledResource | undefined = isInstalled
            ? this._installedProvider.getInstalledByName(item.name)
            : undefined;
        const installedScope = installedResource?.scope;
        const nonce = this._getNonce();
        const categoryLabel = CATEGORY_LABELS[item.category];

        // Resolve install paths for button tooltips
        const localPath = this._pathService.getInstallLocationForScope(item.category, 'local');
        const globalPath = this._pathService.getInstallLocationForScope(item.category, 'global');
        const localTooltip = `Install to ${localPath}/${item.name}`;
        const globalTooltip = `Install to ${globalPath}/${item.name}`;
        const moveToGlobalTooltip = `Move to ${globalPath}/${item.name}`;
        const moveToLocalTooltip = `Move to ${localPath}/${item.name}`;

        // Render body content
        const bodyHtml = isSkill
            ? this._markdownToHtml(item.bodyContent || item.content || '')
            : this._renderFileContent(item);

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>${this._esc(item.name)}</title>
    <style>${this._getStyles()}</style>
</head>
<body>
    <div class="container">
        <div class="resource-header">
            <div class="resource-icon">${this._getCategoryEmoji(item.category)}</div>
            <div class="resource-info">
                <h1>${this._esc(item.name)}</h1>
                <p class="description">${this._esc(item.description || '')}</p>
                <div class="meta">
                    <span class="badge category">${this._esc(categoryLabel)}</span>
                    ${item.license ? `<span class="badge license">📄 ${this._esc(item.license)}</span>` : ''}
                    ${item.compatibility ? `<span class="badge compat">🔧 ${this._esc(item.compatibility)}</span>` : ''}
                    ${isInstalled ? '<span class="badge installed">✓ Installed</span>' : ''}
                </div>
                <div class="actions">
                    ${isInstalled
                ? `<button class="btn danger" id="uninstallBtn"><span class="icon">🗑️</span> Remove</button>
                   ${installedScope === 'local'
                    ? `<button class="btn secondary" id="moveToGlobalBtn" title="${this._esc(moveToGlobalTooltip)}"><span class="icon">🏠</span> Move to Global</button>`
                    : `<button class="btn secondary" id="moveToLocalBtn" title="${this._esc(moveToLocalTooltip)}"><span class="icon">📁</span> Move to Local</button>`
                }`
                : `<button class="btn primary" id="installBtn" title="${this._esc(localTooltip)}"><span class="icon">⬇️</span> Install Locally</button>
                   <button class="btn primary" id="installGloballyBtn" title="${this._esc(globalTooltip)}"><span class="icon">🏠</span> Install Globally</button>`
            }
                    ${hasRepo ? '<button class="btn secondary" id="sourceBtn"><span class="icon">📂</span> View Source</button>' : ''}
                </div>
            </div>
        </div>

        ${hasRepo ? `
        <div class="source-info">
            <span class="label">Source:</span>
            <a href="#" id="sourceLink">${this._esc(item.repo.owner)}/${this._esc(item.repo.repo)}/${this._esc(item.file.path)}</a>
        </div>` : `
        <div class="source-info">
            <span class="label">Location:</span>
            <span>${this._esc(item.file.path)}</span>
        </div>`}

        ${isSkill
                ? `
        <div class="tabs">
            <button class="tab active" data-tab="readme">README</button>
            <button class="tab" data-tab="raw">Raw SKILL.md</button>
        </div>
        <div id="readme" class="tab-content active">
            <div class="resource-content">${bodyHtml}</div>
        </div>
        <div id="raw" class="tab-content">
            <pre class="raw-content"><code>${this._esc(item.fullContent || '')}</code></pre>
        </div>`
                : `
        <div class="resource-content">${bodyHtml}</div>`
            }
    </div>

    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            const sourceUrl = '${sourceUrl}';

            function install()        { vscode.postMessage({ command: 'install' }); }
            function installGlobally(){ vscode.postMessage({ command: 'installGlobally' }); }
            function uninstall()      { vscode.postMessage({ command: 'uninstall' }); }
            function moveToGlobal()   { vscode.postMessage({ command: 'moveToGlobal' }); }
            function moveToLocal()    { vscode.postMessage({ command: 'moveToLocal' }); }
            function openSource()     { vscode.postMessage({ command: 'openExternal', url: sourceUrl }); }

            function showTab(tabId) {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelector('[data-tab="' + tabId + '"]').classList.add('active');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(tabId).classList.add('active');
            }

            var ib = document.getElementById('installBtn');
            if (ib) ib.addEventListener('click', install);
            var igb = document.getElementById('installGloballyBtn');
            if (igb) igb.addEventListener('click', installGlobally);
            var ub = document.getElementById('uninstallBtn');
            if (ub) ub.addEventListener('click', uninstall);
            var mtg = document.getElementById('moveToGlobalBtn');
            if (mtg) mtg.addEventListener('click', moveToGlobal);
            var mtl = document.getElementById('moveToLocalBtn');
            if (mtl) mtl.addEventListener('click', moveToLocal);
            var sb = document.getElementById('sourceBtn');
            if (sb) sb.addEventListener('click', openSource);
            var sl = document.getElementById('sourceLink');
            if (sl) sl.addEventListener('click', function(e){ e.preventDefault(); openSource(); });
            document.querySelectorAll('.tab').forEach(function(tab){
                tab.addEventListener('click', function(){ showTab(this.getAttribute('data-tab')); });
            });
        })();
    </script>
</body>
</html>`;
    }

    private _renderFileContent(item: ResourceItem): string {
        if (!item.content) {
            return '<p><em>Content not yet loaded. Click "Download" to save this file to your project.</em></p>';
        }

        // Render markdown content
        if (
            item.name.endsWith('.md') ||
            item.name.endsWith('.prompt.md') ||
            item.name.endsWith('.instructions.md')
        ) {
            return this._markdownToHtml(item.content);
        }

        // Render other content as code block
        return `<pre class="raw-content"><code>${this._esc(item.content)}</code></pre>`;
    }

    private _getErrorHtml(message: string): string {
        return /* html */ `<!DOCTYPE html>
<html lang="en"><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <title>Error</title>
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
        .error { color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); padding: 12px; border-radius: 4px; border: 1px solid var(--vscode-inputValidation-errorBorder); }
    </style>
</head><body>
    <div class="error"><strong>Error:</strong> ${this._esc(message)}</div>
</body></html>`;
    }

    // ── Styles ──────────────────────────────────────────────────

    private _getStyles(): string {
        return `
* { box-sizing: border-box; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 0; margin: 0; line-height: 1.6; }
.container { max-width: 900px; margin: 0 auto; padding: 24px; }
.resource-header { display: flex; gap: 20px; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--vscode-panel-border); }
.resource-icon { font-size: 64px; line-height: 1; }
.resource-info { flex: 1; }
h1 { font-size: 1.8em; margin: 0 0 8px 0; color: var(--vscode-foreground); font-weight: 600; }
h2 { font-size: 1.3em; margin: 24px 0 12px 0; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }
h3 { font-size: 1.1em; margin: 16px 0 8px 0; }
.description { color: var(--vscode-descriptionForeground); margin: 0 0 12px 0; font-size: 1.1em; }
.meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.badge { display: inline-block; padding: 4px 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 4px; font-size: 0.85em; }
.badge.installed { background: var(--vscode-diffEditor-insertedTextBackground); }
.actions { display: flex; gap: 8px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 1em; font-family: inherit; }
.btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn.primary:hover { background: var(--vscode-button-hoverBackground); }
.btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn.danger { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
.btn.danger:hover { opacity: 0.8; }
.source-info { background: var(--vscode-textBlockQuote-background); padding: 8px 12px; border-radius: 4px; margin-bottom: 16px; font-size: 0.9em; }
.source-info .label { color: var(--vscode-descriptionForeground); }
.source-info a { color: var(--vscode-textLink-foreground); text-decoration: none; }
.source-info a:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
.tabs { display: flex; gap: 0; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 16px; }
.tab { padding: 8px 16px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--vscode-foreground); cursor: pointer; font-size: 1em; font-family: inherit; opacity: 0.7; }
.tab:hover { opacity: 1; }
.tab.active { border-bottom-color: var(--vscode-focusBorder); opacity: 1; }
.tab-content { display: none; }
.tab-content.active { display: block; }
.resource-content { line-height: 1.7; }
.raw-content { background: var(--vscode-textCodeBlock-background); padding: 16px; border-radius: 4px; overflow-x: auto; font-size: 0.9em; }
code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
pre { background: var(--vscode-textCodeBlock-background); padding: 16px; border-radius: 4px; overflow-x: auto; }
pre code { background: transparent; padding: 0; }
ul, ol { padding-left: 24px; margin: 12px 0; }
li { margin: 6px 0; }
a { color: var(--vscode-textLink-foreground); }
a:hover { color: var(--vscode-textLink-activeForeground); }
blockquote { border-left: 4px solid var(--vscode-textBlockQuote-border); margin: 12px 0; padding: 8px 16px; background: var(--vscode-textBlockQuote-background); color: var(--vscode-textBlockQuote-foreground); }
table { border-collapse: collapse; width: 100%; margin: 12px 0; }
th, td { border: 1px solid var(--vscode-panel-border); padding: 8px 12px; text-align: left; }
th { background: var(--vscode-textBlockQuote-background); }
.table-container { overflow-x: auto; margin: 12px 0; }
`;
    }

    // ── Markdown rendering ──────────────────────────────────────

    private _markdownToHtml(markdown: string): string {
        if (!markdown) {
            return '<p><em>No additional details available.</em></p>';
        }

        const md = new MarkdownIt({
            html: false,
            linkify: true,
            typographer: true,
        });

        md.enable('table');

        let html = md.render(markdown);
        html = html.replace(/<table>/g, '<div class="table-container"><table>');
        html = html.replace(/<\/table>/g, '</table></div>');
        return html;
    }

    // ── Category emoji ──────────────────────────────────────────

    private _getCategoryEmoji(category: ResourceCategory): string {
        switch (category) {
            case ResourceCategory.ChatModes:
                return '💬';
            case ResourceCategory.Instructions:
                return '📖';
            case ResourceCategory.Prompts:
                return '💡';
            case ResourceCategory.Agents:
                return '🤖';
            case ResourceCategory.Skills:
                return '📦';
        }
    }

    // ── Utilities ───────────────────────────────────────────────

    private _esc(text: string): string {
        const map: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
        };
        return text.replace(/[&<>"']/g, (m) => map[m]);
    }

    private _getNonce(): string {
        let text = '';
        const chars =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return text;
    }
}
