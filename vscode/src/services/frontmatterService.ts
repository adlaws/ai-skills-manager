/**
 * Shared YAML frontmatter parser for SKILL.md and other resource files.
 *
 * Extracts structured metadata from files with YAML front matter:
 *   ---
 *   name: My Skill
 *   description: A brief description
 *   ---
 *   Body content here…
 */

export interface FrontmatterResult {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    tags?: string[];
    body: string;
}

/**
 * Parse YAML frontmatter from a resource file.
 * Returns extracted metadata fields and the body content after the frontmatter block.
 */
export function parseFrontmatter(content: string): FrontmatterResult {
    const frontmatterMatch = content.match(
        /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/,
    );

    if (!frontmatterMatch) {
        return { name: '', description: '', body: content };
    }

    const yaml = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    const get = (key: string): string => {
        const match = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
        if (!match) { return ''; }
        let value = match[1].trim();
        // Strip surrounding quotes
        value = value.replace(/^(['"])(.*)\1$/, '$2');
        // Handle block scalar indicators (| or >)
        if (value === '|' || value === '>') {
            const lines = yaml.split(/\r?\n/);
            const keyIdx = lines.findIndex((l) => new RegExp(`^${key}:\\s`).test(l));
            if (keyIdx >= 0) {
                const continued: string[] = [];
                for (let i = keyIdx + 1; i < lines.length; i++) {
                    if (/^\s+/.test(lines[i])) {
                        continued.push(lines[i].trim());
                    } else {
                        break;
                    }
                }
                return continued.join(value === '|' ? '\n' : ' ');
            }
        }
        return value;
    };

    // Parse tags: support both comma-separated and YAML array formats
    let tags: string[] | undefined;
    const tagsRaw = get('tags');
    if (tagsRaw) {
        // Handle "tags: foo, bar, baz" or "tags: [foo, bar, baz]"
        const cleaned = tagsRaw.replace(/^\[|\]$/g, '');
        tags = cleaned.split(',').map((t) => t.trim()).filter(Boolean);
    }

    return {
        name: get('name'),
        description: get('description'),
        license: get('license') || undefined,
        compatibility: get('compatibility') || undefined,
        tags: tags && tags.length > 0 ? tags : undefined,
        body,
    };
}
