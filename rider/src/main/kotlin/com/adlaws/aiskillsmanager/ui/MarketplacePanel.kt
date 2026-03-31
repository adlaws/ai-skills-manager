package com.adlaws.aiskillsmanager.ui

import com.adlaws.aiskillsmanager.model.*
import com.adlaws.aiskillsmanager.services.*
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.ui.SearchTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import java.awt.BorderLayout
import java.awt.Component
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.*
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeCellRenderer
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreePath
import javax.swing.tree.TreeSelectionModel

/**
 * Marketplace tree panel — Favorites → Repo → Category → Resource items.
 *
 * Mirrors the VS Code extension's `marketplaceProvider.ts`:
 * - Async loading with progress indicator
 * - Search/filter by text and tags
 * - Favorites section at top
 * - Context menu: Install, Install Globally, Toggle Favorite, View Details
 * - Custom cell renderer with icons
 */
class MarketplacePanel(private val project: Project) {

    private val rootNode = DefaultMutableTreeNode("Marketplace")
    private val treeModel = DefaultTreeModel(rootNode)
    private val tree = Tree(treeModel)
    private val searchField = SearchTextField()

    val component: JComponent

    // Data state
    private var allData: Map<String, Map<ResourceCategory, List<ResourceItem>>> = emptyMap()
    private var failedRepos: Set<String> = emptySet()
    private var searchQuery: String = ""
    private var tagFilter: String? = null
    private var installedNames: Set<String> = emptySet()
    private val resourceClient = ResourceClient()
    private var loaded = false

