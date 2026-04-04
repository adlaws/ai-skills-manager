package com.adlaws.aiskillsmanager.ui

import com.adlaws.aiskillsmanager.model.*
import com.adlaws.aiskillsmanager.services.*
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.ui.SearchTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Desktop
import java.awt.Font
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.nio.file.Files
import java.nio.file.Paths
import javax.swing.*
import javax.swing.tree.DefaultMutableTreeNode
import com.intellij.ui.ColoredTreeCellRenderer
import com.intellij.ui.SimpleTextAttributes
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreePath
import javax.swing.tree.TreeSelectionModel

/**
 * Local Collections tree panel — Collection → Category → Resource items.
 *
 * Mirrors the VS Code extension's `localProvider.ts`:
 * - Scans local collection folders for resources
 * - Detects missing collection directories
 * - Search filtering
 * - Context menus: Install, Install Globally, Open, Delete
 */
class LocalCollectionsPanel(private val project: Project) : Disposable {

    private val LOG = com.intellij.openapi.diagnostic.Logger.getInstance(LocalCollectionsPanel::class.java)

    private val rootNode = DefaultMutableTreeNode("Local Collections")
    private val treeModel = DefaultTreeModel(rootNode)
    private val tree = Tree(treeModel)
    private val searchField = SearchTextField()
    private val detailPanel = ResourceDetailPanel(project)

    val component: JComponent

    // Loading overlay
    private val treeCard = JPanel(CardLayout())
    private val CARD_TREE = "tree"
    private val CARD_LOADING = "loading"
    private val loadingLabel = JLabel("Scanning local collections…", SwingConstants.CENTER).apply {
        font = UIUtil.getLabelFont().deriveFont(Font.ITALIC, 12f)
        foreground = UIUtil.getInactiveTextColor()
        icon = com.intellij.icons.AllIcons.Process.Step_1
    }
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

    private var allItems: List<ResourceItem> = emptyList()
    private var searchQuery: String = ""
    private var installedNames: Set<String> = emptySet()
    private var loaded = false

    // File watcher debounce
    private var pendingRefresh: java.util.Timer? = null
    private val refreshDebounceMs = 1000L

    // Periodic existence check timer
    private var existenceCheckTimer: java.util.Timer? = null

    init {
        tree.isRootVisible = false
        tree.showsRootHandles = true
        tree.cellRenderer = LocalCellRenderer()
        tree.selectionModel.selectionMode = TreeSelectionModel.DISCONTIGUOUS_TREE_SELECTION

        searchField.addDocumentListener(object : com.intellij.ui.DocumentAdapter() {
            override fun textChanged(e: javax.swing.event.DocumentEvent) {
                searchQuery = searchField.text.trim()
                rebuildTree()
            }
        })

        // Click handler: left press → detail panel, double press → open resource, right click → context menu
        tree.addMouseListener(object : MouseAdapter() {
            override fun mousePressed(e: MouseEvent) {
                if (e.isPopupTrigger) { handlePopup(e); return }
                if (SwingUtilities.isLeftMouseButton(e)) {
                    val path = tree.getPathForLocation(e.x, e.y) ?: return
                    val node = path.lastPathComponent as? DefaultMutableTreeNode ?: return
                    val data = node.userObject as? LocalResourceNodeData ?: return
                    if (e.clickCount == 2) {
                        openResource(data.item)
                    } else {
                        SwingUtilities.invokeLater { detailPanel.showItem(data.item) }
                    }
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

        // Register VFS listener for file changes in collection directories
        val connection = project.messageBus.connect(this)
        connection.subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
            override fun after(events: List<VFileEvent>) {
                val settings = SettingsService.getInstance()
                val collectionPaths = settings.getLocalCollections()
                    .filter { it.enabled }
                    .map { resolveCollectionPath(it.path).toString() }

                val relevant = events.any { event ->
                    val path = event.path
                    collectionPaths.any { path.startsWith(it) }
                }
                if (relevant) {
                    debouncedRefresh()
                }
            }
        })

        // Periodic existence check for missing/newly-created collection folders
        startExistenceCheckTimer()
    }

    private fun debouncedRefresh() {
        pendingRefresh?.cancel()
        pendingRefresh = java.util.Timer().apply {
            schedule(object : java.util.TimerTask() {
                override fun run() {
                    ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) {
                            refresh()
                        }
                    }
                }
            }, refreshDebounceMs)
        }
    }

