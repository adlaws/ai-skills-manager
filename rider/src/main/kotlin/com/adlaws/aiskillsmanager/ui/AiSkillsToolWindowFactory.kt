package com.adlaws.aiskillsmanager.ui

import com.adlaws.aiskillsmanager.model.*
import com.adlaws.aiskillsmanager.services.*
import com.intellij.openapi.actionSystem.*
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.WindowManager
import com.intellij.ui.content.ContentFactory
import java.nio.file.Paths

/**
 * Tool window factory that creates the main AI Skills Manager panel.
 *
 * Mirrors the VS Code extension's Activity Bar view container with three tree views:
 * - Marketplace (Repo → Category → Resource)
 * - Local Collections (Collection → Category → Resource)
 * - Installed (Category → Resource)
 *
 * Toolbar actions for each tab, plus cross-panel coordination.
 */
class AiSkillsToolWindowFactory : ToolWindowFactory, DumbAware {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val contentFactory = ContentFactory.getInstance()

        // Create panels
        val marketplacePanel = MarketplacePanel(project)
        val localPanel = LocalCollectionsPanel(project)
        val installedPanel = InstalledPanel(project)

        // Cross-panel coordination: when installed changes, update marketplace & local badges
        installedPanel.onInstalledChanged = {
            val names = installedPanel.getInstalledNames()
            marketplacePanel.setInstalledNames(names)
            localPanel.setInstalledNames(names)

            // Update status bar widget counts
            val statusBar = WindowManager.getInstance().getStatusBar(project)
            val widget = statusBar?.getWidget(AiSkillsStatusBarWidget.ID) as? AiSkillsStatusBarWidget
            widget?.refreshCounts()
            widget?.setUpdateCount(installedPanel.getUpdatableCount())
        }

        // Register disposables
        Disposer.register(toolWindow.disposable, installedPanel)
        Disposer.register(toolWindow.disposable, localPanel)

        // ---- Marketplace tab ----
        val marketplaceContent = contentFactory.createContent(
            marketplacePanel.component, "Marketplace", false
        )
        toolWindow.contentManager.addContent(marketplaceContent)

        // ---- Local Collections tab ----
        val localContent = contentFactory.createContent(
            localPanel.component, "Local Collections", false
        )
        toolWindow.contentManager.addContent(localContent)

        // ---- Installed tab ----
        val installedContent = contentFactory.createContent(
            installedPanel.component, "Installed", false
        )
        toolWindow.contentManager.addContent(installedContent)

        // ---- Toolbar actions ----
        val actionGroup = DefaultActionGroup().apply {
            add(RefreshAction(project, marketplacePanel, localPanel, installedPanel))
            add(CheckUpdatesAction(project, installedPanel, marketplacePanel))
            add(UpdateAllAction(project, installedPanel, marketplacePanel))
            addSeparator()
            add(CreateResourceAction(project))
            add(InstallPackAction(project, marketplacePanel, localPanel))
            add(CreatePackFromInstalledAction(project, installedPanel))
            add(ValidateAction(project, installedPanel))
            addSeparator()
            add(ExportConfigAction(project))
            add(ImportConfigAction(project, marketplacePanel, localPanel, installedPanel))
            add(DetectUsageAction(project, installedPanel))
            addSeparator()
            add(ManageReposAction(project, marketplacePanel))
            add(ManageCollectionsAction(project, localPanel))
        }
        toolWindow.setTitleActions(actionGroup.getChildren(null).toList())