    init {
        tree.isRootVisible = false
        tree.showsRootHandles = true
        tree.cellRenderer = MarketplaceCellRenderer()
        tree.selectionModel.selectionMode = TreeSelectionModel.DISCONTIGUOUS_TREE_SELECTION

        // Search field
        searchField.addDocumentListener(object : com.intellij.ui.DocumentAdapter() {
            override fun textChanged(e: javax.swing.event.DocumentEvent) {
                searchQuery = searchField.text.trim()
                rebuildTree()
            }
        })

        // Context menu
        tree.addMouseListener(object : MouseAdapter() {
            override fun mousePressed(e: MouseEvent) { handlePopup(e) }
            override fun mouseReleased(e: MouseEvent) { handlePopup(e) }
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 2) {
                    val node = tree.lastSelectedPathComponent as? DefaultMutableTreeNode ?: return
                    val item = node.userObject as? ResourceNodeData ?: return
                    viewDetails(item.resourceItem)
                }
            }
        })

        val toolbar = JPanel(BorderLayout()).apply {
            add(searchField, BorderLayout.CENTER)
        }

        val panel = JPanel(BorderLayout())
        panel.add(toolbar, BorderLayout.NORTH)
        panel.add(JBScrollPane(tree), BorderLayout.CENTER)
        component = panel
    }

    fun loadResources() {
        if (loaded) return
        loaded = true
        refresh()
    }

    fun refresh() {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Loading Marketplace Resources…", true) {
            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = true
                resourceClient.syncSettings()
                val (data, failed) = resourceClient.fetchAllResources()
                allData = data
                failedRepos = failed

                ApplicationManager.getApplication().invokeLater {
                    rebuildTree()
                }
            }
        })
    }

    fun setSearchQuery(query: String) {
        searchQuery = query
        searchField.text = query
        rebuildTree()
    }

    fun clearSearch() {
        searchQuery = ""
        searchField.text = ""
        rebuildTree()
    }

    fun setTagFilter(tag: String?) {
        tagFilter = tag
        rebuildTree()
    }

    fun clearTagFilter() {
        tagFilter = null
        rebuildTree()
    }

    fun setInstalledNames(names: Set<String>) {
        installedNames = names
        rebuildTree()
    }

    fun getAllItems(): List<ResourceItem> {
        return allData.values.flatMap { categories ->
            categories.values.flatten()
        }
    }

    fun getItemByName(name: String): ResourceItem? {
        return getAllItems().find { it.name == name }
    }

    fun getAllTags(): Set<String> {
        return getAllItems().flatMap { it.tags }.toSet()
    }

    fun getResourceClient(): ResourceClient = resourceClient

    private fun rebuildTree() {
        rootNode.removeAllChildren()
        val stateService = StateService.getInstance()

        // Favorites section
        val favoriteItems = getAllItems().filter { stateService.isFavorite(buildFavoriteId(it)) }
        val filteredFavorites = filterItems(favoriteItems)
        if (filteredFavorites.isNotEmpty()) {
            val favNode = DefaultMutableTreeNode(SectionNodeData("⭐ Favorites", filteredFavorites.size))
            for (item in filteredFavorites) {
                favNode.add(DefaultMutableTreeNode(ResourceNodeData(item, isFavorite = true)))
            }
            rootNode.add(favNode)
        }

        // Repo sections
        val settings = SettingsService.getInstance()
        val repos = settings.getRepositories().filter { it.enabled }
        for (repo in repos) {
            val repoData = allData[repo.key] ?: continue
            val repoLabel = repo.label ?: repo.key
            val repoNode = DefaultMutableTreeNode(RepoNodeData(repoLabel, repo.key))

            for (category in ResourceCategory.entries) {
                val items = repoData[category] ?: continue
                val filtered = filterItems(items)
                if (filtered.isEmpty()) continue

                val catNode = DefaultMutableTreeNode(CategoryNodeData(category, filtered.size))
                for (item in filtered) {
                    catNode.add(DefaultMutableTreeNode(ResourceNodeData(item, installedNames.contains(item.name))))
                }
                repoNode.add(catNode)
            }

            if (repoNode.childCount > 0) {
                rootNode.add(repoNode)
            }
        }

        // Failed repos
        for (repoKey in failedRepos) {
            rootNode.add(DefaultMutableTreeNode(FailedRepoNodeData(repoKey)))
        }

        treeModel.reload()

        // Expand first level
        for (i in 0 until rootNode.childCount) {
            tree.expandPath(TreePath(arrayOf(rootNode, rootNode.getChildAt(i))))
        }
    }

    private fun filterItems(items: List<ResourceItem>): List<ResourceItem> {
        return items.filter { item ->
            val matchesSearch = searchQuery.isBlank() ||
                    item.name.contains(searchQuery, ignoreCase = true) ||
                    (item.description?.contains(searchQuery, ignoreCase = true) == true)
            val matchesTag = tagFilter == null || item.tags.any { it.equals(tagFilter, ignoreCase = true) }
            matchesSearch && matchesTag
        }
    }

    private fun handlePopup(e: MouseEvent) {
        if (!e.isPopupTrigger) return
        val path = tree.getPathForLocation(e.x, e.y) ?: return

        // If the right-clicked node is not in the current selection, select only it
        if (!tree.isPathSelected(path)) {
            tree.selectionPath = path
        }

        // Gather all selected resource nodes
        val selectedItems = getSelectedResourceItems()
        if (selectedItems.isEmpty()) return

        val menu = JPopupMenu()

        if (selectedItems.size > 1) {
            // Bulk actions
            menu.add(JMenuItem("Install ${selectedItems.size} to Workspace").apply {
                addActionListener { selectedItems.forEach { installItem(it, InstallScope.WORKSPACE) } }
            })
            menu.add(JMenuItem("Install ${selectedItems.size} Globally").apply {
                addActionListener { selectedItems.forEach { installItem(it, InstallScope.GLOBAL) } }
            })
            menu.addSeparator()
            menu.add(JMenuItem("Toggle Favorite for ${selectedItems.size} Items").apply {
                addActionListener {
                    val stateService = StateService.getInstance()
                    selectedItems.forEach { stateService.toggleFavorite(buildFavoriteId(it)) }
                    rebuildTree()
                }
            })
        } else {
            val item = selectedItems.first()

            menu.add(JMenuItem("Install to Workspace").apply {
                addActionListener { installItem(item, InstallScope.WORKSPACE) }
            })
            menu.add(JMenuItem("Install Globally").apply {
                addActionListener { installItem(item, InstallScope.GLOBAL) }
            })
            menu.addSeparator()

            val stateService = StateService.getInstance()
            val favId = buildFavoriteId(item)
            val favLabel = if (stateService.isFavorite(favId)) "Remove from Favorites" else "Add to Favorites"
            menu.add(JMenuItem(favLabel).apply {
                addActionListener {
                    stateService.toggleFavorite(favId)
                    rebuildTree()
                }
            })
            menu.addSeparator()

            menu.add(JMenuItem("View Details").apply {
                addActionListener { viewDetails(item) }
            })
        }

        menu.show(tree, e.x, e.y)
    }

    private fun getSelectedResourceItems(): List<ResourceItem> {
        val paths = tree.selectionPaths ?: return emptyList()
        return paths.mapNotNull { p ->
            val node = p.lastPathComponent as? DefaultMutableTreeNode ?: return@mapNotNull null
            (node.userObject as? ResourceNodeData)?.resourceItem
        }
    }

    private fun installItem(item: ResourceItem, scope: InstallScope) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Installing ${item.name}…", false) {
            override fun run(indicator: ProgressIndicator) {
                val projectService = ProjectService.getInstance(project)
                val installService = InstallationService(resourceClient, projectService)
                val success = installService.installResource(item, scope)
                ApplicationManager.getApplication().invokeLater {
                    if (success) {
                        com.intellij.openapi.ui.Messages.showInfoMessage(
                            project, "'${item.name}' installed successfully.", "Installed"
                        )
                    } else {
                        com.intellij.openapi.ui.Messages.showErrorDialog(
                            project, "Failed to install '${item.name}'.", "Install Failed"
                        )
                    }
                }
            }
        })
    }

    private fun viewDetails(item: ResourceItem) {
        // Fetch content if not yet loaded
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Loading details…", false) {
            override fun run(indicator: ProgressIndicator) {
                val content = if (item.isFolder) {
                    item.fullContent ?: resourceClient.fetchRawContent(
                        item.repoOwner, item.repoName, item.repoBranch, "${item.path}/SKILL.md"
                    )
                } else {
                    item.content ?: resourceClient.fetchRawContent(
                        item.repoOwner, item.repoName, item.repoBranch, item.path
                    )
                }
                val enrichedItem = item.copy(content = content, fullContent = content)

                ApplicationManager.getApplication().invokeLater {
                    ResourceDetailPanel.show(project, enrichedItem, resourceClient)
                }
            }
        })
    }

    private fun buildFavoriteId(item: ResourceItem): String =
        "${item.repoOwner}/${item.repoName}:${item.category.id}:${item.name}"

    // ---- Node data classes ----

    data class ResourceNodeData(val resourceItem: ResourceItem, val isInstalled: Boolean = false, val isFavorite: Boolean = false) {
        override fun toString(): String = resourceItem.name
    }

    data class CategoryNodeData(val category: ResourceCategory, val count: Int) {
        override fun toString(): String = "${category.label} ($count)"
    }

    data class RepoNodeData(val label: String, val key: String) {
        override fun toString(): String = label
    }

    data class SectionNodeData(val label: String, val count: Int) {
        override fun toString(): String = "$label ($count)"
    }

    data class FailedRepoNodeData(val key: String) {
        override fun toString(): String = "⚠ $key (failed to load)"
    }

    // ---- Cell renderer ----

    private class MarketplaceCellRenderer : DefaultTreeCellRenderer() {
        override fun getTreeCellRendererComponent(
            tree: JTree, value: Any?, selected: Boolean,
            expanded: Boolean, leaf: Boolean, row: Int, hasFocus: Boolean
        ): Component {
            super.getTreeCellRendererComponent(tree, value, selected, expanded, leaf, row, hasFocus)
            val node = value as? DefaultMutableTreeNode ?: return this
            when (val data = node.userObject) {
                is ResourceNodeData -> {
                    val item = data.resourceItem
                    text = buildString {
                        append(item.name)
                        if (data.isInstalled) append(" ✓")
                        if (data.isFavorite) append(" ⭐")
                    }
                    toolTipText = item.description ?: item.name
                    icon = null
                }
                is CategoryNodeData -> {
                    text = "${data.category.label} (${data.count})"
                    icon = null
                }
                is RepoNodeData -> {
                    text = data.label
                    toolTipText = data.key
                    icon = null
                }
                is SectionNodeData -> {
                    text = data.toString()
                    icon = null
                }
                is FailedRepoNodeData -> {
                    text = data.toString()
                    icon = null
                }
            }
            return this
        }
    }
}
