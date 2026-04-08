package com.adlaws.aiskillsmanager.ui

import com.adlaws.aiskillsmanager.model.*
import com.adlaws.aiskillsmanager.services.ContributionService
import com.adlaws.aiskillsmanager.services.InstallationService
import com.adlaws.aiskillsmanager.services.ProjectService
import com.adlaws.aiskillsmanager.services.ResourceClient
import com.adlaws.aiskillsmanager.services.SettingsService
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.*
import java.net.URI
import java.nio.file.Files
import java.nio.file.Paths
import javax.swing.*

/**
 * Embeddable resource detail panel — renders resource metadata and content as themed HTML.
 *
 * Used as the bottom half of a split pane in Marketplace, Installed, and Local Collections tabs.
 * Shows resource name, description, badges, source link, content, and install buttons.
 */
class ResourceDetailPanel(private val project: Project) : JPanel(BorderLayout()) {

    companion object {
        private val LOG = Logger.getInstance(ResourceDetailPanel::class.java)
    }

    private val editorPane = JEditorPane("text/html", "").apply {
        isEditable = false
        border = JBUI.Borders.empty()
        addHyperlinkListener { e ->
            if (e.eventType == javax.swing.event.HyperlinkEvent.EventType.ACTIVATED) {
                try { Desktop.getDesktop().browse(URI(e.url.toString())) } catch (_: Exception) {}
            }
        }
    }

    private val buttonPanel = JPanel(FlowLayout(FlowLayout.LEFT, 6, 4))
    private val emptyLabel = JLabel("Select a resource to view details", SwingConstants.CENTER).apply {
        foreground = UIUtil.getInactiveTextColor()
        font = UIUtil.getLabelFont().deriveFont(Font.ITALIC, 12f)
    }

    private val contentCard = JPanel(CardLayout())
    private val CARD_EMPTY = "empty"
    private val CARD_DETAIL = "detail"

    private var currentItem: ResourceItem? = null
    private var resourceClient: ResourceClient? = null

    init {
        val detailPanel = JPanel(BorderLayout())
        detailPanel.add(JBScrollPane(editorPane), BorderLayout.CENTER)
        detailPanel.add(buttonPanel, BorderLayout.SOUTH)

        val emptyPanel = JPanel(GridBagLayout())
        emptyPanel.add(emptyLabel)

        contentCard.add(emptyPanel, CARD_EMPTY)
        contentCard.add(detailPanel, CARD_DETAIL)

        add(contentCard, BorderLayout.CENTER)
        showEmpty()
    }

    fun setResourceClient(client: ResourceClient) {
        this.resourceClient = client
    }

    /**
     * Show the empty placeholder state.
     */
    fun showEmpty() {
        currentItem = null
        (contentCard.layout as CardLayout).show(contentCard, CARD_EMPTY)
    }

    /**
     * Show details for a marketplace or local resource item.
     * If content is missing, fetches it in the background.
     */
    fun showItem(item: ResourceItem) {
        currentItem = item

        if (item.fullContent != null || item.content != null) {
            renderItem(item)
            return
        }

        // Need to fetch content
        val client = resourceClient
        if (client != null && item.repoOwner.isNotBlank()) {
            renderItem(item) // Show what we have immediately (metadata)
            // Fetch content in background (lightweight thread, no progress bar overhead)
            ApplicationManager.getApplication().executeOnPooledThread {
                try {
                    val content = if (item.isFolder) {
                        client.fetchRawContent(item.repoOwner, item.repoName, item.repoBranch, "${item.path}/SKILL.md")
                    } else {
                        client.fetchRawContent(item.repoOwner, item.repoName, item.repoBranch, item.path)
                    }
                    if (content != null) {
                        val enriched = item.copy(content = content, fullContent = content)
                        ApplicationManager.getApplication().invokeLater {
                            if (currentItem?.name == item.name) {
                                renderItem(enriched)
                            }
                        }
                    }
                } catch (_: Exception) {
                    // Content fetch failed — detail panel already shows metadata
                }
            }
        } else {
            renderItem(item)
        }
    }

