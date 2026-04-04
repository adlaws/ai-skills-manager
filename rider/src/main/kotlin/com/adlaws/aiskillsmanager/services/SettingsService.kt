package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.*
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

/**
 * Application-level settings persisted across IDE restarts.
 *
 * Mirrors the VS Code extension's `aiSkillsManager.*` configuration namespace.
 */
@Service(Service.Level.APP)
@State(name = "AiSkillsManagerSettings", storages = [Storage("AiSkillsManager.xml")])
class SettingsService : PersistentStateComponent<SettingsService.State> {

    data class State(
        var repositories: MutableList<RepositoryState> = mutableListOf(),
        var localCollections: MutableList<LocalCollectionState> = mutableListOf(),
        var installLocations: MutableMap<String, String> = mutableMapOf(),
        var globalInstallLocations: MutableMap<String, String> = mutableMapOf(),
        var githubToken: String = "",
        var cacheTimeout: Int = 3600,
        var localCollectionWatchInterval: Int = 30,
        /** Tracks whether the user has ever explicitly saved repos. False = use defaults. */
        var repositoriesInitialized: Boolean = false
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

    init {
        // Populate defaults on fresh construction (first install, no XML file yet)
        ensureDefaultRepositories()
    }

    override fun getState(): State = state

    override fun loadState(state: State) {
        XmlSerializerUtil.copyBean(state, this.state)
        // If the serializer produced null/empty repos and user never explicitly cleared them,
        // restore defaults. This guards against IntelliJ's XML serializer dropping
        // mutable collection defaults from Kotlin data classes.
        ensureDefaultRepositories()
    }

    private fun ensureDefaultRepositories() {
        if (state.repositories.isEmpty() && !state.repositoriesInitialized) {
            state.repositories.addAll(DEFAULT_REPOSITORIES)
        }
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
        state.repositoriesInitialized = true
    }

    fun removeRepository(owner: String, repo: String) {
        state.repositories.removeAll { it.owner == owner && it.repo == repo }
        state.repositoriesInitialized = true
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
        val DEFAULT_REPOSITORIES = listOf(
            RepositoryState("github", "awesome-copilot", label = "Awesome Copilot"),
            RepositoryState("anthropics", "skills", skillsPath = "skills"),
            RepositoryState("pytorch", "pytorch", skillsPath = ".claude/skills"),
            RepositoryState("formulahendry", "agent-skill-code-runner", skillsPath = ".github/skills/code-runner", singleSkill = true)
        )

        fun getInstance(): SettingsService =
            ApplicationManager.getApplication().getService(SettingsService::class.java)
    }
}
