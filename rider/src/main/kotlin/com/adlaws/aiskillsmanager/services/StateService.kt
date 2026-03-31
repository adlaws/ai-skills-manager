package com.adlaws.aiskillsmanager.services

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

/**
 * Application-level persistent state: favorites, etc.
 *
 * Mirrors the VS Code extension's globalState usage.
 */
@Service(Service.Level.APP)
@State(name = "AiSkillsManagerState", storages = [Storage("AiSkillsManagerState.xml")])
class StateService : PersistentStateComponent<StateService.State> {

    data class State(
        var favorites: MutableSet<String> = mutableSetOf()
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    fun isFavorite(id: String): Boolean = id in state.favorites

    fun toggleFavorite(id: String): Boolean {
        return if (id in state.favorites) {
            state.favorites.remove(id)
            false
        } else {
            state.favorites.add(id)
            true
        }
    }

    companion object {
        fun getInstance(): StateService =
            ApplicationManager.getApplication().getService(StateService::class.java)
    }
}
