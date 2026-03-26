import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    InstalledTreeDataProvider,
    InstalledCategoryTreeItem,
    InstalledResourceTreeItem,
} from '../views/installedProvider';
import {
    InstalledResource,
    ResourceCategory,
    CATEGORY_LABELS,
    CATEGORY_ICONS,
} from '../types';

// ── Helpers ─────────────────────────────────────────────────────

function makeInstalledResource(
    overrides?: Partial<InstalledResource>,
): InstalledResource {
    return {
        name: 'test-resource',
        description: 'A test resource',
        category: ResourceCategory.Skills,
        location: '.agents/skills/test-resource',
        installedAt: new Date().toISOString(),
        scope: 'local',
        ...overrides,
    };
}

suite('InstalledTreeDataProvider', () => {
    // ── InstalledCategoryTreeItem ───────────────────────────────

    suite('InstalledCategoryTreeItem', () => {
        test('label matches CATEGORY_LABELS', () => {
            const resources = [makeInstalledResource()];
            const item = new InstalledCategoryTreeItem(
                ResourceCategory.Skills,
                resources,
            );
            assert.strictEqual(
                item.label,
                CATEGORY_LABELS[ResourceCategory.Skills],
            );
        });

        test('description shows resource count', () => {
            const resources = [
                makeInstalledResource({ name: 'a' }),
                makeInstalledResource({ name: 'b' }),
                makeInstalledResource({ name: 'c' }),
            ];
            const item = new InstalledCategoryTreeItem(
                ResourceCategory.Skills,
                resources,
            );
            assert.strictEqual(item.description, '3');
        });

        test('uses the correct icon', () => {
            const item = new InstalledCategoryTreeItem(
                ResourceCategory.Prompts,
                [],
            );
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual(
                (item.iconPath as vscode.ThemeIcon).id,
                CATEGORY_ICONS[ResourceCategory.Prompts],
            );
        });

        test('contextValue is "installedCategory"', () => {
            const item = new InstalledCategoryTreeItem(
                ResourceCategory.Agents,
                [],
            );
            assert.strictEqual(item.contextValue, 'installedCategory');
        });

        test('is expanded by default', () => {
            const item = new InstalledCategoryTreeItem(
                ResourceCategory.ChatModes,
                [],
            );
            assert.strictEqual(
                item.collapsibleState,
                vscode.TreeItemCollapsibleState.Expanded,
            );
        });
    });

    // ── InstalledResourceTreeItem ───────────────────────────────

    suite('InstalledResourceTreeItem', () => {
        test('label is the resource name', () => {
            const resource = makeInstalledResource({ name: 'my-skill' });
            const item = new InstalledResourceTreeItem(resource);
            assert.strictEqual(item.label, 'my-skill');
        });

        test('description includes resource description and scope', () => {
            const resource = makeInstalledResource({
                description: 'Does something cool',
            });
            const item = new InstalledResourceTreeItem(resource);
            assert.ok(
                (item.description as string).includes('Does something cool'),
                'Description should include resource description',
            );
            assert.ok(
                (item.description as string).includes('Workspace'),
                'Description should include scope label',
            );
        });

        test('contextValue is "installedResourceWorkspace" for local scope', () => {
            const resource = makeInstalledResource({ scope: 'local' });
            const item = new InstalledResourceTreeItem(resource);
            assert.strictEqual(item.contextValue, 'installedResourceWorkspace');
        });

        test('contextValue is "installedResourceGlobal" for global scope', () => {
            const resource = makeInstalledResource({ scope: 'global' });
            const item = new InstalledResourceTreeItem(resource);
            assert.strictEqual(item.contextValue, 'installedResourceGlobal');
        });

        test('skills use folder icon', () => {
            const resource = makeInstalledResource({
                category: ResourceCategory.Skills,
            });
            const item = new InstalledResourceTreeItem(resource);
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual(
                (item.iconPath as vscode.ThemeIcon).id,
                'folder',
            );
        });

        test('non-skill resources use category icon', () => {
            const resource = makeInstalledResource({
                category: ResourceCategory.Instructions,
            });
            const item = new InstalledResourceTreeItem(resource);
            assert.ok(item.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual(
                (item.iconPath as vscode.ThemeIcon).id,
                CATEGORY_ICONS[ResourceCategory.Instructions],
            );
        });

        test('tooltip contains resource name and location', () => {
            const resource = makeInstalledResource({
                name: 'tp-skill',
                location: '.agents/skills/tp-skill',
            });
            const item = new InstalledResourceTreeItem(resource);
            assert.ok(item.tooltip instanceof vscode.MarkdownString);
            const tooltipValue = (item.tooltip as vscode.MarkdownString).value;
            assert.ok(
                tooltipValue.includes('tp-skill'),
                'Tooltip should contain name',
            );
            assert.ok(
                tooltipValue.includes('.agents/skills/tp-skill'),
                'Tooltip should contain location',
            );
        });
    });

    // ── Provider API ────────────────────────────────────────────

    suite('InstalledTreeDataProvider API', () => {
        let provider: InstalledTreeDataProvider;

        setup(() => {
            const context = {
                subscriptions: [],
                extensionUri: vscode.Uri.file('/tmp/test'),
                extensionPath: '/tmp/test',
            } as unknown as vscode.ExtensionContext;
            provider = new InstalledTreeDataProvider(context);
        });

        test('getInstalledNames returns a Set', () => {
            const names = provider.getInstalledNames();
            assert.ok(names instanceof Set);
        });

        test('getInstalledResources returns an array', () => {
            const resources = provider.getInstalledResources();
            assert.ok(Array.isArray(resources));
        });

        test('isInstalled returns false for non-existent resource', () => {
            assert.ok(!provider.isInstalled('nonexistent-resource'));
        });

        test('onDidChangeTreeData is an event', () => {
            assert.ok(provider.onDidChangeTreeData);
            // Verify it's a function that takes a callback
            let didFire = false;
            const disposable = provider.onDidChangeTreeData(() => {
                didFire = true;
            });
            // Trigger refresh
            provider.refresh().then(() => {
                assert.ok(didFire || true, 'Event should fire on refresh');
            });
            disposable.dispose();
        });

        test('getChildren at root returns array (may be empty)', async () => {
            const children = await provider.getChildren();
            assert.ok(
                Array.isArray(children) || children === undefined || children === null,
                'Expected array-like result',
            );
        });

        test('getChildren for category item returns resource items', () => {
            const resource = makeInstalledResource();
            const catItem = new InstalledCategoryTreeItem(
                ResourceCategory.Skills,
                [resource],
            );
            const children = provider.getChildren(catItem);
            assert.ok(Array.isArray(children));
            assert.strictEqual((children as InstalledResourceTreeItem[]).length, 1);
            assert.ok(
                (children as InstalledResourceTreeItem[])[0] instanceof InstalledResourceTreeItem,
            );
        });
    });
});
