package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.*
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.nio.file.Files
import java.nio.file.Path

/**
 * Handles installing and creating resource packs.
 *
 * Mirrors the VS Code extension's `packService.ts`:
 * - Packs are JSON manifests listing resources by name, category, and optional repo
 * - Install resolves each reference against marketplace then local items
 * - Create builds a manifest from selected installed resources
 */
@Service(Service.Level.PROJECT)
class PackService(private val project: Project) {

    private val gson: Gson = GsonBuilder().setPrettyPrinting().create()

    /**
     * Install a pack from a JSON manifest file.
     * Returns (installed count, not-found count, failed count).
     */
    fun installPack(
        packFile: Path,
        scope: InstallScope,
        marketplaceItems: List<ResourceItem>,
        localItems: List<ResourceItem>,
        resourceClient: ResourceClient,
        installationService: InstallationService
    ): Triple<Int, Int, Int> {
        val pack = readPack(packFile) ?: return Triple(0, 0, 0)
        var installed = 0
        var notFound = 0
        var failed = 0

        // Batch metadata writes for efficiency during pack installs
        installationService.beginMetadataBatch()

        for (ref in pack.resources) {
            val item = resolvePackRef(ref, marketplaceItems, localItems)
            if (item == null) {
                notFound++
                continue
            }
            val success = if (item.localCollectionPath != null) {
                installationService.installFromLocal(item, scope)
            } else {
                installationService.installResource(item, scope)
            }
            if (success) installed++ else failed++
        }

        installationService.flushMetadataBatch()

        return Triple(installed, notFound, failed)
    }

    /**
     * Create a pack manifest from installed resources.
     */
    fun createPack(
        name: String,
        description: String,
        resources: List<InstalledResource>,
        outputFile: Path
    ): Boolean {
        val refs = resources.map { resource ->
            PackResourceRef(
                repo = resource.sourceRepo ?: "",
                category = resource.category.id,
                name = resource.name
            )
        }
        val pack = ResourcePack(name, description, refs)
        return try {
            Files.writeString(outputFile, gson.toJson(pack))
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Read a pack manifest from JSON file.
     */
    fun readPack(packFile: Path): ResourcePack? {
        return try {
            val json = Files.readString(packFile)
            gson.fromJson(json, ResourcePack::class.java)
        } catch (_: Exception) {
            null
        }
    }

    private fun resolvePackRef(
        ref: PackResourceRef,
        marketplaceItems: List<ResourceItem>,
        localItems: List<ResourceItem>
    ): ResourceItem? {
        // Try marketplace first
        val marketMatch = marketplaceItems.filter { it.name == ref.name }.let { matches ->
            if (ref.category.isNotBlank()) {
                matches.filter { it.category.id == ref.category }
            } else matches
        }.let { matches ->
            if (ref.repo.isNotBlank()) {
                matches.filter { "${it.repoOwner}/${it.repoName}" == ref.repo }
            } else matches
        }.firstOrNull()

        if (marketMatch != null) return marketMatch

        // Try local items
        return localItems.filter { it.name == ref.name }.let { matches ->
            if (ref.category.isNotBlank()) {
                matches.filter { it.category.id == ref.category }
            } else matches
        }.firstOrNull()
    }

    companion object {
        fun getInstance(project: Project): PackService =
            project.getService(PackService::class.java)
    }
}
