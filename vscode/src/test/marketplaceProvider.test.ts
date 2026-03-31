import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    MarketplaceTreeDataProvider,
    RepoTreeItem,
    CategoryTreeItem,
    ResourceTreeItem,
} from '../views/marketplaceProvider';
import { ResourceClient } from '../github/resourceClient';
import {
    ResourceCategory,
    ResourceItem,
    ResourceRepository,
    CATEGORY_LABELS,
} from '../types';

// ── Helpers ─────────────────────────────────────────────────────

function makeRepo(overrides?: Partial<ResourceRepository>): ResourceRepository {
    return {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        enabled: true,
        ...overrides,
    };
}

function makeResourceItem(
    name: string,
    category: ResourceCategory,
    repo: ResourceRepository,
    overrides?: Partial<ResourceItem>,
): ResourceItem {
    return {
        id: `${category}-${name}-${repo.owner}-${repo.repo}`,
        name,
        category,
        file: {
            name,
            path: `${category}/${name}`,
            download_url: `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/main/${category}/${name}`,
            size: 1024,
            type: category === ResourceCategory.Skills ? 'dir' : 'file',
        },
        repo,
        ...overrides,
    };
}

suite('MarketplaceTreeDataProvider', () => {
    // ── RepoTreeItem ────────────────────────────────────────────

    suite('RepoTreeItem', () => {
        test('uses label if provided', () => {
            const repo = makeRepo({ label: 'My Repo' });
            const item = new RepoTreeItem(repo, 3);
            assert.strictEqual(item.label, 'My Repo');
        });

        test('falls back to owner/repo if no label', () => {
            const repo = makeRepo({ label: undefined });
            const item = new RepoTreeItem(repo, 2);
            assert.strictEqual(item.label, 'test-owner/test-repo');
        });

        test('description shows owner/repo', () => {
            const repo = makeRepo();
            const item = new RepoTreeItem(repo, 1);
            assert.strictEqual(item.description, 'test-owner/test-repo');
        });

        test('contextValue is "repo"', () => {
            const item = new RepoTreeItem(makeRepo(), 0);
            assert.strictEqual(item.contextValue, 'repo');
        });

        test('is expanded by default', () => {
            const item = new RepoTreeItem(makeRepo(), 0);
            assert.strictEqual(
                item.collapsibleState,
                vscode.TreeItemCollapsibleState.Expanded,
            );
        });
    });

    // ── CategoryTreeItem ────────────────────────────────────────

    suite('CategoryTreeItem', () => {
        test('label matches CATEGORY_LABELS', () => {
            const repo = makeRepo();
            const items = [makeResourceItem('a.md', ResourceCategory.Prompts, repo)];
            const catItem = new CategoryTreeItem(
                ResourceCategory.Prompts,
                repo,
                items,
            );
            assert.strictEqual(
                catItem.label,
                CATEGORY_LABELS[ResourceCategory.Prompts],
            );
        });

        test('description shows item count', () => {
            const repo = makeRepo();
            const items = [
                makeResourceItem('a.md', ResourceCategory.Prompts, repo),
                makeResourceItem('b.md', ResourceCategory.Prompts, repo),
            ];
            const catItem = new CategoryTreeItem(
                ResourceCategory.Prompts,
                repo,
                items,
            );
            assert.strictEqual(catItem.description, '2');
        });

        test('contextValue is "category"', () => {
            const catItem = new CategoryTreeItem(
                ResourceCategory.Skills,
                makeRepo(),
                [],
            );
            assert.strictEqual(catItem.contextValue, 'category');
        });
    });

    // ── ResourceTreeItem ────────────────────────────────────────

    suite('ResourceTreeItem', () => {
        test('label is the resource name', () => {
            const repo = makeRepo();
            const resource = makeResourceItem(
                'test.prompt.md',
                ResourceCategory.Prompts,
                repo,
            );
            const treeItem = new ResourceTreeItem(resource);
            assert.strictEqual(treeItem.label, 'test.prompt.md');
        });

        test('contextValue is "resource" when not installed', () => {
            const repo = makeRepo();
            const resource = makeResourceItem(
                'test.md',
                ResourceCategory.Instructions,
                repo,
            );
            const treeItem = new ResourceTreeItem(resource, false);
            assert.strictEqual(treeItem.contextValue, 'resource');
        });

        test('contextValue is "installedResource" when installed', () => {
            const repo = makeRepo();
            const resource = makeResourceItem(
                'test.md',
                ResourceCategory.Instructions,
                repo,
            );
            const treeItem = new ResourceTreeItem(resource, true);
            assert.strictEqual(treeItem.contextValue, 'installedResource');
        });

        test('skill folders use folder icon', () => {
            const repo = makeRepo();
            const resource = makeResourceItem(
                'my-skill',
                ResourceCategory.Skills,
                repo,
            );
            const treeItem = new ResourceTreeItem(resource);
            assert.ok(treeItem.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual(
                (treeItem.iconPath as vscode.ThemeIcon).id,
                'folder',
            );
        });

        test('non-skill items use category icon', () => {
            const repo = makeRepo();
            const resource = makeResourceItem(
                'test.chatmode',
                ResourceCategory.ChatModes,
                repo,
            );
            const treeItem = new ResourceTreeItem(resource);
            assert.ok(treeItem.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual(
                (treeItem.iconPath as vscode.ThemeIcon).id,
                'comment-discussion',
            );
        });

        test('has a preview command', () => {
            const repo = makeRepo();
            const resource = makeResourceItem(
                'test.md',
                ResourceCategory.Agents,
                repo,
            );
            const treeItem = new ResourceTreeItem(resource);
            assert.ok(treeItem.command);
            assert.strictEqual(
                treeItem.command.command,
                'aiSkillsManager.preview',
            );
        });
    });

    // ── Provider API ────────────────────────────────────────────

    suite('MarketplaceTreeDataProvider API', () => {
        let provider: MarketplaceTreeDataProvider;

        setup(() => {
            const context = {
                subscriptions: [],
                extensionUri: vscode.Uri.file('/tmp/test'),
                extensionPath: '/tmp/test',
            } as unknown as vscode.ExtensionContext;
            const client = new ResourceClient(context);
            provider = new MarketplaceTreeDataProvider(client, context);
        });

        test('search is not active initially', () => {
            assert.ok(!provider.isSearchActive());
        });

        test('setSearchQuery activates search', () => {
            provider.setSearchQuery('hello');
            assert.ok(provider.isSearchActive());
        });

        test('clearSearch deactivates search', () => {
            provider.setSearchQuery('hello');
            provider.clearSearch();
            assert.ok(!provider.isSearchActive());
        });

        test('getAllItems returns empty array when no data loaded', () => {
            const items = provider.getAllItems();
            assert.ok(Array.isArray(items));
            assert.strictEqual(items.length, 0);
        });

        test('getItemByName returns undefined when no data', () => {
            const item = provider.getItemByName('nonexistent');
            assert.strictEqual(item, undefined);
        });

        test('setInstalledNames tracks installed items', () => {
            // Just verify it doesn't throw
            provider.setInstalledNames(new Set(['a', 'b']));
        });

        test('onDidChangeTreeData fires on clearSearch', () => {
            let didFire = false;
            provider.onDidChangeTreeData(() => {
                didFire = true;
            });
            provider.clearSearch();
            assert.ok(didFire, 'Expected onDidChangeTreeData to fire');
        });
    });
});
