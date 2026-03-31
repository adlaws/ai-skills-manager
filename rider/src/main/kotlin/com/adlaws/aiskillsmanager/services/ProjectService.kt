package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.*
import com.google.gson.Gson
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Project-level service for workspace-scoped operations.
 *
 * Mirrors the VS Code extension's PathService — resolves per-category install and
 * scan locations for both workspace and global scopes.
 */
@Service(Service.Level.PROJECT)
class ProjectService(private val project: Project) {

    private val gson = Gson()

    /**
     * Resolve the install/scan directory for a given category and scope.
     */
    fun resolveInstallPath(category: ResourceCategory, scope: InstallScope): Path {
        val settings = SettingsService.getInstance()
        val location = settings.getInstallLocation(category, scope)
        return resolvePath(location, scope)
    }

    /**
     * Get all scan locations for a category (both workspace and global).
     */
    fun getScanLocations(category: ResourceCategory): List<Pair<Path, InstallScope>> {
        return listOf(
            resolveInstallPath(category, InstallScope.WORKSPACE) to InstallScope.WORKSPACE,
            resolveInstallPath(category, InstallScope.GLOBAL) to InstallScope.GLOBAL
        )
    }

    /**
     * Scan for installed resources across both scopes, reading metadata for SHA/sourceRepo.
     */
    fun scanInstalledResources(): List<InstalledResource> {
        val results = mutableListOf<InstalledResource>()
        for (category in ResourceCategory.entries) {
            for ((path, scope) in getScanLocations(category)) {
                if (!Files.isDirectory(path)) continue
                val metadata = readAllMetadataForDir(path)
                try {
                    Files.list(path).use { stream ->
                        stream.forEach { entry ->
                            val name = entry.fileName.toString()
                            val isSkillFolder = category == ResourceCategory.SKILLS
                                    && Files.isDirectory(entry)
                                    && Files.exists(entry.resolve("SKILL.md"))
                            val isResourceFile = !Files.isDirectory(entry)
                                    && !name.startsWith(".")
                                    && name != ".ai-skills-meta.json"

                            if (isSkillFolder || isResourceFile) {
                                val meta = metadata[name]
                                results.add(
                                    InstalledResource(
                                        name = name,
                                        category = category,
                                        path = entry.toString(),
                                        scope = scope,
                                        sha = meta?.sha,
                                        sourceRepo = meta?.sourceRepo
                                    )
                                )
                            }
                        }
                    }
                } catch (_: Exception) {
                    // Skip inaccessible directories
                }
            }
        }
        return results
    }

    /**
     * Read all install metadata across all categories and scopes.
     * Returns a map of resourceName → InstallMetadata.
     */
    fun readAllInstallMetadata(): Map<String, InstallMetadata> {
        val result = mutableMapOf<String, InstallMetadata>()
        for (category in ResourceCategory.entries) {
            for ((path, _) in getScanLocations(category)) {
                if (!Files.isDirectory(path)) continue
                result.putAll(readAllMetadataForDir(path))
            }
        }
        return result
    }

    /**
     * Resolve a path string to an absolute path.
     */
    fun resolvePath(location: String, scope: InstallScope): Path {
        return when {
            location.startsWith("~/") ->
                Paths.get(System.getProperty("user.home"), location.removePrefix("~/"))
            Paths.get(location).isAbsolute ->
                Paths.get(location)
            else -> {
                val basePath = project.basePath ?: System.getProperty("user.dir")
                Paths.get(basePath, location)
            }
        }
    }

    /**
     * Determine the scope for a location string.
     */
    fun getScopeForLocation(location: String): InstallScope {
        return if (location.startsWith("~/") || Paths.get(location).startsWith(
                Paths.get(System.getProperty("user.home"))
            )) InstallScope.GLOBAL else InstallScope.WORKSPACE
    }

    // ---- Private ----

    private fun readAllMetadataForDir(dir: Path): Map<String, InstallMetadata> {
        val metaFile = dir.resolve(".ai-skills-meta.json")
        if (!Files.exists(metaFile)) return emptyMap()
        return try {
            val json = Files.readString(metaFile)
            val type = object : com.google.gson.reflect.TypeToken<Map<String, InstallMetadata>>() {}.type
            gson.fromJson(json, type) ?: emptyMap()
        } catch (_: Exception) {
            emptyMap()
        }
    }

    companion object {
        fun getInstance(project: Project): ProjectService =
            project.getService(ProjectService::class.java)
    }
}
