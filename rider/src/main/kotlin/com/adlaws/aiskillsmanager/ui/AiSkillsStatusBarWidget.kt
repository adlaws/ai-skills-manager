package com.adlaws.aiskillsmanager.ui

import com.adlaws.aiskillsmanager.model.*
import com.adlaws.aiskillsmanager.services.*
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.util.Consumer
import java.awt.event.MouseEvent
import java.nio.file.Paths
import javax.swing.JMenuItem
import javax.swing.JPopupMenu

/**
 * Status bar widget showing installed resource count and update count.
 *
 * Mirrors the VS Code extension's status bar item:
 * - Shows "AI Skills: N ↑M" (N installed, M updates)
 * - Click opens a popup menu with common actions
 */
class AiSkillsStatusBarWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String = "AiSkillsManager.StatusBar"
    override fun getDisplayName(): String = "AI Skills Manager"
    override fun isAvailable(project: Project): Boolean = true
    override fun createWidget(project: Project): StatusBarWidget = AiSkillsStatusBarWidget(project)
}

class AiSkillsStatusBarWidget(private val project: Project) : StatusBarWidget, StatusBarWidget.TextPresentation {

    companion object {
        const val ID = "AiSkillsManager.StatusBar"
        private var installedCount = 0
        private var updateCount = 0

        fun updateCounts(installed: Int, updates: Int) {
            installedCount = installed
            updateCount = updates
        }
    }

    private var statusBar: StatusBar? = null

    override fun ID(): String = ID

    override fun install(statusBar: StatusBar) {
        this.statusBar = statusBar
        refreshCounts()
    }

    override fun dispose() {
        statusBar = null
    }

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun getText(): String {
        val updatePart = if (updateCount > 0) " ↑$updateCount" else ""
        return "AI Skills: $installedCount$updatePart"
    }

    override fun getTooltipText(): String {
        val base = "$installedCount resource(s) installed"
        return if (updateCount > 0) "$base, $updateCount update(s) available" else base
    }

    override fun getAlignment(): Float = 0f

