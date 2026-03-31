/**
 * AI Skills Manager – Type Definitions
 *
 * Supports five resource categories: Chat Modes, Instructions,
 * Prompts, Agents, and Skills.
 */

// ── Resource categories ─────────────────────────────────────────

export enum ResourceCategory {
    ChatModes = 'chatmodes',
    Instructions = 'instructions',
    Prompts = 'prompts',
    Agents = 'agents',
    Skills = 'skills',
}

export const ALL_CATEGORIES: ResourceCategory[] = [
    ResourceCategory.ChatModes,
    ResourceCategory.Instructions,
    ResourceCategory.Prompts,
    ResourceCategory.Agents,
    ResourceCategory.Skills,
];

export const CATEGORY_LABELS: Record<ResourceCategory, string> = {
    [ResourceCategory.ChatModes]: 'Chat Modes',
    [ResourceCategory.Instructions]: 'Instructions',
    [ResourceCategory.Prompts]: 'Prompts',
    [ResourceCategory.Agents]: 'Agents',
    [ResourceCategory.Skills]: 'Skills',
};

export const CATEGORY_ICONS: Record<ResourceCategory, string> = {
    [ResourceCategory.ChatModes]: 'comment-discussion',
    [ResourceCategory.Instructions]: 'book',
    [ResourceCategory.Prompts]: 'lightbulb',
    [ResourceCategory.Agents]: 'robot',
    [ResourceCategory.Skills]: 'tools',
};

export const DEFAULT_INSTALL_PATHS: Record<ResourceCategory, string> = {
    [ResourceCategory.ChatModes]: '.agents/chatmodes',
    [ResourceCategory.Instructions]: '.agents/instructions',
    [ResourceCategory.Prompts]: '.agents/prompts',
    [ResourceCategory.Agents]: '.agents/agents',
    [ResourceCategory.Skills]: '.agents/skills',
};

export const DEFAULT_GLOBAL_INSTALL_PATHS: Record<ResourceCategory, string> = {
    [ResourceCategory.ChatModes]: '~/.agents/chatmodes',
    [ResourceCategory.Instructions]: '~/.agents/instructions',
    [ResourceCategory.Prompts]: '~/.agents/prompts',
    [ResourceCategory.Agents]: '~/.agents/agents',
    [ResourceCategory.Skills]: '~/.agents/skills',
};

export type InstallScope = 'local' | 'global';

// ── Local collection configuration ──────────────────────────────

/**
 * A local folder on disk that contains resources in the standard structure:
 *
 *   <path>/
 *     chatmodes/
 *     instructions/
 *     prompts/
 *     agents/
 *     skills/<skill-name>/SKILL.md
 */
export interface LocalCollection {
    /** Absolute path to the collection root folder. */
    path: string;
    /** Optional display label. */
    label?: string;
    /** Whether this collection is enabled (default true). */
    enabled: boolean;
}

// ── Repository configuration ────────────────────────────────────

/**
 * Repository source configuration.
 *
 * Two modes:
 * - **Full repo** (no `skillsPath`): Scans well-known category folders
 *   at the root (chatmodes/, instructions/, prompts/, agents/, skills/).
 * - **Skills repo** (with `skillsPath`): Scans a specific path for
 *   skill folders containing SKILL.md.
 */
export interface ResourceRepository {
    owner: string;
    repo: string;
    branch: string;
    enabled: boolean;
    label?: string;
    /** If set, this repo only provides skills from this specific path. */
    skillsPath?: string;
    /** If true with skillsPath, the path points to a single skill folder. */
    singleSkill?: boolean;
}

// ── GitHub file / item types ────────────────────────────────────

/** A file or directory returned by the GitHub Contents API. */
export interface GitHubFile {
    name: string;
    path: string;
    download_url: string;
    size: number;
    type: 'file' | 'dir';
    sha?: string;
}

/** A resource item from a repository (marketplace-side). */
export interface ResourceItem {
    id: string;
    name: string;
    category: ResourceCategory;
    file: GitHubFile;
    repo: ResourceRepository;
    /** Fetched content (for preview). */
    content?: string;
    /** Parsed description from SKILL.md frontmatter (skills only). */
    description?: string;
    license?: string;
    compatibility?: string;
    /** Tags/keywords for filtering (parsed from frontmatter). */
    tags?: string[];
    bodyContent?: string;
    fullContent?: string;
}

/** An installed resource (local-side). */
export interface InstalledResource {
    name: string;
    description: string;
    category: ResourceCategory;
    /** Relative location string, e.g. ".agents/skills/my-skill". */
    location: string;
    installedAt: string;
    /** Whether the resource is installed locally (workspace) or globally (home directory). */
    scope: InstallScope;
    /** SHA hash of the resource at install time (for update detection). */
    sha?: string;
    /** Source repository info (for update detection). */
    sourceRepo?: { owner: string; repo: string; branch: string; filePath: string };
}

/**
 * Metadata persisted alongside installed resources for update tracking.
 * Stored as `.ai-skills-meta.json` in the parent directory of the resource.
 */
export interface InstallMetadata {
    [resourceName: string]: {
        sha: string;
        installedAt: string;
        sourceRepo?: { owner: string; repo: string; branch: string; filePath: string };
    };
}

// ── Git Trees API types (used for skills repos) ─────────────────

export interface GitHubTreeItem {
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url?: string;
}

export interface GitTreeResponse {
    sha: string;
    url: string;
    tree: GitHubTreeItem[];
    truncated: boolean;
}

// ── Generic cache entry ─────────────────────────────────────────

export interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

// ── Resource Packs ──────────────────────────────────────────────

/** A resource pack reference — one entry in a pack manifest. */
export interface PackResourceRef {
    /** Resource name (must match the name in the marketplace or local collection). */
    name: string;
    /** Optional category hint to speed up discovery. */
    category?: ResourceCategory;
    /** Optional repo hint as "owner/repo" to disambiguate. */
    repo?: string;
}

/** A resource pack manifest. */
export interface ResourcePack {
    /** Pack display name. */
    name: string;
    /** Brief description. */
    description?: string;
    /** Resources in this pack. */
    resources: PackResourceRef[];
}
