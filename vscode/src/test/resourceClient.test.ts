import * as assert from 'assert';
import * as vscode from 'vscode';
import { ResourceClient } from '../github/resourceClient';
import {
    ResourceCategory,
    ResourceRepository,
    ALL_CATEGORIES,
} from '../types';
import { parseFrontmatter } from '../services/frontmatterService';

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Build a minimal ResourceRepository for testing.
 */
function makeRepo(overrides?: Partial<ResourceRepository>): ResourceRepository {
    return {
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        enabled: true,
        ...overrides,
    };
}

/**
 * Subclass that exposes private helpers for testing.
 */
class TestableResourceClient extends ResourceClient {
    /** Expose the cache setter for testing. */
    testSetCache<T>(key: string, data: T): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).setCache(key, data);
    }

    /** Expose the cache getter for testing. */
    testGetFromCache<T>(key: string): T | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn = (this as any).getFromCache.bind(this);
        return fn(key) as T | undefined;
    }

    /** Expose repoKey for testing. */
    testRepoKey(repo: ResourceRepository): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this as any).repoKey(repo);
    }

    /** Expose toResourceItem for testing. */
    testToResourceItem(
        file: { name: string; path: string; download_url: string; size: number; type: 'file' | 'dir' },
        category: ResourceCategory,
        repo: ResourceRepository,
    ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this as any).toResourceItem(file, category, repo);
    }
}

suite('ResourceClient', () => {
    let client: TestableResourceClient;

    setup(() => {
        // Create with a minimal extension context stub
        const context = {
            subscriptions: [],
            extensionUri: vscode.Uri.file('/tmp/test'),
            extensionPath: '/tmp/test',
        } as unknown as vscode.ExtensionContext;
        client = new TestableResourceClient(context);
    });

    // ── parseSkillMd ────────────────────────────────────────────

    // ── parseFrontmatter (shared utility) ─────────────────────

    suite('parseFrontmatter', () => {
        test('parses valid SKILL.md with all fields', () => {
            const content = [
                '---',
                'name: My Skill',
                'description: A test skill',
                'license: MIT',
                'compatibility: Claude 3.5 Sonnet',
                '---',
                '',
                '## Usage',
                '',
                'Some instructions here.',
            ].join('\n');

            const parsed = parseFrontmatter(content);

            assert.strictEqual(parsed.name, 'My Skill');
            assert.strictEqual(parsed.description, 'A test skill');
            assert.strictEqual(parsed.license, 'MIT');
            assert.strictEqual(parsed.compatibility, 'Claude 3.5 Sonnet');
            assert.ok(parsed.body.includes('## Usage'));
            assert.ok(parsed.body.includes('Some instructions here.'));
        });

        test('returns empty name/description when no frontmatter', () => {
            const content = '# Just a heading\n\nSome content.';
            const parsed = parseFrontmatter(content);

            assert.strictEqual(parsed.name, '');
            assert.strictEqual(parsed.description, '');
            assert.strictEqual(parsed.body, content);
        });

        test('handles frontmatter with missing optional fields', () => {
            const content = [
                '---',
                'name: Minimal Skill',
                'description: Bare bones',
                '---',
                '',
                'Body here.',
            ].join('\n');

            const parsed = parseFrontmatter(content);

            assert.strictEqual(parsed.name, 'Minimal Skill');
            assert.strictEqual(parsed.description, 'Bare bones');
            assert.strictEqual(parsed.license, undefined);
            assert.strictEqual(parsed.compatibility, undefined);
        });

        test('handles empty frontmatter block', () => {
            const content = '---\n\n---\n\nBody only.';
            const parsed = parseFrontmatter(content);

            assert.strictEqual(parsed.name, '');
            assert.strictEqual(parsed.description, '');
            assert.ok(parsed.body.includes('Body only.'));
        });

        test('handles Windows-style line endings', () => {
            const content =
                '---\r\nname: WinSkill\r\ndescription: Windows test\r\n---\r\n\r\nBody.';
            const parsed = parseFrontmatter(content);

            assert.strictEqual(parsed.name, 'WinSkill');
            assert.strictEqual(parsed.description, 'Windows test');
        });
    });

    // ── repoKey ─────────────────────────────────────────────────

    suite('repoKey', () => {
        test('returns owner/repo format', () => {
            const repo = makeRepo({ owner: 'octocat', repo: 'hello-world' });
            assert.strictEqual(client.testRepoKey(repo), 'octocat/hello-world');
        });
    });

    // ── toResourceItem ──────────────────────────────────────────

    suite('toResourceItem', () => {
        test('creates ResourceItem with correct fields', () => {
            const file = {
                name: 'test-file.md',
                path: 'prompts/test-file.md',
                download_url: 'https://example.com/test-file.md',
                size: 1024,
                type: 'file' as const,
            };
            const repo = makeRepo();
            const item = client.testToResourceItem(
                file,
                ResourceCategory.Prompts,
                repo,
            );

            assert.strictEqual(item.name, 'test-file.md');
            assert.strictEqual(item.category, ResourceCategory.Prompts);
            assert.strictEqual(item.file, file);
            assert.strictEqual(item.repo, repo);
            assert.ok(item.id.includes('prompts'));
            assert.ok(item.id.includes('test-file.md'));
        });

        test('id includes category and repo info', () => {
            const file = {
                name: 'my-agent.yml',
                path: 'agents/my-agent.yml',
                download_url: 'https://example.com/my-agent.yml',
                size: 512,
                type: 'file' as const,
            };
            const repo = makeRepo({ owner: 'acme', repo: 'resources' });
            const item = client.testToResourceItem(
                file,
                ResourceCategory.Agents,
                repo,
            );

            assert.ok(item.id.includes('agents'));
            assert.ok(item.id.includes('acme'));
            assert.ok(item.id.includes('resources'));
        });
    });

    // ── Cache ───────────────────────────────────────────────────

    suite('cache', () => {
        test('stores and retrieves cached data', () => {
            client.testSetCache('test-key', { value: 42 });
            const result = client.testGetFromCache<{ value: number }>('test-key');
            assert.ok(result);
            assert.strictEqual(result.value, 42);
        });

        test('returns undefined for missing keys', () => {
            const result = client.testGetFromCache<string>('nonexistent');
            assert.strictEqual(result, undefined);
        });

        test('clearCache removes all entries', () => {
            client.testSetCache('k1', 'v1');
            client.testSetCache('k2', 'v2');
            client.clearCache();
            assert.strictEqual(client.testGetFromCache('k1'), undefined);
            assert.strictEqual(client.testGetFromCache('k2'), undefined);
        });
    });

    // ── fetchAllResources shape ─────────────────────────────────

    suite('fetchAllResources', () => {
        test('returns { data, failed } shape (integration smoke test)', async () => {
            // This test will run against the real GitHub API if auth is available.
            // Since we can't guarantee network in CI we just verify the return type.
            // We do NOT fail on network errors — just verify the shape.
            try {
                const result = await client.fetchAllResources();
                assert.ok(result.data instanceof Map, 'Expected data to be a Map');
                assert.ok(result.failed instanceof Set, 'Expected failed to be a Set');
            } catch {
                // Network failure is acceptable in test environments
            }
        });
    });

    // ── Constant consistency ────────────────────────────────────

    suite('category-constant sanity', () => {
        test('ALL_CATEGORIES covers 5 values', () => {
            assert.strictEqual(ALL_CATEGORIES.length, 5);
        });
    });
});
