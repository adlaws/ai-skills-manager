import * as assert from 'assert';
import {
    ResourceCategory,
    ALL_CATEGORIES,
    CATEGORY_LABELS,
    CATEGORY_ICONS,
    DEFAULT_INSTALL_PATHS,
} from '../types';

suite('Types & Constants', () => {
    // ── ResourceCategory enum ───────────────────────────────────

    test('ResourceCategory has exactly 5 entries', () => {
        const values = Object.values(ResourceCategory);
        assert.strictEqual(values.length, 5);
    });

    test('ResourceCategory values match expected strings', () => {
        assert.strictEqual(ResourceCategory.ChatModes, 'chatmodes');
        assert.strictEqual(ResourceCategory.Instructions, 'instructions');
        assert.strictEqual(ResourceCategory.Prompts, 'prompts');
        assert.strictEqual(ResourceCategory.Agents, 'agents');
        assert.strictEqual(ResourceCategory.Skills, 'skills');
    });

    // ── ALL_CATEGORIES array ────────────────────────────────────

    test('ALL_CATEGORIES contains all 5 categories', () => {
        assert.strictEqual(ALL_CATEGORIES.length, 5);
        assert.ok(ALL_CATEGORIES.includes(ResourceCategory.ChatModes));
        assert.ok(ALL_CATEGORIES.includes(ResourceCategory.Instructions));
        assert.ok(ALL_CATEGORIES.includes(ResourceCategory.Prompts));
        assert.ok(ALL_CATEGORIES.includes(ResourceCategory.Agents));
        assert.ok(ALL_CATEGORIES.includes(ResourceCategory.Skills));
    });

    // ── CATEGORY_LABELS ─────────────────────────────────────────

    test('CATEGORY_LABELS has an entry for every category', () => {
        for (const cat of ALL_CATEGORIES) {
            assert.ok(
                CATEGORY_LABELS[cat],
                `Missing label for ${cat}`,
            );
            assert.ok(
                typeof CATEGORY_LABELS[cat] === 'string',
                `Label for ${cat} is not a string`,
            );
        }
    });

    test('CATEGORY_LABELS has human-readable names', () => {
        assert.strictEqual(CATEGORY_LABELS[ResourceCategory.ChatModes], 'Chat Modes');
        assert.strictEqual(CATEGORY_LABELS[ResourceCategory.Instructions], 'Instructions');
        assert.strictEqual(CATEGORY_LABELS[ResourceCategory.Prompts], 'Prompts');
        assert.strictEqual(CATEGORY_LABELS[ResourceCategory.Agents], 'Agents');
        assert.strictEqual(CATEGORY_LABELS[ResourceCategory.Skills], 'Skills');
    });

    // ── CATEGORY_ICONS ──────────────────────────────────────────

    test('CATEGORY_ICONS has an entry for every category', () => {
        for (const cat of ALL_CATEGORIES) {
            assert.ok(
                CATEGORY_ICONS[cat],
                `Missing icon for ${cat}`,
            );
        }
    });

    test('CATEGORY_ICONS uses valid ThemeIcon ids', () => {
        assert.strictEqual(CATEGORY_ICONS[ResourceCategory.ChatModes], 'comment-discussion');
        assert.strictEqual(CATEGORY_ICONS[ResourceCategory.Instructions], 'book');
        assert.strictEqual(CATEGORY_ICONS[ResourceCategory.Prompts], 'lightbulb');
        assert.strictEqual(CATEGORY_ICONS[ResourceCategory.Agents], 'robot');
        assert.strictEqual(CATEGORY_ICONS[ResourceCategory.Skills], 'tools');
    });

    // ── DEFAULT_INSTALL_PATHS ───────────────────────────────────

    test('DEFAULT_INSTALL_PATHS has an entry for every category', () => {
        for (const cat of ALL_CATEGORIES) {
            assert.ok(
                DEFAULT_INSTALL_PATHS[cat],
                `Missing default install path for ${cat}`,
            );
        }
    });

    test('DEFAULT_INSTALL_PATHS all start with .agents/', () => {
        for (const cat of ALL_CATEGORIES) {
            assert.ok(
                DEFAULT_INSTALL_PATHS[cat].startsWith('.agents/'),
                `Default path for ${cat} does not start with .agents/: ${DEFAULT_INSTALL_PATHS[cat]}`,
            );
        }
    });

    test('DEFAULT_INSTALL_PATHS end with the category slug', () => {
        for (const cat of ALL_CATEGORIES) {
            assert.ok(
                DEFAULT_INSTALL_PATHS[cat].endsWith(cat),
                `Default path for ${cat} does not end with category slug: ${DEFAULT_INSTALL_PATHS[cat]}`,
            );
        }
    });
});
