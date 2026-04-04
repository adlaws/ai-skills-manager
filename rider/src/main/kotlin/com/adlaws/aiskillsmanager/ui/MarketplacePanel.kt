package com.adlaws.aiskillsmanager.ui

import com.adlaws.aiskillsmanager.model.*
import com.adlaws.aiskillsmanager.services.*
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.ui.ColoredTreeCellRenderer
import com.intellij.ui.SearchTextField
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Font
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.*
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreePath
import javax.swing.tree.TreeSelectionModel

/**
 * Marketplace tree panel — Favorites → Repo → Category → Resource items.
 *
 * Layout: top/bottom split pane. Top half is the tree with search bar,
 * bottom half is the detail panel showing selected resource info + install buttons.
 * A loading overlay with spinner appears while repos are being fetched.
 */
class MarketplacePanel(private val project: Project) {

    private val LOG = Logger.getInstance(MarketplacePanel::class.java)

    private val rootNode = DefaultMutableTreeNode("Marketplace")
    private val treeModel = DefaultTreeModel(rootNode)
    private val tree = Tree(treeModel)
    private val searchField = SearchTextField()
    private val detailPanel = ResourceDetailPanel(project)

    val component: JComponent

    // Loading overlay
    private val treeCard = JPanel(CardLayout())
    private val CARD_TREE = "tree"
    private val CARD_LOADING = "loading"
    private val loadingLabel = JLabel("Loading marketplace resources…", SwingConstants.CENTER).apply {
        font = UIUtil.getLabelFont().deriveFont(Font.ITALIC, 12f)
        foreground = UIUtil.getInactiveTextColor()
        icon = com.intellij.icons.AllIcons.Process.Step_1  // static spinner frame as placeholder
    }

    // Data state
    private var allData: Map<String, Map<ResourceCategory, List<ResourceItem>>> = emptyMap()
    private var failedRepos: Set<String> = emptySet()
    private var searchQuery: String = ""
    private var tagFilter: String? = null
    private var installedNames: Set<String> = emptySet()
    private val resourceClient = ResourceClient()
    private var loaded = false

    // Animated spinner support
    private var spinnerTimer: Timer? = null
    private val spinnerIcons = arrayOf(
        com.intellij.icons.AllIcons.Process.Step_1,
        com.intellij.icons.AllIcons.Process.Step_2,
        com.intellij.icons.AllIcons.Process.Step_3,
        com.intellij.icons.AllIcons.Process.Step_4,
        com.intellij.icons.AllIcons.Process.Step_5,
        com.intellij.icons.AllIcons.Process.Step_6,
        com.intellij.icons.AllIcons.Process.Step_7,
        com.intellij.icons.AllIcons.Process.Step_8
    )
    private var spinnerFrame = 0

    init {
        tree.isRootVisible = false
        tree.showsRootHandles = true
        tree.cellRenderer = MarketplaceCellRenderer()
        tree.selectionModel.selectionMode = TreeSelectionModel.DISCONTIGUOUS_TREE_SELECTION

        detailPanel.setResourceClient(resourceClient)

        // Search field
        searchField.addDocumentListener(object : com.intellij.ui.DocumentAdapter() {
            override fun textChanged(e: javax.swing.event.DocumentEvent) {
                searchQuery = searchField.text.trim()
                rebuildTree()
            }
        })

        // Mouse handler: left click → detail panel, right click → context menu
        tree.addMouseListener(object : MouseAdapter() {
            override fun mousePressed(e: MouseEvent) {
                if (e.isPopupTrigger) { handlePopup(e); return }
                if (SwingUtilities.isLeftMouseButton(e) && e.clickCount == 1) {
                    val path = tree.getPathForLocation(e.x, e.y) ?: return
                    val node = path.lastPathComponent as? DefaultMutableTreeNode ?: return
                    val data = node.userObject as? ResourceNodeData ?: return
                    SwingUtilities.invokeLater { detailPanel.showItem(data.resourceItem) }
                }
            }
            override fun mouseReleased(e: MouseEvent) { handlePopup(e) }
        })

        // Build the tree area with loading overlay
        val treeScrollPane = JBScrollPane(tree)
        val loadingPanel = JPanel(BorderLayout()).apply {
            add(loadingLabel, BorderLayout.CENTER)
        }
        treeCard.add(treeScrollPane, CARD_TREE)
        treeCard.add(loadingPanel, CARD_LOADING)
        showTreeCard()

        val toolbar = JPanel(BorderLayout()).apply {
            add(searchField, BorderLayout.CENTER)
        }

        val treePanel = JPanel(BorderLayout())
        treePanel.add(toolbar, BorderLayout.NORTH)
        treePanel.add(treeCard, BorderLayout.CENTER)

        // Split pane: tree on top, detail on bottom
        val splitPane = JSplitPane(JSplitPane.VERTICAL_SPLIT, treePanel, detailPanel)
        splitPane.resizeWeight = 0.55
        splitPane.dividerSize = 5
        splitPane.isContinuousLayout = true

        component = splitPane
    }

