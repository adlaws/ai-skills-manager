package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.*
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant

/**
 * Handles exporting and importing extension configuration.
 *
 * Mirrors the VS Code extension's `configService.ts`:
 * - Exports repositories, local collections, install locations, favorites, cache timeout
 * - Import supports merge (add new, keep existing) or replace strategies
 */
@Service(Service.Level.PROJECT)
class ConfigService(private val project: Project) {

    private val gson: Gson = GsonBuilder().setPrettyPrinting().create()

    /**
     * Export the current configuration to a JSON file.
     */
    fun exportConfig(outputFile: Path): Boolean {
        val settings = SettingsService.getInstance()
        val stateService = StateService.getInstance()

        val config = ExportedConfig(
            version = 1,
            exportedAt = Instant.now().toString(),
            repositories = settings.getRepositories(),
            localCollections = settings.getLocalCollections(),
            installLocations = settings.getState().installLocations.toMap().ifEmpty { null },
            globalInstallLocations = settings.getState().globalInstallLocations.toMap().ifEmpty { null },
            favorites = stateService.getState().favorites.toSet().ifEmpty { null },
            cacheTimeout = settings.getCacheTimeout().let { if (it != 3600) it else null }
        )

        return try {
            Files.writeString(outputFile, gson.toJson(config))
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Import configuration from a JSON file.
     *
     * @param merge If true, merges with existing config (adds new, keeps existing).
     *              If false, replaces existing config.
     */
    fun importConfig(configFile: Path, merge: Boolean = true): Boolean {
        val config = try {
            val json = Files.readString(configFile)
            gson.fromJson(json, ExportedConfig::class.java)
        } catch (_: Exception) {
            return false
        }

        if (config.version != 1) return false

        val settings = SettingsService.getInstance()
        val stateService = StateService.getInstance()

        // Import repositories
        config.repositories?.let { repos ->
            if (merge) {
                for (repo in repos) {
                    settings.addRepository(repo.owner, repo.repo, repo.branch,
                        repo.skillsPath, repo.singleSkill, repo.label)
                }
            } else {
                settings.getState().repositories.clear()
                for (repo in repos) {
                    settings.addRepository(repo.owner, repo.repo, repo.branch,
                        repo.skillsPath, repo.singleSkill, repo.label)
                }
            }
        }

        // Import local collections
        config.localCollections?.let { collections ->
            if (merge) {
                for (col in collections) {
                    settings.addLocalCollection(col.path, col.label)
                }
            } else {
                settings.getState().localCollections.clear()
                for (col in collections) {
                    settings.addLocalCollection(col.path, col.label)
                }
            }
        }

        // Import install locations
        config.installLocations?.let { locations ->
            if (!merge) settings.getState().installLocations.clear()
            for ((key, value) in locations) {
                settings.getState().installLocations[key] = value
            }
        }

        config.globalInstallLocations?.let { locations ->
            if (!merge) settings.getState().globalInstallLocations.clear()
            for ((key, value) in locations) {
                settings.getState().globalInstallLocations[key] = value
            }
        }

        // Favorites always merge (union)
        config.favorites?.let { favorites ->
            stateService.getState().favorites.addAll(favorites)
        }

        // Cache timeout
        config.cacheTimeout?.let { timeout ->
            settings.setCacheTimeout(timeout)
        }

        return true
    }

    companion object {
        fun getInstance(project: Project): ConfigService =
            project.getService(ConfigService::class.java)
    }
}
