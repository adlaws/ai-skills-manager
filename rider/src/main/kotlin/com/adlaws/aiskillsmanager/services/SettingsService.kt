package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.*
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

/**
 * Application-level settings persisted across IDE restarts.
 *
 * Mirrors the VS Code extension's `aiSkillsManager.*` configuration namespace.
 */
@Service(Service.Level.APP)
@State(name = "AiSkillsManagerSettings", storages = [Storage("AiSkillsManager.xml")])
class SettingsService : PersistentStateComponent<SettingsService.State> {

    data class State(
        var repositories: MutableList<RepositoryState> = mutableListOf(
            RepositoryState("github", "awesome-copilot", label = "Awesome Copilot"),
            RepositoryState("anthropics", "skills", skillsPath = "skills"),
            RepositoryState("pytorch", "pytorch", skillsPath = ".claude/skills"),
            RepositoryState("formulahendry", "agent-skill-code-runner", skillsPath = ".github/skills/code-runner", singleSkill = true)
        ),
        var localCollections: MutableList<LocalCollectionState> = mutableListOf(),
        var installLocations: MutableMap<String, String> = mutableMapOf(),
        var globalInstallLocations: MutableMap<String, String> = mutableMapOf(),
        var githubToken: String = "",
        var cacheTimeout: Int = 3600,
        var localCollectionWatchInterval: Int = 30
    )

    data class RepositoryState(
        var owner: String = "",
        var repo: String = "",
        var branch: String = "main",
        var skillsPath: String? = null,
        var singleSkill: Boolean = false,
        var enabled: Boolean = true,
        var label: String? = null
    )

    data class LocalCollectionState(
        var path: String = "",
        var label: String? = null,
        var enabled: Boolean = true
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    // ---- Read methods ----

    fun getRepositories(): List<ResourceRepository> = state.repositories.map {
        ResourceRepository(it.owner, it.repo, it.branch, it.skillsPath, it.singleSkill, it.enabled, it.label)
    }

    fun getLocalCollections(): List<LocalCollection> = state.localCollections.map {
        LocalCollection(it.path, it.label, it.enabled)
    }

    fun getInstallLocation(category: ResourceCategory, scope: InstallScope): String {
        return when (scope) {
            InstallScope.WORKSPACE -> state.installLocations[category.id] ?: category.defaultPath
            InstallScope.GLOBAL -> state.globalInstallLocations[category.id]
                ?: "~/.agents/${category.id}"
        }
    }

    fun getGithubToken(): String = state.githubToken

    fun getCacheTimeout(): Int = state.cacheTimeout

    fun getLocalCollectionWatchInterval(): Int = state.localCollectionWatchInterval.coerceIn(5, 300)

    // ---- Mutation methods ----

    fun addRepository(owner: String, repo: String, branch: String = "main",
                      skillsPath: String? = null, singleSkill: Boolean = false, label: String? = null) {
        if (state.repositories.any { it.owner == owner && it.repo == repo }) return
        state.repositories.add(RepositoryState(owner, repo, branch, skillsPath, singleSkill, true, label))
    }

    fun removeRepository(owner: String, repo: String) {
        state.repositories.removeAll { it.owner == owner && it.repo == repo }
    }

    fun toggleRepository(owner: String, repo: String) {
        state.repositories.find { it.owner == owner && it.repo == repo }?.let {
            it.enabled = !it.enabled
        }
    }

    fun addLocalCollection(path: String, label: String? = null) {
        if (state.localCollections.any { it.path == path }) return
        state.localCollections.add(LocalCollectionState(path, label, true))
    }

    fun removeLocalCollection(path: String) {
        state.localCollections.removeAll { it.path == path }
    }

    fun toggleLocalCollection(path: String) {
        state.localCollections.find { it.path == path }?.let {
            it.enabled = !it.enabled
        }
    }

    fun setInstallLocation(category: ResourceCategory, scope: InstallScope, location: String) {
        when (scope) {
            InstallScope.WORKSPACE -> state.installLocations[category.id] = location
            InstallScope.GLOBAL -> state.globalInstallLocations[category.id] = location
        }
    }

    fun setGithubToken(token: String) {
        state.githubToken = token
    }

    fun setCacheTimeout(seconds: Int) {
        state.cacheTimeout = seconds
    }

    fun setLocalCollectionWatchInterval(seconds: Int) {
        state.localCollectionWatchInterval = seconds.coerceIn(5, 300)
    }

    companion object {
        fun getInstance(): SettingsService =
            ApplicationManager.getApplication().getService(SettingsService::class.java)
    }
}
