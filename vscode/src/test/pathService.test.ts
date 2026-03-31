import * as assert from 'assert';
import * as vscode from 'vscode';
import { PathService } from '../services/pathService';
import { ResourceCategory, DEFAULT_INSTALL_PATHS, DEFAULT_GLOBAL_INSTALL_PATHS } from '../types';

suite('PathService', () => {
    let service: PathService;

    setup(() => {
        service = new PathService();
    });

    // ── isHomeLocation ──────────────────────────────────────────

    suite('isHomeLocation', () => {
        test('paths starting with ~ are home locations', () => {
            assert.ok(service.isHomeLocation('~/my-stuff'));
            assert.ok(service.isHomeLocation('~/.copilot/skills'));
        });

        test('paths with leading whitespace and ~ are home locations', () => {
            assert.ok(service.isHomeLocation('  ~/my-stuff'));
        });

        test('relative paths are not home locations', () => {
            assert.ok(!service.isHomeLocation('.agents/skills'));
            assert.ok(!service.isHomeLocation('some/path'));
        });

        test('absolute paths are not home locations', () => {
            assert.ok(!service.isHomeLocation('/usr/local'));
        });
    });

    // ── requiresWorkspaceFolder ─────────────────────────────────

    suite('requiresWorkspaceFolder', () => {
        test('home paths do not require workspace folder', () => {
            assert.ok(!service.requiresWorkspaceFolder('~/my-stuff'));
        });

        test('relative paths require workspace folder', () => {
            assert.ok(service.requiresWorkspaceFolder('.agents/skills'));
        });
    });

    // ── getInstallLocation ──────────────────────────────────────

    suite('getInstallLocation', () => {
        test('returns default path for each category when unconfigured', () => {
            // In a test host the config should return the defaults
            for (const category of Object.values(ResourceCategory)) {
                const location = service.getInstallLocation(category);
                assert.strictEqual(
                    location,
                    DEFAULT_INSTALL_PATHS[category],
                    `Unexpected default for ${category}`,
                );
            }
        });
    });

    // ── getGlobalInstallLocation ────────────────────────────────

    suite('getGlobalInstallLocation', () => {
        test('returns default global path for each category when unconfigured', () => {
            for (const category of Object.values(ResourceCategory)) {
                const location = service.getGlobalInstallLocation(category);
                assert.strictEqual(
                    location,
                    DEFAULT_GLOBAL_INSTALL_PATHS[category],
                    `Unexpected global default for ${category}`,
                );
            }
        });
    });

    // ── getInstallLocationForScope ──────────────────────────────

    suite('getInstallLocationForScope', () => {
        test('local scope returns local install location', () => {
            for (const category of Object.values(ResourceCategory)) {
                const location = service.getInstallLocationForScope(category, 'local');
                assert.strictEqual(
                    location,
                    DEFAULT_INSTALL_PATHS[category],
                    `Unexpected local-scope value for ${category}`,
                );
            }
        });

        test('global scope returns global install location', () => {
            for (const category of Object.values(ResourceCategory)) {
                const location = service.getInstallLocationForScope(category, 'global');
                assert.strictEqual(
                    location,
                    DEFAULT_GLOBAL_INSTALL_PATHS[category],
                    `Unexpected global-scope value for ${category}`,
                );
            }
        });
    });

    // ── getScopeForLocation ─────────────────────────────────────

    suite('getScopeForLocation', () => {
        test('home paths are global scope', () => {
            assert.strictEqual(service.getScopeForLocation('~/.agents/skills'), 'global');
            assert.strictEqual(service.getScopeForLocation('~/anything'), 'global');
        });

        test('relative paths are local scope', () => {
            assert.strictEqual(service.getScopeForLocation('.agents/skills'), 'local');
            assert.strictEqual(service.getScopeForLocation('.github/agents'), 'local');
        });
    });

    // ── getScanLocations ────────────────────────────────────────

    suite('getScanLocations', () => {
        test('includes default path, .github/<category>, and global path', () => {
            for (const category of Object.values(ResourceCategory)) {
                const locations = service.getScanLocations(category);
                assert.ok(
                    locations.includes(DEFAULT_INSTALL_PATHS[category]),
                    `Missing default path for ${category}`,
                );
                assert.ok(
                    locations.includes(`.github/${category}`),
                    `Missing .github path for ${category}`,
                );
                assert.ok(
                    locations.includes(DEFAULT_GLOBAL_INSTALL_PATHS[category]),
                    `Missing global path for ${category}`,
                );
            }
        });

        test('returns at least 3 locations per category', () => {
            for (const category of Object.values(ResourceCategory)) {
                const locations = service.getScanLocations(category);
                assert.ok(
                    locations.length >= 3,
                    `Expected at least 3 scan locations for ${category}, got ${locations.length}`,
                );
            }
        });

        test('does not contain duplicates', () => {
            for (const category of Object.values(ResourceCategory)) {
                const locations = service.getScanLocations(category);
                const unique = new Set(locations);
                assert.strictEqual(
                    locations.length,
                    unique.size,
                    `Duplicate scan locations for ${category}`,
                );
            }
        });
    });

    // ── resolveLocationToUri ────────────────────────────────────

    suite('resolveLocationToUri', () => {
        test('home location resolves without workspace folder', () => {
            const uri = service.resolveLocationToUri('~/my-stuff');
            assert.ok(uri, 'Expected a Uri for home location');
            assert.ok(
                uri.fsPath.includes('my-stuff'),
                `Expected path to contain "my-stuff", got ${uri.fsPath}`,
            );
        });

        test('home location trims leading slashes after tilde', () => {
            const uri = service.resolveLocationToUri('~///my-stuff');
            assert.ok(uri, 'Expected a Uri');
            // Should still resolve correctly without triple slashes in path
            assert.ok(
                uri.fsPath.includes('my-stuff'),
                `Path should contain "my-stuff", got ${uri.fsPath}`,
            );
        });

        test('workspace-relative location returns undefined without workspace folder', () => {
            const uri = service.resolveLocationToUri('.agents/skills');
            assert.strictEqual(
                uri,
                undefined,
                'Expected undefined when no workspace folder provided',
            );
        });

        test('workspace-relative location resolves with workspace folder', () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const uri = service.resolveLocationToUri(
                    '.agents/skills',
                    workspaceFolders[0],
                );
                assert.ok(uri, 'Expected a Uri with workspace folder');
                assert.ok(
                    uri.fsPath.includes('.agents'),
                    `Expected path to include ".agents", got ${uri.fsPath}`,
                );
            }
        });
    });

    // ── resolveInstallTarget ────────────────────────────────────

    suite('resolveInstallTarget', () => {
        test('rejects empty resource name', () => {
            const result = service.resolveInstallTarget(
                ResourceCategory.Skills,
                '',
            );
            assert.strictEqual(result, undefined);
        });

        test('rejects "." resource name', () => {
            const result = service.resolveInstallTarget(
                ResourceCategory.Skills,
                '.',
            );
            assert.strictEqual(result, undefined);
        });

        test('rejects names containing ".."', () => {
            const result = service.resolveInstallTarget(
                ResourceCategory.Skills,
                '../escape',
            );
            assert.strictEqual(result, undefined);
        });

        test('resolves when workspace folder is available', () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const result = service.resolveInstallTarget(
                    ResourceCategory.Skills,
                    'my-skill',
                    workspaceFolders[0],
                );
                assert.ok(result, 'Expected a Uri');
                assert.ok(
                    result.fsPath.includes('my-skill'),
                    `Expected "my-skill" in path, got ${result.fsPath}`,
                );
            }
        });
    });

    // ── resolveInstallTargetForScope ────────────────────────────

    suite('resolveInstallTargetForScope', () => {
        test('global scope resolves to home directory path', () => {
            const result = service.resolveInstallTargetForScope(
                ResourceCategory.Skills,
                'my-skill',
                'global',
            );
            assert.ok(result, 'Expected a Uri for global scope');
            assert.ok(
                result.fsPath.includes('my-skill'),
                `Expected "my-skill" in path, got ${result.fsPath}`,
            );
            // Global paths should resolve under home directory
            const homedir = service.getHomeDirectory();
            assert.ok(
                result.fsPath.startsWith(homedir),
                `Expected global path to start with home dir ${homedir}, got ${result.fsPath}`,
            );
        });

        test('local scope with workspace folder resolves to workspace path', () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const result = service.resolveInstallTargetForScope(
                    ResourceCategory.Skills,
                    'my-skill',
                    'local',
                    workspaceFolders[0],
                );
                assert.ok(result, 'Expected a Uri for local scope');
                assert.ok(
                    result.fsPath.includes('my-skill'),
                    `Expected "my-skill" in path, got ${result.fsPath}`,
                );
            }
        });

        test('rejects invalid resource names', () => {
            assert.strictEqual(
                service.resolveInstallTargetForScope(ResourceCategory.Skills, '', 'global'),
                undefined,
            );
            assert.strictEqual(
                service.resolveInstallTargetForScope(ResourceCategory.Skills, '..', 'global'),
                undefined,
            );
        });
    });
});
