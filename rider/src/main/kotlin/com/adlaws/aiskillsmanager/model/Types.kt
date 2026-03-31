package com.adlaws.aiskillsmanager.model

/**
 * Resource categories — mirrors the VS Code extension's ResourceCategory enum.
 */
enum class ResourceCategory(val id: String, val label: String, val icon: String, val defaultPath: String) {
    CHATMODES("chatmodes", "Chat Modes", "chatmode", ".agents/chatmodes"),
    INSTRUCTIONS("instructions", "Instructions", "instructions", ".agents/instructions"),
    PROMPTS("prompts", "Prompts", "prompt", ".agents/prompts"),
    AGENTS("agents", "Agents", "agent", ".agents/agents"),
    SKILLS("skills", "Skills", "skill", ".agents/skills");

    companion object {
        fun fromId(id: String): ResourceCategory? = entries.find { it.id == id }
    }
}

/**
 * Install scope — workspace (project-local) or global (home directory).
 */
enum class InstallScope {
    WORKSPACE,
    GLOBAL
}

/**
 * A GitHub repository configured as a resource source.
 */
data class ResourceRepository(
    val owner: String,
    val repo: String,
    val branch: String = "main",
    val skillsPath: String? = null,
    val singleSkill: Boolean = false,
    val enabled: Boolean = true,
    val label: String? = null
) {
    val key: String get() = "$owner/$repo"
}

/**
 * A single resource item from the marketplace or local collection.
 */
data class ResourceItem(
    val name: String,
    val category: ResourceCategory,
    val path: String,
    val repoOwner: String = "",
    val repoName: String = "",
    val repoBranch: String = "main",
    val content: String? = null,
    val description: String? = null,
    val license: String? = null,
    val compatibility: String? = null,
    val sha: String? = null,
    val tags: List<String> = emptyList(),
    val isFolder: Boolean = false,
    val bodyContent: String? = null,
    val fullContent: String? = null,
    /** Source local collection path, if this item came from a local collection */
    val localCollectionPath: String? = null
)

/**
 * An installed resource on disk.
 */
data class InstalledResource(
    val name: String,
    val category: ResourceCategory,
    val path: String,
    val scope: InstallScope,
    val sha: String? = null,
    val sourceRepo: String? = null
)

/**
 * Metadata persisted alongside installed resources for update tracking.
 */
data class InstallMetadata(
    val sha: String,
    val sourceRepo: String,
    val installedAt: String? = null
)

/**
 * A resource pack manifest.
 */
data class ResourcePack(
    val name: String,
    val description: String = "",
    val resources: List<PackResourceRef> = emptyList()
)

/**
 * A reference to a resource within a pack.
 */
data class PackResourceRef(
    val repo: String = "",
    val category: String = "",
    val name: String
)

/**
 * A local collection folder configuration.
 */
data class LocalCollection(
    val path: String,
    val label: String? = null,
    val enabled: Boolean = true
)

// ---- Validation types ----

enum class ValidationSeverity { ERROR, WARNING, INFO }

data class ValidationIssue(
    val resource: InstalledResource,
    val severity: ValidationSeverity,
    val message: String,
    val detail: String? = null
)

// ---- Usage detection types ----

data class UsageReference(
    val filePath: String,
    val line: Int,
    val text: String
)

data class UsageResult(
    val usageMap: Map<String, List<UsageReference>>,
    val inUseNames: Set<String>,
    val unusedNames: Set<String>
)

// ---- Config export/import types ----

data class ExportedConfig(
    val version: Int = 1,
    val exportedAt: String = "",
    val repositories: List<ResourceRepository>? = null,
    val localCollections: List<LocalCollection>? = null,
    val installLocations: Map<String, String>? = null,
    val globalInstallLocations: Map<String, String>? = null,
    val favorites: Set<String>? = null,
    val cacheTimeout: Int? = null
)