    fun loadResources() {
        if (loaded) return
        loaded = true
        refresh()
    }

    fun refresh() {
        LOG.info("refresh() called, loaded=$loaded")
        showLoadingCard()
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Loading Marketplace Resources…", true) {
            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = true
                try {
                    resourceClient.syncSettings()
                    val (data, failed) = resourceClient.fetchAllResources()
                    LOG.info("refresh: got ${data.size} repos, ${failed.size} failed")
                    allData = data
                    failedRepos = failed

                    ApplicationManager.getApplication().invokeLater {
                        rebuildTree()
                        showTreeCard()
                    }
                } catch (e: Exception) {
                    LOG.error("refresh FAILED", e)
                    ApplicationManager.getApplication().invokeLater {
                        showTreeCard()
                    }
                }
            }
        })
    }

    private fun showLoadingCard() {
        (treeCard.layout as CardLayout).show(treeCard, CARD_LOADING)
        startSpinner()
    }

    private fun showTreeCard() {
        stopSpinner()
        (treeCard.layout as CardLayout).show(treeCard, CARD_TREE)
    }

    private fun startSpinner() {
        spinnerFrame = 0
        spinnerTimer?.stop()
        spinnerTimer = Timer(100) {
            spinnerFrame = (spinnerFrame + 1) % spinnerIcons.size
            loadingLabel.icon = spinnerIcons[spinnerFrame]
        }
        spinnerTimer?.start()
    }

    private fun stopSpinner() {
        spinnerTimer?.stop()
        spinnerTimer = null
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

        if (!tree.isPathSelected(path)) {
            tree.selectionPath = path
        }

        val selectedItems = getSelectedResourceItems()
        if (selectedItems.isEmpty()) return

        val menu = JPopupMenu()

        if (selectedItems.size > 1) {
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

    private class MarketplaceCellRenderer : ColoredTreeCellRenderer() {
        override fun customizeCellRenderer(
            tree: JTree, value: Any?, selected: Boolean,
            expanded: Boolean, leaf: Boolean, row: Int, hasFocus: Boolean
        ) {
            val node = value as? DefaultMutableTreeNode ?: return
            when (val data = node.userObject) {
                is ResourceNodeData -> {
                    val item = data.resourceItem
                    append(item.name, SimpleTextAttributes.REGULAR_ATTRIBUTES)
                    if (data.isInstalled) append(" ✓", SimpleTextAttributes.GRAY_ATTRIBUTES)
                    if (data.isFavorite) append(" ⭐", SimpleTextAttributes.REGULAR_ATTRIBUTES)
                    if (!item.description.isNullOrBlank()) {
                        append("  ${item.description}", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                    }
                    toolTipText = item.description ?: item.name
                    icon = null
                }
                is CategoryNodeData -> {
                    append(data.category.label, SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES)
                    append(" (${data.count})", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                    icon = null
                }
                is RepoNodeData -> {
                    append(data.label, SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES)
                    toolTipText = data.key
                    icon = null
                }
                is SectionNodeData -> {
                    append(data.label, SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES)
                    append(" (${data.count})", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                    icon = null
                }
                is FailedRepoNodeData -> {
                    append("⚠ ${data.key}", SimpleTextAttributes.ERROR_ATTRIBUTES)
                    append(" (failed to load)", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                    icon = null
                }
            }
        }
    }
}