        // Initial load
        ApplicationManager.getApplication().invokeLater {
            marketplacePanel.loadResources()
            localPanel.loadResources()
        }
    }

    // ---- Actions ----

    private class RefreshAction(
        private val project: Project,
        private val marketplace: MarketplacePanel,
        private val local: LocalCollectionsPanel,
        private val installed: InstalledPanel
    ) : AnAction("Refresh All", "Refresh all panels", com.intellij.icons.AllIcons.Actions.Refresh), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            marketplace.refresh()
            local.refresh()
            installed.refresh()
        }
    }

    private class CheckUpdatesAction(
        private val project: Project,
        private val installed: InstalledPanel,
        private val marketplace: MarketplacePanel
    ) : AnAction("Check for Updates", "Check for upstream updates", com.intellij.icons.AllIcons.Actions.CheckOut), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            installed.checkForUpdates(marketplace.getResourceClient())
        }
    }

    private class UpdateAllAction(
        private val project: Project,
        private val installed: InstalledPanel,
        private val marketplace: MarketplacePanel
    ) : AnAction("Update All Resources", "Update all resources with available updates", com.intellij.icons.AllIcons.Actions.Download), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            val updatable = installed.getUpdatableNames()
            if (updatable.isEmpty()) {
                Messages.showInfoMessage(project, "All resources are up to date.", "No Updates")
                return
            }

            val result = Messages.showOkCancelDialog(
                project,
                "Update ${updatable.size} resource(s) to their latest versions?",
                "Update All Resources",
                "Update All",
                "Cancel",
                Messages.getQuestionIcon()
            )
            if (result != Messages.OK) return

            ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Updating all resources…", true) {
                override fun run(indicator: ProgressIndicator) {
                    val projectService = ProjectService.getInstance(project)
                    val resourceClient = marketplace.getResourceClient()
                    val installService = InstallationService(resourceClient, projectService)
                    var success = 0
                    var failed = 0

                    for (resource in installed.getInstalledResources()) {
                        if (indicator.isCanceled) break
                        if (!updatable.contains(resource.name)) continue

                        indicator.text = "Updating ${resource.name}…"
                        if (installService.updateResource(resource)) {
                            success++
                        } else {
                            failed++
                        }
                    }

                    ApplicationManager.getApplication().invokeLater {
                        installed.refresh()
                        Messages.showInfoMessage(
                            project,
                            "Updated $success resource(s), $failed failed.",
                            "Update Complete"
                        )
                    }
                }
            })
        }
    }

    private class CreatePackFromInstalledAction(
        private val project: Project,
        private val installed: InstalledPanel
    ) : AnAction("Create Resource Pack…", "Create a pack from installed resources", com.intellij.icons.AllIcons.Nodes.PpLibFolder), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            installed.createPackFromSelected(installed.getInstalledResources())
        }
    }

    private class CreateResourceAction(
        private val project: Project
    ) : AnAction("Create New Resource…", "Create a new resource from template", com.intellij.icons.AllIcons.General.Add), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            val categories = ResourceCategory.entries.map { it.label }.toTypedArray()
            val catIdx = Messages.showChooseDialog(
                project, "Select resource category:", "Create New Resource",
                Messages.getQuestionIcon(), categories, categories[0]
            )
            if (catIdx < 0) return
            val category = ResourceCategory.entries[catIdx]

            val name = Messages.showInputDialog(
                project, "Resource name:", "Create New Resource",
                Messages.getQuestionIcon()
            )
            if (name.isNullOrBlank()) return

            val scopes = arrayOf("Workspace", "Global")
            val scopeIdx = Messages.showChooseDialog(
                project, "Install scope:", "Create New Resource",
                Messages.getQuestionIcon(), scopes, scopes[0]
            )
            if (scopeIdx < 0) return
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
    }

    private class InstallPackAction(
        private val project: Project,
        private val marketplace: MarketplacePanel,
        private val local: LocalCollectionsPanel
    ) : AnAction("Install Pack…", "Install resources from a pack manifest", com.intellij.icons.AllIcons.Nodes.PpLib), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            val descriptor = FileChooserDescriptorFactory.createSingleFileDescriptor("json")
            val file = FileChooser.chooseFile(descriptor, project, null) ?: return
            val path = file.toNioPath()

            val scopes = arrayOf("Workspace", "Global")
            val scopeIdx = Messages.showChooseDialog(
                project, "Install scope:", "Install Pack",
                Messages.getQuestionIcon(), scopes, scopes[0]
            )
            if (scopeIdx < 0) return
            val scope = if (scopeIdx == 0) InstallScope.WORKSPACE else InstallScope.GLOBAL

            ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Installing pack…", true) {
                override fun run(indicator: ProgressIndicator) {
                    val packService = PackService.getInstance(project)
                    val projectService = ProjectService.getInstance(project)
                    val resourceClient = marketplace.getResourceClient()
                    val installService = InstallationService(resourceClient, projectService)
                    val (installed, notFound, failed) = packService.installPack(
                        path, scope,
                        marketplace.getAllItems(),
                        local.getAllItems(),
                        resourceClient,
                        installService
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
    }

    private class ValidateAction(
        private val project: Project,
        private val installed: InstalledPanel
    ) : AnAction("Validate Resources", "Check installed resources for issues", com.intellij.icons.AllIcons.General.InspectionsOK), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Validating…", true) {
                override fun run(indicator: ProgressIndicator) {
                    val validationService = ValidationService.getInstance(project)
                    val issues = validationService.validate(installed.getInstalledResources())
                    ApplicationManager.getApplication().invokeLater {
                        if (issues.isEmpty()) {
                            Messages.showInfoMessage(
                                project,
                                "All ${installed.getInstalledResources().size} resources passed validation.",
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
    }

    private class ExportConfigAction(
        private val project: Project
    ) : AnAction("Export Config…", "Export settings to a JSON file", com.intellij.icons.AllIcons.ToolbarDecorator.Export), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            val descriptor = FileChooserDescriptorFactory.createSingleFolderDescriptor()
            val folder = FileChooser.chooseFile(descriptor, project, null) ?: return
            val outputPath = folder.toNioPath().resolve("ai-skills-config.json")
            val configService = ConfigService.getInstance(project)
            if (configService.exportConfig(outputPath)) {
                Messages.showInfoMessage(project, "Config exported to:\n$outputPath", "Export Complete")
            } else {
                Messages.showErrorDialog(project, "Failed to export config.", "Error")
            }
        }
    }

    private class ImportConfigAction(
        private val project: Project,
        private val marketplace: MarketplacePanel,
        private val local: LocalCollectionsPanel,
        private val installed: InstalledPanel
    ) : AnAction("Import Config…", "Import settings from a JSON file", com.intellij.icons.AllIcons.ToolbarDecorator.Import), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            val descriptor = FileChooserDescriptorFactory.createSingleFileDescriptor("json")
            val file = FileChooser.chooseFile(descriptor, project, null) ?: return

            val strategies = arrayOf("Merge (add new, keep existing)", "Replace")
            val stratIdx = Messages.showChooseDialog(
                project, "Import strategy:", "Import Config",
                Messages.getQuestionIcon(), strategies, strategies[0]
            )
            if (stratIdx < 0) return

            val configService = ConfigService.getInstance(project)
            val success = configService.importConfig(file.toNioPath(), merge = stratIdx == 0)
            if (success) {
                Messages.showInfoMessage(project, "Config imported successfully.", "Import Complete")
                marketplace.refresh()
                local.refresh()
                installed.refresh()
            } else {
                Messages.showErrorDialog(project, "Failed to import config.", "Error")
            }
        }
    }

    private class DetectUsageAction(
        private val project: Project,
        private val installed: InstalledPanel
    ) : AnAction("Detect Resource Usage", "Scan workspace for resource references", com.intellij.icons.AllIcons.Actions.Find), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Detecting usage…", true) {
                override fun run(indicator: ProgressIndicator) {
                    val usageService = UsageDetectionService.getInstance(project)
                    val result = usageService.detectUsage(installed.getInstalledResources())
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
    }

    private class ManageReposAction(
        private val project: Project,
        private val marketplace: MarketplacePanel
    ) : AnAction("Manage Repositories…", "Add, remove, or toggle repositories", com.intellij.icons.AllIcons.General.Settings), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            val actions = arrayOf("Add repository", "Toggle repository", "Remove repository")
            val choice = Messages.showChooseDialog(
                project, "Manage repositories:", "Manage Repositories",
                Messages.getQuestionIcon(), actions, actions[0]
            )

            val settings = SettingsService.getInstance()
            when (choice) {
                0 -> {
                    val input = Messages.showInputDialog(
                        project, "Enter owner/repo (e.g. github/awesome-copilot):",
                        "Add Repository", Messages.getQuestionIcon()
                    )
                    if (!input.isNullOrBlank()) {
                        val parts = input.split("/")
                        if (parts.size == 2) {
                            settings.addRepository(parts[0], parts[1])
                            marketplace.refresh()
                        } else {
                            Messages.showErrorDialog(project, "Invalid format. Use owner/repo.", "Error")
                        }
                    }
                }
                1 -> {
                    val repos = settings.getRepositories()
                    if (repos.isEmpty()) return
                    val labels = repos.map { "${it.key} [${if (it.enabled) "enabled" else "disabled"}]" }.toTypedArray()
                    val idx = Messages.showChooseDialog(
                        project, "Toggle repository:", "Toggle",
                        Messages.getQuestionIcon(), labels, labels[0]
                    )
                    if (idx >= 0) {
                        val repo = repos[idx]
                        settings.toggleRepository(repo.owner, repo.repo)
                        marketplace.refresh()
                    }
                }
                2 -> {
                    val repos = settings.getRepositories()
                    if (repos.isEmpty()) return
                    val labels = repos.map { it.key }.toTypedArray()
                    val idx = Messages.showChooseDialog(
                        project, "Remove repository:", "Remove",
                        Messages.getQuestionIcon(), labels, labels[0]
                    )
                    if (idx >= 0) {
                        val repo = repos[idx]
                        settings.removeRepository(repo.owner, repo.repo)
                        marketplace.refresh()
                    }
                }
            }
        }
    }

    private class ManageCollectionsAction(
        private val project: Project,
        private val local: LocalCollectionsPanel
    ) : AnAction("Manage Local Collections…", "Add, remove, or toggle local collections", com.intellij.icons.AllIcons.General.Settings), DumbAware {
        override fun actionPerformed(e: AnActionEvent) {
            val actions = arrayOf("Add collection", "Toggle collection", "Remove collection")
            val choice = Messages.showChooseDialog(
                project, "Manage local collections:", "Manage Collections",
                Messages.getQuestionIcon(), actions, actions[0]
            )

            val settings = SettingsService.getInstance()
            when (choice) {
                0 -> {
                    val descriptor = FileChooserDescriptorFactory.createSingleFolderDescriptor()
                    val folder = FileChooser.chooseFile(descriptor, project, null) ?: return
                    val label = Messages.showInputDialog(
                        project, "Collection label (optional):",
                        "Add Collection", Messages.getQuestionIcon()
                    )
                    settings.addLocalCollection(folder.path, label?.ifBlank { null })
                    local.refresh()
                }
                1 -> {
                    val cols = settings.getLocalCollections()
                    if (cols.isEmpty()) return
                    val labels = cols.map { "${it.label ?: it.path} [${if (it.enabled) "enabled" else "disabled"}]" }.toTypedArray()
                    val idx = Messages.showChooseDialog(
                        project, "Toggle collection:", "Toggle",
                        Messages.getQuestionIcon(), labels, labels[0]
                    )
                    if (idx >= 0) {
                        settings.toggleLocalCollection(cols[idx].path)
                        local.refresh()
                    }
                }
                2 -> {
                    val cols = settings.getLocalCollections()
                    if (cols.isEmpty()) return
                    val labels = cols.map { it.label ?: it.path }.toTypedArray()
                    val idx = Messages.showChooseDialog(
                        project, "Remove collection:", "Remove",
                        Messages.getQuestionIcon(), labels, labels[0]
                    )
                    if (idx >= 0) {
                        settings.removeLocalCollection(cols[idx].path)
                        local.refresh()
                    }
                }
            }
        }
    }
}
