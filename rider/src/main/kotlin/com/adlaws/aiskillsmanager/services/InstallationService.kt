package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.*
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import java.nio.file.*
import java.time.Instant

/**
 * Handles downloading, installing, uninstalling, and updating resources.
 *
 * Mirrors the VS Code extension's `installationService.ts`:
 * - Skills (folders) are fetched file-by-file and written recursively
 * - Other resources are single-file downloads
 * - Persists install metadata (SHA + source repo) in `.ai-skills-meta.json`
 * - Supports moving resources between scopes
 * - Supports copying resources to local collections
 */
class InstallationService(
    private val resourceClient: ResourceClient,
    private val projectService: ProjectService
) {

    private val gson: Gson = GsonBuilder().setPrettyPrinting().create()

    /**
     * Install a resource from the marketplace.
     */
    fun installResource(item: ResourceItem, scope: InstallScope): Boolean {
        val targetDir = projectService.resolveInstallPath(item.category, scope)
        Files.createDirectories(targetDir)

        val success = if (item.isFolder) {
            installSkillFolder(item, targetDir)
        } else {
            installSingleFile(item, targetDir)
        }

        if (success) {
            saveInstallMetadata(item, targetDir)
        }
        return success
    }

    /**
     * Install a resource from a local collection source.
     */
    fun installFromLocal(item: ResourceItem, scope: InstallScope): Boolean {
        val targetDir = projectService.resolveInstallPath(item.category, scope)
        Files.createDirectories(targetDir)

        return try {
            val sourcePath = Paths.get(item.localCollectionPath ?: item.path)
            if (Files.isDirectory(sourcePath)) {
                val targetFolder = targetDir.resolve(item.name)
                copyDirectory(sourcePath, targetFolder)
            } else {
                val targetFile = targetDir.resolve(item.name)
                Files.copy(sourcePath, targetFile, StandardCopyOption.REPLACE_EXISTING)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Uninstall an installed resource with confirmation expected from caller.
     */
    fun uninstallResource(resource: InstalledResource): Boolean {
        return try {
            val path = Paths.get(resource.path)
            if (Files.isDirectory(path)) {
                Files.walk(path)
                    .sorted(Comparator.reverseOrder())
                    .forEach { Files.deleteIfExists(it) }
            } else {
                Files.deleteIfExists(path)
            }
            removeMetadata(path.parent, resource.name)
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Uninstall without per-item confirmation (for bulk ops).
     */
    fun uninstallResourceSilent(resource: InstalledResource): Boolean = uninstallResource(resource)

    /**
     * Update an installed resource from upstream.
     */
    fun updateResource(resource: InstalledResource, marketplaceItem: ResourceItem? = null): Boolean {
        val item = marketplaceItem ?: run {
            // Try to reconstruct the item from metadata
            val metadata = readMetadata(Paths.get(resource.path).parent, resource.name) ?: return false
            val parts = metadata.sourceRepo.split("/")
            if (parts.size != 2) return false

            ResourceItem(
                name = resource.name,
                category = resource.category,
                path = resource.name,
                repoOwner = parts[0],
                repoName = parts[1],
                repoBranch = "main",
                sha = resource.sha,
                isFolder = Files.isDirectory(Paths.get(resource.path))
            )
        }

        // Delete existing then reinstall
        val deleted = uninstallResource(resource)
        if (!deleted) return false

        return installResource(item, resource.scope)
    }

    /**
     * Move a resource between workspace and global scopes.
     */
    fun moveResource(resource: InstalledResource, targetScope: InstallScope): Boolean {
        val sourcePath = Paths.get(resource.path)
        val targetDir = projectService.resolveInstallPath(resource.category, targetScope)
        Files.createDirectories(targetDir)

        return try {
            if (Files.isDirectory(sourcePath)) {
                val targetFolder = targetDir.resolve(resource.name)
                copyDirectory(sourcePath, targetFolder)
            } else {
                val targetFile = targetDir.resolve(resource.name)
                Files.copy(sourcePath, targetFile, StandardCopyOption.REPLACE_EXISTING)
            }

            // Copy metadata to new location
            val metadata = readMetadata(sourcePath.parent, resource.name)
            if (metadata != null) {
                writeMetadata(targetDir, resource.name, metadata)
            }

            // Delete source
            if (Files.isDirectory(sourcePath)) {
                Files.walk(sourcePath)
                    .sorted(Comparator.reverseOrder())
                    .forEach { Files.deleteIfExists(it) }
            } else {
                Files.deleteIfExists(sourcePath)
            }
            removeMetadata(sourcePath.parent, resource.name)

            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Copy an installed resource to a local collection folder.
     */
    fun copyToLocalCollection(resource: InstalledResource, collectionPath: Path): Boolean {
        val sourcePath = Paths.get(resource.path)
        val categoryDir = collectionPath.resolve(resource.category.id)
        Files.createDirectories(categoryDir)

        return try {
            if (Files.isDirectory(sourcePath)) {
                val targetFolder = categoryDir.resolve(resource.name)
                copyDirectory(sourcePath, targetFolder)
            } else {
                val targetFile = categoryDir.resolve(resource.name)
                Files.copy(sourcePath, targetFile, StandardCopyOption.REPLACE_EXISTING)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Open a resource file or folder in the system file manager / editor.
     */
    fun getResourcePath(resource: InstalledResource): Path = Paths.get(resource.path)

    /**
     * Read all install metadata across all categories and scopes.
     */
    fun readAllInstallMetadata(): Map<String, InstallMetadata> {
        return projectService.readAllInstallMetadata()
    }

    // ---- Private ----

    private fun installSingleFile(item: ResourceItem, targetDir: Path): Boolean {
        val content = resourceClient.fetchRawContent(
            item.repoOwner, item.repoName, item.repoBranch, item.path
        ) ?: return false

        val targetFile = targetDir.resolve(item.name)
        Files.writeString(targetFile, content)
        return true
    }

    private fun installSkillFolder(item: ResourceItem, targetDir: Path): Boolean {
        val repo = ResourceRepository(
            owner = item.repoOwner,
            repo = item.repoName,
            branch = item.repoBranch
        )
        val files = resourceClient.fetchSkillFiles(repo, item.path)
        if (files.isEmpty()) return false

        val skillDir = targetDir.resolve(item.name)
        Files.createDirectories(skillDir)

        for ((relativePath, content) in files) {
            val targetFile = skillDir.resolve(relativePath)
            Files.createDirectories(targetFile.parent)
            Files.writeString(targetFile, content)
        }
        return true
    }

    private fun saveInstallMetadata(item: ResourceItem, targetDir: Path) {
        writeMetadata(targetDir, if (item.isFolder) item.name else item.name, InstallMetadata(
            sha = item.sha ?: "",
            sourceRepo = "${item.repoOwner}/${item.repoName}",
            installedAt = Instant.now().toString()
        ))
    }

    private fun writeMetadata(dir: Path, resourceName: String, metadata: InstallMetadata) {
        val metaFile = dir.resolve(".ai-skills-meta.json")
        val existing = readAllMetadata(metaFile)
        existing[resourceName] = metadata
        Files.writeString(metaFile, gson.toJson(existing))
    }

    private fun removeMetadata(dir: Path, resourceName: String) {
        val metaFile = dir.resolve(".ai-skills-meta.json")
        val existing = readAllMetadata(metaFile)
        existing.remove(resourceName)
        if (existing.isEmpty()) {
            Files.deleteIfExists(metaFile)
        } else {
            Files.writeString(metaFile, gson.toJson(existing))
        }
    }

    fun readMetadata(dir: Path, resourceName: String): InstallMetadata? {
        return readAllMetadata(dir.resolve(".ai-skills-meta.json"))[resourceName]
    }

    private fun readAllMetadata(metaFile: Path): MutableMap<String, InstallMetadata> {
        if (!Files.exists(metaFile)) return mutableMapOf()
        return try {
            val json = Files.readString(metaFile)
            val type = object : com.google.gson.reflect.TypeToken<MutableMap<String, InstallMetadata>>() {}.type
            gson.fromJson(json, type) ?: mutableMapOf()
        } catch (_: Exception) {
            mutableMapOf()
        }
    }

    private fun copyDirectory(source: Path, target: Path) {
        Files.walk(source).use { stream ->
            stream.forEach { sourcePath ->
                val targetPath = target.resolve(source.relativize(sourcePath))
                if (Files.isDirectory(sourcePath)) {
                    Files.createDirectories(targetPath)
                } else {
                    Files.createDirectories(targetPath.parent)
                    Files.copy(sourcePath, targetPath, StandardCopyOption.REPLACE_EXISTING)
                }
            }
        }
    }
}