    /**
     * Show details for an installed resource (reads content from disk).
     */
    fun showInstalledResource(resource: InstalledResource) {
        // Read file content on a pooled thread to avoid blocking EDT
        val placeholderItem = ResourceItem(
            name = resource.name,
            category = resource.category,
            path = resource.path,
            isFolder = java.nio.file.Files.isDirectory(java.nio.file.Paths.get(resource.path))
        )
        currentItem = placeholderItem
        renderItem(placeholderItem, installedResource = resource)

        ApplicationManager.getApplication().executeOnPooledThread {
            val path = java.nio.file.Paths.get(resource.path)
            val content = try {
                if (java.nio.file.Files.isDirectory(path)) {
                    val skillMd = path.resolve("SKILL.md")
                    if (java.nio.file.Files.exists(skillMd)) java.nio.file.Files.readString(skillMd) else null
                } else {
                    java.nio.file.Files.readString(path)
                }
            } catch (_: Exception) { null }

            if (content != null) {
                val item = ResourceItem(
                    name = resource.name,
                    category = resource.category,
                    path = resource.path,
                    content = content,
                    fullContent = content,
                    isFolder = java.nio.file.Files.isDirectory(path)
                )
                ApplicationManager.getApplication().invokeLater {
                    if (currentItem?.name == resource.name) {
                        renderItem(item, installedResource = resource)
                    }
                }
            }
        }
    }

    private fun renderItem(item: ResourceItem, installedResource: InstalledResource? = null) {
        val html = buildHtml(item)
        editorPane.text = html
        editorPane.caretPosition = 0

        // Build action buttons
        buttonPanel.removeAll()

        if (installedResource == null && item.repoOwner.isNotBlank()) {
            // Marketplace item — show install buttons
            val installBtn = JButton("Install to Workspace").apply {
                addActionListener { installMarketplaceItem(item, InstallScope.WORKSPACE) }
            }
            val installGlobalBtn = JButton("Install Globally").apply {
                addActionListener { installMarketplaceItem(item, InstallScope.GLOBAL) }
            }
            buttonPanel.add(installBtn)
            buttonPanel.add(installGlobalBtn)
        } else if (installedResource == null && item.localCollectionPath != null) {
            // Local collection item — show install buttons
            val installBtn = JButton("Install to Workspace").apply {
                addActionListener { installLocalItem(item, InstallScope.WORKSPACE) }
            }
            val installGlobalBtn = JButton("Install Globally").apply {
                addActionListener { installLocalItem(item, InstallScope.GLOBAL) }
            }
            buttonPanel.add(installBtn)
            buttonPanel.add(installGlobalBtn)
        }

        // Source link as a clickable button
        if (item.repoOwner.isNotBlank() && item.repoName.isNotBlank()) {
            val url = "https://github.com/${item.repoOwner}/${item.repoName}/tree/${item.repoBranch}/${item.path}"
            val sourceBtn = JButton("View on GitHub").apply {
                addActionListener {
                    try { Desktop.getDesktop().browse(URI(url)) } catch (_: Exception) {}
                }
            }
            buttonPanel.add(sourceBtn)
        }

        // Propose Changes and Revert buttons — only shown for modified resources with source repo metadata
        if (installedResource != null) {
            val contributionService = ContributionService.getInstance(project)
            val projectService = ProjectService.getInstance(project)
            val meta = projectService.readAllInstallMetadata()[installedResource.name]
            val installSvc = InstallationService(ResourceClient().apply { syncSettings() }, projectService)
            val isModified = installSvc.isResourceModified(installedResource)

            if (isModified && contributionService.canProposeChanges(installedResource, meta)) {
                val proposeBtn = JButton("Propose Changes…").apply {
                    toolTipText = "Push your local changes to the source repository as a pull request"
                    addActionListener {
                        proposeChangesForResource(installedResource)
                    }
                }
                buttonPanel.add(proposeBtn)
            }

            // Revert to Repository button
            val revertMeta = meta ?: projectService.readAllInstallMetadata()[installedResource.name]
            if (isModified && revertMeta != null && revertMeta.sourceRepo.isNotBlank()) {
                val revertBtn = JButton("Revert to Repository Version").apply {
                    toolTipText = "Discard local changes and revert to the version in the source repository"
                    addActionListener {
                        revertToRepositoryForResource(installedResource, revertMeta)
                    }
                }
                buttonPanel.add(revertBtn)
            }
        }

        buttonPanel.revalidate()
        buttonPanel.repaint()

        (contentCard.layout as CardLayout).show(contentCard, CARD_DETAIL)
        contentCard.revalidate()
        contentCard.repaint()
    }