    private fun startExistenceCheckTimer() {
        existenceCheckTimer?.cancel()
        val intervalMs = SettingsService.getInstance().getLocalCollectionWatchInterval() * 1000L
        existenceCheckTimer = java.util.Timer().apply {
            schedule(object : java.util.TimerTask() {
                override fun run() {
                    ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) {
                            refresh()
                        }
                    }
                }
            }, intervalMs, intervalMs)
        }
    }

    override fun dispose() {
        pendingRefresh?.cancel()
        existenceCheckTimer?.cancel()
        spinnerTimer?.stop()
    }

    fun loadResources() {
        if (loaded) return
        loaded = true
        refresh()
    }

    private fun showLoadingCard() {
        (treeCard.layout as CardLayout).show(treeCard, CARD_LOADING)
        spinnerFrame = 0
        spinnerTimer?.stop()
        spinnerTimer = Timer(100) {
            spinnerFrame = (spinnerFrame + 1) % spinnerIcons.size
            loadingLabel.icon = spinnerIcons[spinnerFrame]
        }
        spinnerTimer?.start()
    }

    private fun showTreeCard() {
        spinnerTimer?.stop()
        spinnerTimer = null
        (treeCard.layout as CardLayout).show(treeCard, CARD_TREE)
    }

    fun refresh() {
        showLoadingCard()
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Scanning Local Collections…", true) {
            override fun run(indicator: ProgressIndicator) {
                val settings = SettingsService.getInstance()
                val collections = settings.getLocalCollections().filter { it.enabled }
                val items = mutableListOf<ResourceItem>()

                for (collection in collections) {
                    val collPath = resolveCollectionPath(collection.path)
                    if (!Files.isDirectory(collPath)) continue

                    for (category in ResourceCategory.entries) {
                        val categoryDir = collPath.resolve(category.id)
                        if (!Files.isDirectory(categoryDir)) continue

                        try {
                            Files.list(categoryDir).use { stream ->
                                stream.forEach { entry ->
                                    val name = entry.fileName.toString()
                                    if (name.startsWith(".")) return@forEach

                                    val isSkill = category == ResourceCategory.SKILLS
                                            && Files.isDirectory(entry)
                                            && Files.exists(entry.resolve("SKILL.md"))

                                    val isFile = !Files.isDirectory(entry)

                                    if (isSkill) {
                                        // Parse SKILL.md for metadata
                                        val resourceClient = ResourceClient()
                                        val content = try { Files.readString(entry.resolve("SKILL.md")) } catch (_: Exception) { null }
                                        val meta = if (content != null) resourceClient.parseSkillMd(content) else emptyMap()
                                        items.add(ResourceItem(
                                            name = meta["name"] ?: name,
                                            category = category,
                                            path = entry.toString(),
                                            description = meta["description"],
                                            content = content,
                                            fullContent = content,
                                            tags = content?.let { parseTags(meta["tags"]) } ?: emptyList(),
                                            isFolder = true,
                                            localCollectionPath = entry.toString()
                                        ))
                                    } else if (isFile) {
                                        items.add(ResourceItem(
                                            name = name,
                                            category = category,
                                            path = entry.toString(),
                                            isFolder = false,
                                            localCollectionPath = entry.toString()
                                        ))
                                    }
                                }
                            }
                        } catch (_: Exception) { }
                    }
                }

                allItems = items
                ApplicationManager.getApplication().invokeLater {
                    rebuildTree()
                    showTreeCard()
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

    fun setInstalledNames(names: Set<String>) {
        installedNames = names
        rebuildTree()
    }

    fun getAllItems(): List<ResourceItem> = allItems

    private fun rebuildTree() {
        rootNode.removeAllChildren()

        val settings = SettingsService.getInstance()
        val collections = settings.getLocalCollections().filter { it.enabled }

        for (collection in collections) {
            val collPath = resolveCollectionPath(collection.path)
            val label = collection.label ?: collection.path
            val exists = Files.isDirectory(collPath)

            if (!exists) {
                rootNode.add(DefaultMutableTreeNode(MissingCollectionNodeData(label, collection.path)))
                continue
            }

            val collectionNode = DefaultMutableTreeNode(CollectionNodeData(label, collection.path))

            // Group this collection's items by category
            val collItems = allItems.filter {
                it.localCollectionPath?.startsWith(collPath.toString()) == true ||
                        it.path.startsWith(collPath.toString())
            }
            val byCategory = collItems.groupBy { it.category }

            for (category in ResourceCategory.entries) {
                val items = byCategory[category] ?: continue
                val filtered = filterItems(items)
                if (filtered.isEmpty()) continue

                val catNode = DefaultMutableTreeNode(LocalCategoryNodeData(category, filtered.size))
                for (item in filtered) {
                    val isInstalled = installedNames.contains(item.name)
                    catNode.add(DefaultMutableTreeNode(LocalResourceNodeData(item, isInstalled)))
                }
                collectionNode.add(catNode)
            }

            rootNode.add(collectionNode)
        }

        treeModel.reload()
        // Expand first level
        for (i in 0 until rootNode.childCount) {
            tree.expandPath(TreePath(arrayOf(rootNode, rootNode.getChildAt(i))))
        }
    }

    private fun filterItems(items: List<ResourceItem>): List<ResourceItem> {
        if (searchQuery.isBlank()) return items
        return items.filter {
            it.name.contains(searchQuery, ignoreCase = true) ||
                    (it.description?.contains(searchQuery, ignoreCase = true) == true)
        }
    }

    private fun handlePopup(e: MouseEvent) {
        if (!e.isPopupTrigger) return
        val path = tree.getPathForLocation(e.x, e.y) ?: return

        // If the right-clicked node is not in the current selection, select only it
        if (!tree.isPathSelected(path)) {
            tree.selectionPath = path
        }

        // Check for multi-select of resource nodes
        val selectedItems = getSelectedLocalResourceItems()
        if (selectedItems.size > 1) {
            showBulkResourcePopup(e, selectedItems)
            return
        }

        // Single selection fallback
        val node = path.lastPathComponent as? DefaultMutableTreeNode ?: return
        when (val data = node.userObject) {
            is LocalResourceNodeData -> showResourcePopup(e, data.item)
            is CollectionNodeData -> showCollectionPopup(e, data)
            is MissingCollectionNodeData -> showCollectionDisconnectPopup(e, data.path)
        }
    }

    private fun getSelectedLocalResourceItems(): List<ResourceItem> {
        val paths = tree.selectionPaths ?: return emptyList()
        return paths.mapNotNull { p ->
            val node = p.lastPathComponent as? DefaultMutableTreeNode ?: return@mapNotNull null
            (node.userObject as? LocalResourceNodeData)?.item
        }
    }

    private fun showBulkResourcePopup(e: MouseEvent, items: List<ResourceItem>) {
        val menu = JPopupMenu()

        menu.add(JMenuItem("Install ${items.size} to Workspace").apply {
            addActionListener { items.forEach { installItem(it, InstallScope.WORKSPACE) } }
        })
        menu.add(JMenuItem("Install ${items.size} Globally").apply {
            addActionListener { items.forEach { installItem(it, InstallScope.GLOBAL) } }
        })
        menu.addSeparator()
        menu.add(JMenuItem("Delete ${items.size} from Disk").apply {
            addActionListener { bulkDeleteResources(items) }
        })

        menu.show(tree, e.x, e.y)
    }

    private fun bulkDeleteResources(items: List<ResourceItem>) {
        val result = Messages.showOkCancelDialog(
            project,
            "Delete ${items.size} resource(s) from disk? This cannot be undone.",
            "Delete Resources",
            "Delete All",
            "Cancel",
            Messages.getWarningIcon()
        )
        if (result != Messages.OK) return

        var failed = 0
        for (item in items) {
            try {
                val path = Paths.get(item.localCollectionPath ?: item.path)
                if (Files.isDirectory(path)) {
                    Files.walk(path).sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
                } else {
                    Files.deleteIfExists(path)
                }
            } catch (_: Exception) {
                failed++
            }
        }
        refresh()
        if (failed > 0) {
            Messages.showErrorDialog(project, "Failed to delete $failed resource(s).", "Error")
        }
    }

    private fun showResourcePopup(e: MouseEvent, item: ResourceItem) {
        val menu = JPopupMenu()

        menu.add(JMenuItem("Install to Workspace").apply {
            addActionListener { installItem(item, InstallScope.WORKSPACE) }
        })
        menu.add(JMenuItem("Install Globally").apply {
            addActionListener { installItem(item, InstallScope.GLOBAL) }
        })
        menu.addSeparator()
        menu.add(JMenuItem("Open Resource").apply {
            addActionListener { openResource(item) }
        })
        menu.addSeparator()
        menu.add(JMenuItem("Delete from Disk").apply {
            addActionListener { deleteResource(item) }
        })

        menu.show(tree, e.x, e.y)
    }

    private fun showCollectionPopup(e: MouseEvent, data: CollectionNodeData) {
        val menu = JPopupMenu()
        menu.add(JMenuItem("Disconnect Collection").apply {
            addActionListener { disconnectCollection(data.path) }
        })
        menu.show(tree, e.x, e.y)
    }

    private fun showCollectionDisconnectPopup(e: MouseEvent, path: String) {
        val menu = JPopupMenu()
        menu.add(JMenuItem("Disconnect Collection").apply {
            addActionListener { disconnectCollection(path) }
        })
        menu.show(tree, e.x, e.y)
    }

    private fun installItem(item: ResourceItem, scope: InstallScope) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Installing ${item.name}…", false) {
            override fun run(indicator: ProgressIndicator) {
                val projectService = ProjectService.getInstance(project)
                val resourceClient = ResourceClient()
                val installService = InstallationService(resourceClient, projectService)
                val success = installService.installFromLocal(item, scope)
                ApplicationManager.getApplication().invokeLater {
                    if (success) {
                        Messages.showInfoMessage(project, "'${item.name}' installed successfully.", "Installed")
                    } else {
                        Messages.showErrorDialog(project, "Failed to install '${item.name}'.", "Install Failed")
                    }
                }
            }
        })
    }

    private fun openResource(item: ResourceItem) {
        val path = Paths.get(item.localCollectionPath ?: item.path)
        if (Files.isDirectory(path)) {
            val skillMd = path.resolve("SKILL.md")
            if (Files.exists(skillMd)) {
                val vf = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(skillMd) ?: return
                FileEditorManager.getInstance(project).openFile(vf, true)
            } else {
                try { Desktop.getDesktop().open(path.toFile()) } catch (_: Exception) {}
            }
        } else {
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path) ?: return
            FileEditorManager.getInstance(project).openFile(vf, true)
        }
    }

    private fun deleteResource(item: ResourceItem) {
        val result = Messages.showOkCancelDialog(
            project,
            "Delete '${item.name}' from disk? This cannot be undone.",
            "Delete Resource",
            "Delete",
            "Cancel",
            Messages.getWarningIcon()
        )
        if (result != Messages.OK) return

        try {
            val path = Paths.get(item.localCollectionPath ?: item.path)
            if (Files.isDirectory(path)) {
                Files.walk(path).sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
            } else {
                Files.deleteIfExists(path)
            }
            refresh()
        } catch (e: Exception) {
            Messages.showErrorDialog(project, "Failed to delete: ${e.message}", "Error")
        }
    }

    private fun disconnectCollection(path: String) {
        val result = Messages.showOkCancelDialog(
            project,
            "Disconnect this collection? Files on disk will not be affected.",
            "Disconnect Collection",
            "Disconnect",
            "Cancel",
            Messages.getQuestionIcon()
        )
        if (result != Messages.OK) return

        SettingsService.getInstance().removeLocalCollection(path)
        refresh()
    }

    private fun resolveCollectionPath(path: String): java.nio.file.Path {
        val expanded = path.replace("~", System.getProperty("user.home"))
        val p = Paths.get(expanded)
        return if (p.isAbsolute) p else {
            val basePath = project.basePath ?: System.getProperty("user.dir")
            Paths.get(basePath, expanded)
        }
    }

    private fun parseTags(tagsValue: String?): List<String> {
        if (tagsValue.isNullOrBlank()) return emptyList()
        val cleaned = tagsValue.removePrefix("[").removeSuffix("]")
        return cleaned.split(",").map { it.trim().removeSurrounding("\"") }.filter { it.isNotEmpty() }
    }

    // ---- Node data classes ----

    data class LocalResourceNodeData(val item: ResourceItem, val isInstalled: Boolean) {
        override fun toString(): String {
            val mark = if (isInstalled) " ✓" else ""
            return "${item.name}$mark"
        }
    }

    data class LocalCategoryNodeData(val category: ResourceCategory, val count: Int) {
        override fun toString(): String = "${category.label} ($count)"
    }

    data class CollectionNodeData(val label: String, val path: String) {
        override fun toString(): String = label
    }

    data class MissingCollectionNodeData(val label: String, val path: String) {
        override fun toString(): String = "⚠ $label (missing)"
    }

    // ---- Cell renderer ----

    private class LocalCellRenderer : ColoredTreeCellRenderer() {
        override fun customizeCellRenderer(
            tree: JTree, value: Any?, selected: Boolean,
            expanded: Boolean, leaf: Boolean, row: Int, hasFocus: Boolean
        ) {
            val node = value as? DefaultMutableTreeNode ?: return
            when (val data = node.userObject) {
                is MissingCollectionNodeData -> {
                    append("⚠ ${data.label}", SimpleTextAttributes.ERROR_ATTRIBUTES)
                    append(" (missing)", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                    toolTipText = "Directory not found: ${data.path}"
                    icon = null
                }
                is CollectionNodeData -> {
                    append(data.label, SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES)
                    toolTipText = data.path
                    icon = null
                }
                is LocalResourceNodeData -> {
                    append(data.item.name, SimpleTextAttributes.REGULAR_ATTRIBUTES)
                    if (data.isInstalled) append(" ✓", SimpleTextAttributes.GRAY_ATTRIBUTES)
                    if (!data.item.description.isNullOrBlank()) {
                        append("  ${data.item.description}", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                    }
                    toolTipText = data.item.description ?: data.item.path
                    icon = null
                }
                is LocalCategoryNodeData -> {
                    append(data.category.label, SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES)
                    append(" (${data.count})", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                    icon = null
                }
            }
        }
    }
}
