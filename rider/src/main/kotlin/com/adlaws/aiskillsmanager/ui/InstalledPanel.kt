package com.adlaws.aiskillsmanager.ui

import com.adlaws.aiskillsmanager.model.*
import com.adlaws.aiskillsmanager.services.*
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.requests.SimpleDiffRequest
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
 * Installed resources tree panel — Category → Installed Resource items.
 *
 * Mirrors the VS Code extension's `installedProvider.ts`:
 * - Scans both workspace and global install locations
 * - Shows scope badges (Workspace/Global)
 * - Update detection and badges
 * - Context menus: Open, Uninstall, Update, Move scope, Copy to Local, View Details
 */
class InstalledPanel(private val project: Project) : Disposable {

    private val LOG = com.intellij.openapi.diagnostic.Logger.getInstance(InstalledPanel::class.java)

    private val rootNode = DefaultMutableTreeNode("Installed")
    private val treeModel = DefaultTreeModel(rootNode)
    private val tree = Tree(treeModel)
    private val detailPanel = ResourceDetailPanel(project)

    val component: JComponent

    // Loading overlay
    private val treeCard = JPanel(CardLayout())
    private val CARD_TREE = "tree"
    private val CARD_LOADING = "loading"
    private val loadingLabel = JLabel("Scanning installed resources…", SwingConstants.CENTER).apply {
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

    private var installedResources: List<InstalledResource> = emptyList()
    private var updatableNames: Set<String> = emptySet()

    /** Listener that other panels can use to react to installed list changes */
    var onInstalledChanged: (() -> Unit)? = null

    // File watcher debounce
    private var pendingRefresh: java.util.Timer? = null
    private val refreshDebounceMs = 1000L

    init {
        tree.isRootVisible = false
        tree.showsRootHandles = true
        tree.cellRenderer = InstalledCellRenderer()
        tree.selectionModel.selectionMode = TreeSelectionModel.DISCONTIGUOUS_TREE_SELECTION

        // Mouse handler: left click → detail panel, right click → context menu, double-click → open
        tree.addMouseListener(object : MouseAdapter() {
            override fun mousePressed(e: MouseEvent) {
                if (e.isPopupTrigger) { handlePopup(e); return }
                if (SwingUtilities.isLeftMouseButton(e)) {
                    val path = tree.getPathForLocation(e.x, e.y) ?: return
                    val node = path.lastPathComponent as? DefaultMutableTreeNode ?: return
                    val data = node.userObject as? InstalledNodeData ?: return
                    if (e.clickCount == 2) {
                        openResource(data.resource)
                    } else {
                        SwingUtilities.invokeLater { detailPanel.showInstalledResource(data.resource) }
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

        val treePanel = JPanel(BorderLayout())
        treePanel.add(treeCard, BorderLayout.CENTER)

        // Split pane: tree on top, detail on bottom
        val splitPane = JSplitPane(JSplitPane.VERTICAL_SPLIT, treePanel, detailPanel)
        splitPane.resizeWeight = 0.55
        splitPane.dividerSize = 5
        splitPane.isContinuousLayout = true
        component = splitPane

        // Register VFS listener to auto-refresh when install directories change
        val connection = project.messageBus.connect(this)
        connection.subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
            override fun after(events: List<VFileEvent>) {
                val settings = SettingsService.getInstance()
                val installPaths = ResourceCategory.entries.flatMap { category ->
                    listOf(
                        settings.getInstallLocation(category, InstallScope.WORKSPACE),
                        settings.getInstallLocation(category, InstallScope.GLOBAL)
                    )
                }.map { it.replace("~", System.getProperty("user.home")) }

                val relevant = events.any { event ->
                    val path = event.path
                    installPaths.any { path.startsWith(it) }
                }
                if (relevant) {
                    debouncedRefresh()
                }
            }
        })
        // NOTE: Initial load is deferred — call loadResources() after setting onInstalledChanged
    }

    /**
     * Trigger the initial scan. Call this AFTER setting [onInstalledChanged]
     * so the callback fires correctly on the first load.
     */
    fun loadResources() {
        loadInstalled()
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

    override fun dispose() {
        pendingRefresh?.cancel()
        spinnerTimer?.stop()
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
        loadInstalled()
    }

    fun getInstalledNames(): Set<String> = installedResources.map { it.name }.toSet()

    fun getInstalledResources(): List<InstalledResource> = installedResources

    fun getUpdatableNames(): Set<String> = updatableNames

    fun getUpdatableCount(): Int = updatableNames.size

    fun setUpdatableNames(names: Set<String>) {
        updatableNames = names
        rebuildTree()
    }

    /**
     * Check for upstream updates by comparing SHAs.
     */
    fun checkForUpdates(resourceClient: ResourceClient) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Checking for Updates…", true) {
            override fun run(indicator: ProgressIndicator) {
                val projectService = ProjectService.getInstance(project)
                val allMeta = projectService.readAllInstallMetadata()
                val updatable = mutableSetOf<String>()

                for (resource in installedResources) {
                    if (indicator.isCanceled) break
                    val meta = allMeta[resource.name] ?: continue
                    if (meta.sha.isBlank() || meta.sourceRepo.isBlank()) continue

                    val parts = meta.sourceRepo.split("/")
                    if (parts.size != 2) continue

                    val upstreamSha = resourceClient.fetchResourceSha(parts[0], parts[1], "main", resource.name)
                    if (upstreamSha != null && upstreamSha != meta.sha) {
                        updatable.add(resource.name)
                    }
                }

                ApplicationManager.getApplication().invokeLater {
                    updatableNames = updatable
                    rebuildTree()
                }
            }
        })
    }

    private fun loadInstalled() {
        val projectService = ProjectService.getInstance(project)
        installedResources = projectService.scanInstalledResources()
        rebuildTree()
        onInstalledChanged?.invoke()
    }

    private fun rebuildTree() {
        rootNode.removeAllChildren()

        val byCategory = installedResources.groupBy { it.category }
        for (category in ResourceCategory.entries) {
            val items = byCategory[category] ?: continue
            val updateCount = items.count { updatableNames.contains(it.name) }
            val categoryNode = DefaultMutableTreeNode(CategoryNodeData(category, items.size, updateCount))
            for (item in items) {
                val hasUpdate = updatableNames.contains(item.name)
                categoryNode.add(DefaultMutableTreeNode(InstalledNodeData(item, hasUpdate)))
            }
            rootNode.add(categoryNode)
        }

        treeModel.reload()
        // Expand all categories
        for (i in 0 until rootNode.childCount) {
            tree.expandPath(TreePath(arrayOf(rootNode, rootNode.getChildAt(i))))
        }
    }

    private fun handlePopup(e: MouseEvent) {
        if (!e.isPopupTrigger) return
        val path = tree.getPathForLocation(e.x, e.y) ?: return

        // If the right-clicked node is not in the current selection, select only it
        if (!tree.isPathSelected(path)) {
            tree.selectionPath = path
        }

        val selectedResources = getSelectedInstalledResources()
        if (selectedResources.isEmpty()) return

        val menu = JPopupMenu()

        if (selectedResources.size > 1) {
            // Bulk actions
            val updatable = selectedResources.filter { updatableNames.contains(it.first.name) }
            if (updatable.isNotEmpty()) {
                menu.add(JMenuItem("Update ${updatable.size} Resource(s)").apply {
                    addActionListener {
                        updatable.forEach { (res, _) -> updateResource(res) }
                    }
                })
                menu.addSeparator()
            }

            menu.add(JMenuItem("Move ${selectedResources.size} to Global").apply {
                addActionListener {
                    selectedResources.filter { it.first.scope == InstallScope.WORKSPACE }
                        .forEach { (res, _) -> moveResource(res, InstallScope.GLOBAL) }
                }
            })
            menu.add(JMenuItem("Move ${selectedResources.size} to Workspace").apply {
                addActionListener {
                    selectedResources.filter { it.first.scope == InstallScope.GLOBAL }
                        .forEach { (res, _) -> moveResource(res, InstallScope.WORKSPACE) }
                }
            })

            menu.add(JMenuItem("Copy ${selectedResources.size} to Local Collection").apply {
                addActionListener {
                    bulkCopyToLocalCollection(selectedResources.map { it.first })
                }
            })

            menu.add(JMenuItem("Create Pack from ${selectedResources.size} Items").apply {
                addActionListener {
                    createPackFromSelected(selectedResources.map { it.first })
                }
            })

            // Propose Changes — only first selected modified resource with source metadata
            val installSvcBulk = InstallationService(ResourceClient().apply { syncSettings() }, ProjectService.getInstance(project))
            val firstWithSource = selectedResources.firstOrNull { (res, _) ->
                val meta = ProjectService.getInstance(project).readAllInstallMetadata()[res.name]
                ContributionService.getInstance(project).canProposeChanges(res, meta) && installSvcBulk.isResourceModified(res)
            }
            if (firstWithSource != null) {
                menu.add(JMenuItem("Propose Changes…").apply {
                    addActionListener { proposeChanges(firstWithSource.first) }
                })
            }
            // Revert to Repository — only first selected modified resource with source metadata
            val firstWithRevert = selectedResources.firstOrNull { (res, _) ->
                val meta = ProjectService.getInstance(project).readAllInstallMetadata()[res.name]
                meta != null && meta.sourceRepo.isNotBlank() && installSvcBulk.isResourceModified(res)
            }
            if (firstWithRevert != null) {
                menu.add(JMenuItem("Revert to Repository Version\u2026").apply {
                    addActionListener { revertToRepository(firstWithRevert.first) }
                })
            }
            menu.addSeparator()
            menu.add(JMenuItem("Remove ${selectedResources.size} Resources").apply {
                addActionListener { bulkUninstall(selectedResources.map { it.first }) }
            })
        } else {
            val resource = selectedResources.first().first
            val hasUpdate = selectedResources.first().second

            menu.add(JMenuItem("Open Resource").apply {
                addActionListener { openResource(resource) }
            })
            menu.addSeparator()

            if (hasUpdate) {
                menu.add(JMenuItem("Update").apply {
                    addActionListener { updateResource(resource) }
                })
                menu.addSeparator()
            }

            val moveLabel = if (resource.scope == InstallScope.WORKSPACE) "Move to Global" else "Move to Workspace"
            val moveScope = if (resource.scope == InstallScope.WORKSPACE) InstallScope.GLOBAL else InstallScope.WORKSPACE
            menu.add(JMenuItem(moveLabel).apply {
                addActionListener { moveResource(resource, moveScope) }
            })

            menu.add(JMenuItem("Copy to Local Collection").apply {
                addActionListener { copyToLocalCollection(resource) }
            })

            menu.add(JMenuItem("Create Resource Pack…").apply {
                addActionListener { createPackFromSelected(listOf(resource)) }
            })

            // Propose Changes — show only if resource is modified and has source repo metadata
            val meta = ProjectService.getInstance(project).readAllInstallMetadata()[resource.name]
            val installSvcSingle = InstallationService(ResourceClient().apply { syncSettings() }, ProjectService.getInstance(project))
            val isModified = installSvcSingle.isResourceModified(resource)
            if (isModified && ContributionService.getInstance(project).canProposeChanges(resource, meta)) {
                menu.add(JMenuItem("Propose Changes…").apply {
                    addActionListener { proposeChanges(resource) }
                })
            }
            // Revert to Repository — show only if resource is modified and has source repo metadata
            val revertMeta = meta ?: ProjectService.getInstance(project).readAllInstallMetadata()[resource.name]
            if (isModified && revertMeta != null && revertMeta.sourceRepo.isNotBlank()) {
                menu.add(JMenuItem("Revert to Repository Version\u2026").apply {
                    addActionListener { revertToRepository(resource) }
                })
            }
            menu.addSeparator()

            menu.add(JMenuItem("Remove").apply {
                addActionListener { uninstallResource(resource) }
            })
        }

        menu.show(tree, e.x, e.y)
    }

    private fun getSelectedInstalledResources(): List<Pair<InstalledResource, Boolean>> {
        val paths = tree.selectionPaths ?: return emptyList()
        return paths.mapNotNull { p ->
            val node = p.lastPathComponent as? DefaultMutableTreeNode ?: return@mapNotNull null
            val data = node.userObject as? InstalledNodeData ?: return@mapNotNull null
            Pair(data.resource, data.hasUpdate)
        }
    }

    private fun bulkUninstall(resources: List<InstalledResource>) {
        val result = Messages.showOkCancelDialog(
            project,
            "Remove ${resources.size} resource(s)?",
            "Remove Resources",
            "Remove All",
            "Cancel",
            Messages.getQuestionIcon()
        )
        if (result != Messages.OK) return

        val projectService = ProjectService.getInstance(project)
        val resourceClient = ResourceClient()
        val installService = InstallationService(resourceClient, projectService)
        var failed = 0
        for (resource in resources) {
            if (!installService.uninstallResourceSilent(resource)) failed++
        }
        refresh()
        if (failed > 0) {
            Messages.showErrorDialog(project, "Failed to remove $failed resource(s).", "Error")
        }
    }

    private fun bulkCopyToLocalCollection(resources: List<InstalledResource>) {
        val settings = SettingsService.getInstance()
        val collections = settings.getLocalCollections().filter { it.enabled }
        if (collections.isEmpty()) {
            Messages.showInfoMessage(project, "No local collections configured.", "No Collections")
            return
        }

        val labels = collections.map { it.label ?: it.path }.toTypedArray()
        val choice = Messages.showChooseDialog(
            project, "Select a local collection:", "Copy to Local Collection",
            Messages.getQuestionIcon(), labels, labels.first()
        )
        if (choice < 0) return

        val collectionPath = Paths.get(collections[choice].path.replace("~", System.getProperty("user.home")))
        val projectService = ProjectService.getInstance(project)
        val resourceClient = ResourceClient()
        val installService = InstallationService(resourceClient, projectService)
        var copied = 0
        for (resource in resources) {
            if (installService.copyToLocalCollection(resource, collectionPath)) copied++
        }
        Messages.showInfoMessage(project, "Copied $copied of ${resources.size} resource(s).", "Copied")
    }

    fun createPackFromSelected(preselected: List<InstalledResource>) {
        val packService = PackService.getInstance(project)

        if (preselected.isEmpty()) {
            Messages.showInfoMessage(project, "No resources selected.", "Create Pack")
            return
        }

        val name = Messages.showInputDialog(
            project, "Pack name:", "Create Resource Pack", Messages.getQuestionIcon()
        )
        if (name.isNullOrBlank()) return

        val description = Messages.showInputDialog(
            project, "Pack description (optional):", "Create Resource Pack", Messages.getQuestionIcon()
        ) ?: ""

        val descriptor = com.intellij.openapi.fileChooser.FileChooserDescriptorFactory.createSingleFolderDescriptor()
        val folder = com.intellij.openapi.fileChooser.FileChooser.chooseFile(descriptor, project, null) ?: return
        val outputPath = folder.toNioPath().resolve("$name.json")

        val success = packService.createPack(name, description, preselected, outputPath)
        if (success) {
            Messages.showInfoMessage(project, "Pack saved to:\n$outputPath", "Pack Created")
        } else {
            Messages.showErrorDialog(project, "Failed to create pack.", "Error")
        }
    }

    private fun proposeChanges(resource: InstalledResource) {
        val contributionService = ContributionService.getInstance(project)
        val projectService = ProjectService.getInstance(project)
        val allMeta = projectService.readAllInstallMetadata()
        val metadata = allMeta[resource.name]

        if (!contributionService.canProposeChanges(resource, metadata)) {
            Messages.showErrorDialog(
                project,
                "Cannot propose changes for '${resource.name}' — it wasn't installed from a marketplace repository.",
                "No Source Repository"
            )
            return
        }

        // Get token
        val token = contributionService.getWriteToken()
        if (token == null) {
            Messages.showErrorDialog(
                project,
                "A GitHub personal access token with 'repo' scope is required.\nConfigure it in Settings → AI Skills Manager → GitHub Token.",
                "Authentication Required"
            )
            return
        }

        // Parse source repo
        val sourceRepoStr = metadata?.sourceRepo ?: resource.sourceRepo ?: return
        val parsedRepo = contributionService.parseSourceRepo(sourceRepoStr) ?: run {
            Messages.showErrorDialog(project, "Invalid source repository format.", "Error")
            return
        }
        val owner = parsedRepo.first
        val repo = parsedRepo.second

        // Check push access
        val hasPush = contributionService.checkPushAccess(token, owner, repo)
        if (!hasPush) {
            Messages.showErrorDialog(
                project,
                "You don't have write access to $owner/$repo with the current GitHub token.\n" +
                        "Fork-based contributions may be supported in a future update.",
                "No Write Access"
            )
            return
        }

        // Branch name
        val defaultBranch = contributionService.generateBranchName(resource)
        val branchName = Messages.showInputDialog(
            project,
            "Branch name for your proposed changes:",
            "Propose Changes",
            Messages.getQuestionIcon(),
            defaultBranch,
            null
        )
        if (branchName.isNullOrBlank()) return

        // PR title
        val prTitle = Messages.showInputDialog(
            project,
            "Pull request title:",
            "Propose Changes",
            Messages.getQuestionIcon(),
            "Update ${resource.name}",
            null
        )
        if (prTitle.isNullOrBlank()) return

        // PR description (optional)
        val prDescription = Messages.showInputDialog(
            project,
            "Pull request description (optional):",
            "Propose Changes",
            Messages.getQuestionIcon(),
            "",
            null
        ) ?: ""

        // Run the push workflow in background
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Proposing changes for '${resource.name}'…", false) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    // Determine source branch from metadata — default to "main"
                    val sourceBranch = "main" // metadata doesn't store branch in Rider's simpler format

                    indicator.text = "Getting latest commit…"
                    val baseSha = contributionService.getBranchHeadSha(token, owner, repo, sourceBranch)
                        ?: throw RuntimeException("Could not get HEAD SHA for branch '$sourceBranch'")

                    indicator.text = "Creating branch…"
                    if (!contributionService.createBranch(token, owner, repo, branchName, baseSha)) {
                        throw RuntimeException("Could not create branch '$branchName'. It may already exist.")
                    }

                    indicator.text = "Reading local files…"
                    val localFiles = contributionService.readLocalFiles(resource)
                    if (localFiles.isEmpty()) {
                        throw RuntimeException("Could not read local files for '${resource.name}'.")
                    }

                    indicator.text = "Pushing changes…"
                    val isSkill = resource.category == ResourceCategory.SKILLS
                    // Determine file path in the repo from metadata
                    // The metadata stores sourceRepo as "owner/repo", we need the file path
                    // For skills, the path is typically "category/name" or just "name"
                    val filePath = resource.category.id + "/" + resource.name

                    if (isSkill && localFiles.size > 1) {
                        val success = contributionService.commitMultipleFiles(
                            token, owner, repo, branchName, baseSha,
                            filePath, localFiles, "Update ${resource.name}"
                        )
                        if (!success) throw RuntimeException("Failed to commit files.")
                    } else {
                        for ((relativePath, content) in localFiles) {
                            val fullPath = if (isSkill) "$filePath/$relativePath" else filePath
                            if (!contributionService.commitSingleFile(
                                    token, owner, repo, branchName,
                                    fullPath, content, "Update ${resource.name}"
                                )) {
                                throw RuntimeException("Failed to commit $relativePath")
                            }
                        }
                    }

                    indicator.text = "Creating pull request…"
                    val body = buildString {
                        append(prDescription)
                        append("\n\n---\n_Proposed via [AI Skills Manager](https://plugins.jetbrains.com/plugin/com.adlaws.aiskillsmanager)_")
                    }
                    val pr = contributionService.createPullRequest(
                        token, owner, repo, branchName, sourceBranch, prTitle, body
                    )

                    ApplicationManager.getApplication().invokeLater {
                        if (pr != null) {
                            val open = Messages.showOkCancelDialog(
                                project,
                                "Pull request #${pr.first} created successfully!",
                                "Changes Proposed",
                                "Open in Browser",
                                "Close",
                                Messages.getInformationIcon()
                            )
                            if (open == Messages.OK) {
                                try { Desktop.getDesktop().browse(java.net.URI(pr.second)) } catch (_: Exception) {}
                            }
                        } else {
                            Messages.showErrorDialog(project, "Failed to create pull request.", "Error")
                        }
                    }
                } catch (e: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(project, "Failed to propose changes: ${e.message}", "Error")
                    }
                }
            }
        })
    }

    private fun revertToRepository(resource: InstalledResource) {
        val projectService = ProjectService.getInstance(project)
        val allMeta = projectService.readAllInstallMetadata()
        val metadata = allMeta[resource.name]
        val sourceRepo = metadata?.sourceRepo ?: resource.sourceRepo

        if (sourceRepo.isNullOrBlank()) {
            Messages.showErrorDialog(
                project,
                "Cannot revert '${resource.name}' — no source repository information available.",
                "No Source Repository"
            )
            return
        }

        // Offer Compare / Revert / Cancel
        val choices = arrayOf("Revert", "Compare First", "Cancel")
        val choice = Messages.showDialog(
            project,
            "Revert '${resource.name}' to the version in the source repository?\nThis will discard all local changes.",
            "Revert to Repository Version",
            choices,
            1, // Default to "Compare First"
            Messages.getWarningIcon()
        )

        when (choice) {
            0 -> performRevert(resource, metadata)
            1 -> showDiffThenRevert(resource, metadata)
            // 2 or -1 = Cancel
        }
    }

    private fun performRevert(resource: InstalledResource, metadata: InstallMetadata? = null) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Reverting '${resource.name}'…", false) {
            override fun run(indicator: ProgressIndicator) {
                val resourceClient = ResourceClient().apply { syncSettings() }
                val installService = InstallationService(resourceClient, ProjectService.getInstance(project))
                val success = installService.revertResource(resource, metadata)
                ApplicationManager.getApplication().invokeLater {
                    if (success) {
                        Messages.showInfoMessage(
                            project,
                            "Reverted '${resource.name}' to the repository version.",
                            "Revert Complete"
                        )
                        refresh()
                    } else {
                        Messages.showErrorDialog(project, "Failed to revert '${resource.name}'.", "Error")
                    }
                }
            }
        })
    }

    private fun showDiffThenRevert(resource: InstalledResource, metadata: InstallMetadata? = null) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Fetching upstream content…", true) {
            override fun run(indicator: ProgressIndicator) {
                val resourceClient = ResourceClient().apply { syncSettings() }
                val installService = InstallationService(resourceClient, ProjectService.getInstance(project))
                val upstreamContent = installService.fetchUpstreamContent(resource, metadata)

                if (upstreamContent == null) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(project, "Could not fetch upstream content for '${resource.name}'.", "Error")
                    }
                    return
                }

                // Read local content
                val localPath = Paths.get(resource.path)
                val localContent = try {
                    if (Files.isDirectory(localPath)) {
                        val skillMd = localPath.resolve("SKILL.md")
                        if (Files.exists(skillMd)) Files.readString(skillMd) else "(no SKILL.md)"
                    } else {
                        Files.readString(localPath)
                    }
                } catch (_: Exception) { "(unable to read local file)" }

                ApplicationManager.getApplication().invokeLater {
                    // Show diff
                    val factory = DiffContentFactory.getInstance()
                    val localDiffContent = factory.create(localContent)
                    val upstreamDiffContent = factory.create(upstreamContent)
                    val diffRequest = SimpleDiffRequest(
                        "Revert: ${resource.name}",
                        localDiffContent,
                        upstreamDiffContent,
                        "Local",
                        "Repository"
                    )
                    DiffManager.getInstance().showDiff(project, diffRequest)

                    // Ask after viewing diff
                    val confirm = Messages.showOkCancelDialog(
                        project,
                        "Revert '${resource.name}' to the repository version?",
                        "Confirm Revert",
                        "Revert",
                        "Cancel",
                        Messages.getWarningIcon()
                    )
                    if (confirm == Messages.OK) {
                        performRevert(resource, metadata)
                    }
                }
            }
        })
    }

    private fun openResource(resource: InstalledResource) {
        val path = Paths.get(resource.path)
        if (Files.isDirectory(path)) {
            // For skills, open SKILL.md
            val skillMd = path.resolve("SKILL.md")
            if (Files.exists(skillMd)) {
                openFileInEditor(skillMd)
            } else {
                // Reveal in file manager
                try { Desktop.getDesktop().open(path.toFile()) } catch (_: Exception) { }
            }
        } else {
            openFileInEditor(path)
        }
    }

    private fun openFileInEditor(path: java.nio.file.Path) {
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path) ?: return
        FileEditorManager.getInstance(project).openFile(vf, true)
    }

    private fun uninstallResource(resource: InstalledResource) {
        val result = Messages.showOkCancelDialog(
            project,
            "Remove '${resource.name}'?",
            "Remove Resource",
            "Remove",
            "Cancel",
            Messages.getQuestionIcon()
        )
        if (result != Messages.OK) return

        val projectService = ProjectService.getInstance(project)
        val resourceClient = ResourceClient()
        val installService = InstallationService(resourceClient, projectService)
        val success = installService.uninstallResource(resource)
        if (success) {
            refresh()
        } else {
            Messages.showErrorDialog(project, "Failed to remove '${resource.name}'.", "Error")
        }
    }

    private fun updateResource(resource: InstalledResource) {
        // Offer Compare / Overwrite / Cancel
        val choices = arrayOf("Overwrite", "Compare", "Cancel")
        val choice = Messages.showDialog(
            project,
            "Update '${resource.name}' from upstream?",
            "Update Resource",
            choices,
            0,
            Messages.getQuestionIcon()
        )

        when (choice) {
            0 -> performUpdate(resource)
            1 -> showDiffThenUpdate(resource)
            // 2 or -1 = Cancel
        }
    }

    private fun performUpdate(resource: InstalledResource) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Updating ${resource.name}…", false) {
            override fun run(indicator: ProgressIndicator) {
                val projectService = ProjectService.getInstance(project)
                val resourceClient = ResourceClient().apply { syncSettings() }
                val installService = InstallationService(resourceClient, projectService)
                val success = installService.updateResource(resource)
                ApplicationManager.getApplication().invokeLater {
                    if (success) {
                        refresh()
                    } else {
                        Messages.showErrorDialog(project, "Failed to update '${resource.name}'.", "Error")
                    }
                }
            }
        })
    }

    private fun showDiffThenUpdate(resource: InstalledResource) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Fetching upstream content…", true) {
            override fun run(indicator: ProgressIndicator) {
                val resourceClient = ResourceClient().apply { syncSettings() }
                val projectService = ProjectService.getInstance(project)
                val allMeta = projectService.readAllInstallMetadata()
                val meta = allMeta[resource.name]
                if (meta == null || meta.sourceRepo.isBlank()) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(project, "No source metadata for '${resource.name}'.", "Error")
                    }
                    return
                }

                val parts = meta.sourceRepo.split("/")
                if (parts.size != 2) return

                // Fetch upstream content
                val localPath = Paths.get(resource.path)
                val localContent = try {
                    if (Files.isDirectory(localPath)) {
                        val skillMd = localPath.resolve("SKILL.md")
                        if (Files.exists(skillMd)) Files.readString(skillMd) else "(no SKILL.md)"
                    } else {
                        Files.readString(localPath)
                    }
                } catch (_: Exception) { "(could not read local file)" }

                val upstreamPath = if (Files.isDirectory(localPath)) {
                    "${resource.name}/SKILL.md"
                } else {
                    resource.name
                }

                // We need to figure out the full path in the repo. Use metadata to guess
                val upstreamContent = resourceClient.fetchRawContent(
                    parts[0], parts[1], "main", upstreamPath
                ) ?: run {
                    // Try category-prefixed path
                    resourceClient.fetchRawContent(
                        parts[0], parts[1], "main", "${resource.category.id}/$upstreamPath"
                    )
                }

                ApplicationManager.getApplication().invokeLater {
                    if (upstreamContent == null) {
                        Messages.showErrorDialog(project, "Could not fetch upstream content.", "Error")
                        return@invokeLater
                    }

                    val contentFactory = DiffContentFactory.getInstance()
                    val localDiffContent = contentFactory.create(localContent)
                    val upstreamDiffContent = contentFactory.create(upstreamContent)
                    val request = SimpleDiffRequest(
                        "Update ${resource.name}",
                        localDiffContent,
                        upstreamDiffContent,
                        "Current (Local)",
                        "Incoming (Upstream)"
                    )
                    DiffManager.getInstance().showDiff(project, request)
                }
            }
        })
    }

    private fun moveResource(resource: InstalledResource, targetScope: InstallScope) {
        val projectService = ProjectService.getInstance(project)
        val resourceClient = ResourceClient()
        val installService = InstallationService(resourceClient, projectService)
        val success = installService.moveResource(resource, targetScope)
        if (success) {
            refresh()
        } else {
            Messages.showErrorDialog(project, "Failed to move '${resource.name}'.", "Error")
        }
    }

    private fun copyToLocalCollection(resource: InstalledResource) {
        val settings = SettingsService.getInstance()
        val collections = settings.getLocalCollections().filter { it.enabled }
        if (collections.isEmpty()) {
            Messages.showInfoMessage(project, "No local collections configured.", "No Collections")
            return
        }

        val labels = collections.map { it.label ?: it.path }.toTypedArray()
        val choice = Messages.showChooseDialog(
            project,
            "Select a local collection to copy to:",
            "Copy to Local Collection",
            Messages.getQuestionIcon(),
            labels,
            labels.first()
        )
        if (choice < 0) return

        val collectionPath = Paths.get(collections[choice].path.replace("~", System.getProperty("user.home")))
        val projectService = ProjectService.getInstance(project)
        val resourceClient = ResourceClient()
        val installService = InstallationService(resourceClient, projectService)
        val success = installService.copyToLocalCollection(resource, collectionPath)
        if (success) {
            Messages.showInfoMessage(project, "Copied '${resource.name}' to collection.", "Copied")
        } else {
            Messages.showErrorDialog(project, "Failed to copy '${resource.name}'.", "Error")
        }
    }

    // ---- Node data ----

    data class InstalledNodeData(val resource: InstalledResource, val hasUpdate: Boolean) {
        override fun toString(): String {
            val scope = if (resource.scope == InstallScope.GLOBAL) "Global" else "Workspace"
            val update = if (hasUpdate) " ↑" else ""
            return "${resource.name} [$scope]$update"
        }
    }

    data class CategoryNodeData(val category: ResourceCategory, val count: Int, val updateCount: Int) {
        override fun toString(): String {
            val update = if (updateCount > 0) " — $updateCount update(s)" else ""
            return "${category.label} ($count)$update"
        }
    }

    // ---- Cell renderer ----

    private class InstalledCellRenderer : ColoredTreeCellRenderer() {
        override fun customizeCellRenderer(
            tree: JTree, value: Any?, selected: Boolean,
            expanded: Boolean, leaf: Boolean, row: Int, hasFocus: Boolean
        ) {
            val node = value as? DefaultMutableTreeNode ?: return
            when (val data = node.userObject) {
                is InstalledNodeData -> {
                    val r = data.resource
                    val scope = if (r.scope == InstallScope.GLOBAL) "🌐" else "📁"
                    append("$scope ${r.name}", SimpleTextAttributes.REGULAR_ATTRIBUTES)
                    if (data.hasUpdate) append(" ⬆", SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, java.awt.Color(0x58, 0x9d, 0xf6)))
                    toolTipText = "${r.path} [${if (r.scope == InstallScope.GLOBAL) "Global" else "Workspace"}]"
                    icon = null
                }
                is CategoryNodeData -> {
                    val update = if (data.updateCount > 0) " — ${data.updateCount} update(s)" else ""
                    append("${data.category.label}", SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES)
                    append(" (${data.count})", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                    if (update.isNotEmpty()) append(update, SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, java.awt.Color(0x58, 0x9d, 0xf6)))
                    icon = null
                }
            }
        }
    }
}