    override fun getClickConsumer(): Consumer<MouseEvent> = Consumer { e ->
        val menu = JPopupMenu()

        // Browse Marketplace — focus the tool window on the Marketplace tab
        menu.add(JMenuItem("Browse Marketplace").apply {
            addActionListener {
                val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                tw?.show {
                    tw.contentManager.contents.firstOrNull { c -> c.displayName == "Marketplace" }
                        ?.let { tw.contentManager.setSelectedContent(it) }
                }
            }
        })

        // Create New Resource
        menu.add(JMenuItem("Create New Resource…").apply {
            addActionListener {
                val categories = ResourceCategory.entries.map { it.label }.toTypedArray()
                val catIdx = Messages.showChooseDialog(
                    project, "Select resource category:", "Create New Resource",
                    Messages.getQuestionIcon(), categories, categories[0]
                )
                if (catIdx < 0) return@addActionListener
                val category = ResourceCategory.entries[catIdx]

                val name = Messages.showInputDialog(
                    project, "Resource name:", "Create New Resource",
                    Messages.getQuestionIcon()
                )
                if (name.isNullOrBlank()) return@addActionListener

                val scopes = arrayOf("Workspace", "Global")
                val scopeIdx = Messages.showChooseDialog(
                    project, "Install scope:", "Create New Resource",
                    Messages.getQuestionIcon(), scopes, scopes[0]
                )
                if (scopeIdx < 0) return@addActionListener
                val scope = if (scopeIdx == 0) InstallScope.WORKSPACE else InstallScope.GLOBAL

                val scaffolding = ScaffoldingService.getInstance(project)
                val path = scaffolding.createResource(name, category, scope)
                if (path != null) {
                    val vf = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(Paths.get(path))
                    if (vf != null) FileEditorManager.getInstance(project).openFile(vf, true)
                } else {
                    Messages.showErrorDialog(project, "Failed to create resource.", "Error")
                }
            }
        })

        // View Installed — focus the tool window on the Installed tab (shown when resources exist)
        if (installedCount > 0) {
            menu.add(JMenuItem("View Installed ($installedCount)").apply {
                addActionListener {
                    val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                    tw?.show {
                        tw.contentManager.contents.firstOrNull { c -> c.displayName == "Installed" }
                            ?.let { tw.contentManager.setSelectedContent(it) }
                    }
                }
            })
        }

        // Update All — shown when updates are available
        if (updateCount > 0) {
            menu.add(JMenuItem("Update All ($updateCount)").apply {
                addActionListener {
                    // Open tool window on Installed tab — the UpdateAll action lives there
                    val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                    tw?.show {
                        tw.contentManager.contents.firstOrNull { c -> c.displayName == "Installed" }
                            ?.let { tw.contentManager.setSelectedContent(it) }
                    }
                    // Trigger the update via action system
                    com.intellij.openapi.actionSystem.ActionManager.getInstance()
                        .getAction("AiSkillsManager.RefreshMarketplace")
                        ?.let { /* Toolbar UpdateAll is not a standalone action; open the tab instead */ }
                }
            })
        }

        menu.addSeparator()

        // Check for Updates
        menu.add(JMenuItem("Check for Updates").apply {
            addActionListener {
                val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                tw?.show {
                    tw.contentManager.contents.firstOrNull { c -> c.displayName == "Installed" }
                        ?.let { tw.contentManager.setSelectedContent(it) }
                }
            }
        })

        // Install Resource Pack
        menu.add(JMenuItem("Install Resource Pack…").apply {
            addActionListener {
                val descriptor = FileChooserDescriptorFactory.createSingleFileDescriptor("json")
                val file = FileChooser.chooseFile(descriptor, project, null) ?: return@addActionListener
                val path = file.toNioPath()

                val scopes = arrayOf("Workspace", "Global")
                val scopeIdx = Messages.showChooseDialog(
                    project, "Install scope:", "Install Pack",
                    Messages.getQuestionIcon(), scopes, scopes[0]
                )
                if (scopeIdx < 0) return@addActionListener
                val scope = if (scopeIdx == 0) InstallScope.WORKSPACE else InstallScope.GLOBAL

                ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Installing pack…", true) {
                    override fun run(indicator: ProgressIndicator) {
                        val packService = PackService.getInstance(project)
                        val projectService = ProjectService.getInstance(project)
                        val resourceClient = ResourceClient().apply { syncSettings() }
                        val installService = InstallationService(resourceClient, projectService)
                        val (installed, notFound, failed) = packService.installPack(
                            path, scope, emptyList(), emptyList(), resourceClient, installService
                        )
                        ApplicationManager.getApplication().invokeLater {
                            Messages.showInfoMessage(
                                project,
                                "Pack install complete: $installed installed, $notFound not found, $failed failed.",
                                "Pack Installed"
                            )
                        }
                    }
                })
            }
        })

        menu.addSeparator()

        // Validate Resources
        menu.add(JMenuItem("Validate Resources").apply {
            addActionListener {
                ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Validating…", true) {
                    override fun run(indicator: ProgressIndicator) {
                        val projectService = ProjectService.getInstance(project)
                        val installed = projectService.scanInstalledResources()
                        val validationService = ValidationService.getInstance(project)
                        val issues = validationService.validate(installed)
                        ApplicationManager.getApplication().invokeLater {
                            if (issues.isEmpty()) {
                                Messages.showInfoMessage(
                                    project,
                                    "All ${installed.size} resources passed validation.",
                                    "Validation Complete"
                                )
                            } else {
                                val sb = StringBuilder("Found ${issues.size} issue(s):\n\n")
                                for (issue in issues) {
                                    val icon = when (issue.severity) {
                                        ValidationSeverity.ERROR -> "❌"
                                        ValidationSeverity.WARNING -> "⚠️"
                                        ValidationSeverity.INFO -> "ℹ️"
                                    }
                                    sb.append("$icon ${issue.resource.name}: ${issue.message}\n")
                                }
                                Messages.showInfoMessage(project, sb.toString(), "Validation Results")
                            }
                        }
                    }
                })
            }
        })

        menu.addSeparator()

        // Export Configuration
        menu.add(JMenuItem("Export Configuration…").apply {
            addActionListener {
                val descriptor = FileChooserDescriptorFactory.createSingleFolderDescriptor()
                val folder = FileChooser.chooseFile(descriptor, project, null) ?: return@addActionListener
                val outputPath = folder.toNioPath().resolve("ai-skills-config.json")
                val configService = ConfigService.getInstance(project)
                if (configService.exportConfig(outputPath)) {
                    Messages.showInfoMessage(project, "Config exported to:\n$outputPath", "Export Complete")
                } else {
                    Messages.showErrorDialog(project, "Failed to export config.", "Error")
                }
            }
        })

        // Import Configuration
        menu.add(JMenuItem("Import Configuration…").apply {
            addActionListener {
                val descriptor = FileChooserDescriptorFactory.createSingleFileDescriptor("json")
                val file = FileChooser.chooseFile(descriptor, project, null) ?: return@addActionListener

                val strategies = arrayOf("Merge (add new, keep existing)", "Replace")
                val stratIdx = Messages.showChooseDialog(
                    project, "Import strategy:", "Import Config",
                    Messages.getQuestionIcon(), strategies, strategies[0]
                )
                if (stratIdx < 0) return@addActionListener

                val configService = ConfigService.getInstance(project)
                val success = configService.importConfig(file.toNioPath(), merge = stratIdx == 0)
                if (success) {
                    Messages.showInfoMessage(project, "Config imported successfully.", "Import Complete")
                } else {
                    Messages.showErrorDialog(project, "Failed to import config.", "Error")
                }
            }
        })

        menu.addSeparator()

        // Detect Resource Usage
        menu.add(JMenuItem("Detect Resource Usage").apply {
            addActionListener {
                ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Detecting usage…", true) {
                    override fun run(indicator: ProgressIndicator) {
                        val projectService = ProjectService.getInstance(project)
                        val installed = projectService.scanInstalledResources()
                        val usageService = UsageDetectionService.getInstance(project)
                        val result = usageService.detectUsage(installed)
                        ApplicationManager.getApplication().invokeLater {
                            val sb = StringBuilder()
                            sb.append("In use (${result.inUseNames.size}):\n")
                            for (name in result.inUseNames.sorted()) {
                                val refs = result.usageMap[name] ?: emptyList()
                                sb.append("  ✓ $name (${refs.size} reference(s))\n")
                            }
                            if (result.unusedNames.isNotEmpty()) {
                                sb.append("\nUnused (${result.unusedNames.size}):\n")
                                for (name in result.unusedNames.sorted()) {
                                    sb.append("  ✗ $name\n")
                                }
                            }
                            Messages.showInfoMessage(project, sb.toString(), "Usage Detection Results")
                        }
                    }
                })
            }
        })

        menu.show(e.component, e.x, e.y)
    }

    fun refreshCounts() {
        try {
            val projectService = ProjectService.getInstance(project)
            val installed = projectService.scanInstalledResources()
            installedCount = installed.size
        } catch (_: Exception) {
            // Project may not be fully initialized yet
        }
        ApplicationManager.getApplication().invokeLater {
            statusBar?.updateWidget(ID)
        }
    }

    fun setUpdateCount(count: Int) {
        updateCount = count
        ApplicationManager.getApplication().invokeLater {
            statusBar?.updateWidget(ID)
        }
    }
}