    private fun installMarketplaceItem(item: ResourceItem, scope: InstallScope) {
        val client = resourceClient ?: return
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Installing ${item.name}…", false) {
            override fun run(indicator: ProgressIndicator) {
                val projectService = ProjectService.getInstance(project)
                val installService = InstallationService(client, projectService)
                val success = installService.installResource(item, scope)
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

    private fun installLocalItem(item: ResourceItem, scope: InstallScope) {
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

    /**
     * Propose changes for an installed resource.
     * Runs the full branch + commit + PR workflow in a background task.
     */
    private fun proposeChangesForResource(resource: InstalledResource) {
        val contributionService = ContributionService.getInstance(project)
        val projectService = ProjectService.getInstance(project)
        val metadata = projectService.readAllInstallMetadata()[resource.name]

        val token = contributionService.getWriteToken()
        if (token == null) {
            Messages.showErrorDialog(
                project,
                "A GitHub personal access token with 'repo' scope is required.\nConfigure it in Settings → AI Skills Manager → GitHub Token.",
                "Authentication Required"
            )
            return
        }

        val sourceRepoStr = metadata?.sourceRepo ?: resource.sourceRepo ?: return
        val parsedRepo = contributionService.parseSourceRepo(sourceRepoStr) ?: run {
            Messages.showErrorDialog(project, "Invalid source repository format.", "Error")
            return
        }
        val owner = parsedRepo.first
        val repo = parsedRepo.second

        if (!contributionService.checkPushAccess(token, owner, repo)) {
            Messages.showErrorDialog(
                project,
                "You don't have write access to $owner/$repo with the current GitHub token.",
                "No Write Access"
            )
            return
        }

        val defaultBranch = contributionService.generateBranchName(resource)
        val branchName = Messages.showInputDialog(project, "Branch name:", "Propose Changes", Messages.getQuestionIcon(), defaultBranch, null)
        if (branchName.isNullOrBlank()) return

        val prTitle = Messages.showInputDialog(project, "Pull request title:", "Propose Changes", Messages.getQuestionIcon(), "Update ${resource.name}", null)
        if (prTitle.isNullOrBlank()) return

        val prDescription = Messages.showInputDialog(project, "Description (optional):", "Propose Changes", Messages.getQuestionIcon(), "", null) ?: ""

        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Proposing changes…", false) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    // Look up the current configured branch (metadata may be stale)
                    val configuredRepo = SettingsService.getInstance().getRepositories()
                        .find { it.owner == owner && it.repo == repo }
                    val sourceBranch = configuredRepo?.branch ?: "main"
                    val baseSha = contributionService.getBranchHeadSha(token, owner, repo, sourceBranch)
                        ?: throw RuntimeException("Could not get HEAD SHA")
                    if (!contributionService.createBranch(token, owner, repo, branchName, baseSha))
                        throw RuntimeException("Could not create branch '$branchName'")

                    val localFiles = contributionService.readLocalFiles(resource)
                    if (localFiles.isEmpty()) throw RuntimeException("No local files found")

                    val filePath = resource.category.id + "/" + resource.name
                    val isSkill = resource.category == ResourceCategory.SKILLS

                    if (isSkill && localFiles.size > 1) {
                        if (!contributionService.commitMultipleFiles(token, owner, repo, branchName, baseSha, filePath, localFiles, "Update ${resource.name}"))
                            throw RuntimeException("Failed to commit files")
                    } else {
                        for ((rel, content) in localFiles) {
                            val fp = if (isSkill) "$filePath/$rel" else filePath
                            if (!contributionService.commitSingleFile(token, owner, repo, branchName, fp, content, "Update ${resource.name}"))
                                throw RuntimeException("Failed to commit $rel")
                        }
                    }

                    val body = "$prDescription\n\n---\n_Proposed via AI Skills Manager_"
                    val pr = contributionService.createPullRequest(token, owner, repo, branchName, sourceBranch, prTitle, body)

                    ApplicationManager.getApplication().invokeLater {
                        if (pr != null) {
                            val open = Messages.showOkCancelDialog(project, "PR #${pr.first} created!", "Success", "Open in Browser", "Close", Messages.getInformationIcon())
                            if (open == Messages.OK) {
                                try { java.awt.Desktop.getDesktop().browse(java.net.URI(pr.second)) } catch (_: Exception) {}
                            }
                        } else {
                            Messages.showErrorDialog(project, "Failed to create pull request.", "Error")
                        }
                    }
                } catch (e: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(project, "Failed: ${e.message}", "Error")
                    }
                }
            }
        })
    }

    /**
     * Revert an installed resource to the repository version.
     * Shows a diff first, then confirms before reverting.
     */
    private fun revertToRepositoryForResource(resource: InstalledResource, metadata: InstallMetadata? = null) {
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
            0 -> { // Direct revert
                ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Reverting '${resource.name}'…", false) {
                    override fun run(indicator: ProgressIndicator) {
                        val resourceClient = ResourceClient().apply { syncSettings() }
                        val installService = InstallationService(resourceClient, ProjectService.getInstance(project))
                        val success = installService.revertResource(resource, metadata)
                        ApplicationManager.getApplication().invokeLater {
                            if (success) {
                                Messages.showInfoMessage(project, "Reverted '${resource.name}' to the repository version.", "Revert Complete")
                            } else {
                                Messages.showErrorDialog(project, "Failed to revert '${resource.name}'.", "Error")
                            }
                        }
                    }
                })
            }
            1 -> { // Compare first
                ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Fetching upstream content…", true) {
                    override fun run(indicator: ProgressIndicator) {
                        val resourceClient = ResourceClient().apply { syncSettings() }
                        val installService = InstallationService(resourceClient, ProjectService.getInstance(project))
                        val upstreamContent = installService.fetchUpstreamContent(resource, metadata)

                        if (upstreamContent == null) {
                            ApplicationManager.getApplication().invokeLater {
                                Messages.showErrorDialog(project, "Could not fetch upstream content.", "Error")
                            }
                            return
                        }

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
                            val factory = DiffContentFactory.getInstance()
                            val diffRequest = SimpleDiffRequest(
                                "Revert: ${resource.name}",
                                factory.create(localContent),
                                factory.create(upstreamContent),
                                "Local",
                                "Repository"
                            )
                            DiffManager.getInstance().showDiff(project, diffRequest)

                            val confirm = Messages.showOkCancelDialog(
                                project,
                                "Revert '${resource.name}' to the repository version?",
                                "Confirm Revert",
                                "Revert",
                                "Cancel",
                                Messages.getWarningIcon()
                            )
                            if (confirm == Messages.OK) {
                                ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Reverting '${resource.name}'…", false) {
                                    override fun run(indicator: ProgressIndicator) {
                                        val rc = ResourceClient().apply { syncSettings() }
                                        val is2 = InstallationService(rc, ProjectService.getInstance(project))
                                        val success = is2.revertResource(resource, metadata)
                                        ApplicationManager.getApplication().invokeLater {
                                            if (success) {
                                                Messages.showInfoMessage(project, "Reverted '${resource.name}' to the repository version.", "Revert Complete")
                                            } else {
                                                Messages.showErrorDialog(project, "Failed to revert '${resource.name}'.", "Error")
                                            }
                                        }
                                    }
                                })
                            }
                        }
                    }
                })
            }
            // else Cancel
        }
    }

    // ---- HTML rendering ----

    private fun colorToHex(c: Color): String = String.format("#%02x%02x%02x", c.red, c.green, c.blue)

    private fun buildHtml(item: ResourceItem): String {
        val bg = UIUtil.getPanelBackground()
        val fg = UIUtil.getLabelForeground()
        val mutedFg = UIUtil.getInactiveTextColor()
        val codeBg = if (UIUtil.isUnderDarcula()) "#2b2b2b" else "#f5f5f5"
        val sourceBg = if (UIUtil.isUnderDarcula()) "#313335" else "#f5f5f5"
        val linkColor = if (UIUtil.isUnderDarcula()) "#589df6" else "#2470b3"

        val sb = StringBuilder()
        sb.append("""
            <html>
            <head>
            <style>
                body { font-family: ${UIUtil.getLabelFont().family}, sans-serif;
                       font-size: ${UIUtil.getLabelFont().size}pt;
                       margin: 12px;
                       background-color: ${colorToHex(bg)}; color: ${colorToHex(fg)}; }
                h1 { margin-top: 0; margin-bottom: 4px; }
                h2, h3 { color: ${colorToHex(fg)}; }
                a { color: $linkColor; }
                .meta { color: ${colorToHex(mutedFg)}; margin-bottom: 12px; }
                .source { background-color: $sourceBg; padding: 6px;
                          margin-bottom: 12px; }
                pre { background-color: $codeBg; padding: 10px; }
                code { background-color: $codeBg; padding: 2px; }
                hr { margin-top: 8px; margin-bottom: 8px; }
                li { margin-bottom: 2px; }
                p { margin-top: 4px; margin-bottom: 4px; }
            </style>
            </head>
            <body>
        """.trimIndent())

        val categoryEmoji = when (item.category) {
            ResourceCategory.CHATMODES -> "\uD83D\uDCAC"
            ResourceCategory.INSTRUCTIONS -> "\uD83D\uDCD6"
            ResourceCategory.PROMPTS -> "\uD83D\uDCA1"
            ResourceCategory.AGENTS -> "\uD83E\uDD16"
            ResourceCategory.SKILLS -> "\uD83D\uDCE6"
        }
        sb.append("<h1>$categoryEmoji ${escapeHtml(item.name)}</h1>")

        if (!item.description.isNullOrBlank()) {
            sb.append("<p>${escapeHtml(item.description)}</p>")
        }

        // Badges
        sb.append("<p class='meta'>")
        sb.append("<b>${item.category.label}</b>")
        if (!item.license.isNullOrBlank()) {
            sb.append(" &middot; ${escapeHtml(item.license)}")
        }
        if (!item.compatibility.isNullOrBlank()) {
            sb.append(" &middot; ${escapeHtml(item.compatibility)}")
        }
        if (item.tags.isNotEmpty()) {
            for (tag in item.tags) {
                sb.append(" &middot; ${escapeHtml(tag)}")
            }
        }
        sb.append("</p>")

        // Source link
        if (item.repoOwner.isNotBlank() && item.repoName.isNotBlank()) {
            val url = "https://github.com/${item.repoOwner}/${item.repoName}/tree/${item.repoBranch}/${item.path}"
            sb.append("<div class='source'>Source: <a href='$url'>${item.repoOwner}/${item.repoName}</a></div>")
        } else if (item.localCollectionPath != null) {
            sb.append("<div class='source'>Local: ${escapeHtml(item.localCollectionPath)}</div>")
        }

        // Content
        val content = item.fullContent ?: item.content
        if (!content.isNullOrBlank()) {
            val displayContent = stripFrontmatter(content)
            sb.append("<hr>")
            sb.append(simpleMarkdownToHtml(displayContent))
        } else {
            sb.append("<hr><p><i>Content loading…</i></p>")
        }

        sb.append("</body></html>")
        return sb.toString()
    }

    private fun stripFrontmatter(content: String): String {
        val lines = content.lines()
        if (lines.isEmpty() || lines[0].trim() != "---") return content
        for (i in 1 until lines.size) {
            if (lines[i].trim() == "---") {
                return lines.subList(i + 1, lines.size).joinToString("\n").trimStart()
            }
        }
        return content
    }

    private fun simpleMarkdownToHtml(md: String): String {
        val sb = StringBuilder()
        var inCodeBlock = false

        for (line in md.lines()) {
            if (line.trimStart().startsWith("```")) {
                if (inCodeBlock) {
                    sb.append("</pre>")
                    inCodeBlock = false
                } else {
                    sb.append("<pre>")
                    inCodeBlock = true
                }
                continue
            }

            if (inCodeBlock) {
                sb.append(escapeHtml(line)).append("\n")
                continue
            }

            val trimmed = line.trim()
            when {
                trimmed.startsWith("### ") -> sb.append("<h3>${escapeHtml(trimmed.removePrefix("### "))}</h3>")
                trimmed.startsWith("## ") -> sb.append("<h2>${escapeHtml(trimmed.removePrefix("## "))}</h2>")
                trimmed.startsWith("# ") -> sb.append("<h2>${escapeHtml(trimmed.removePrefix("# "))}</h2>")
                trimmed.startsWith("- ") || trimmed.startsWith("* ") ->
                    sb.append("<li>${escapeHtml(trimmed.removePrefix("- ").removePrefix("* "))}</li>")
                trimmed.isBlank() -> sb.append("<br>")
                else -> sb.append("<p>${inlineMarkdown(escapeHtml(trimmed))}</p>")
            }
        }

        if (inCodeBlock) sb.append("</pre>")
        return sb.toString()
    }

    private fun inlineMarkdown(text: String): String {
        var result = text.replace(Regex("\\*\\*(.+?)\\*\\*"), "<b>$1</b>")
        result = result.replace(Regex("`(.+?)`"), "<code>$1</code>")
        return result
    }

    private fun escapeHtml(text: String): String {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace("\"", "&quot;")
    }
}
