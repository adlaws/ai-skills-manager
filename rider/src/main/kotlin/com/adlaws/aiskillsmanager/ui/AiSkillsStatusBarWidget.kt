package com.adlaws.aiskillsmanager.ui

import com.adlaws.aiskillsmanager.services.ProjectService
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.util.Consumer
import java.awt.event.MouseEvent
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

        menu.add(JMenuItem("Open AI Skills Manager").apply {
            addActionListener {
                val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                tw?.show()
            }
        })
        menu.addSeparator()
        menu.add(JMenuItem("Check for Updates").apply {
            addActionListener {
                val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                tw?.show()
            }
        })
        menu.add(JMenuItem("Create New Resource…").apply {
            addActionListener {
                val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                tw?.show()
            }
        })
        menu.add(JMenuItem("Validate Resources").apply {
            addActionListener {
                val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                tw?.show()
            }
        })
        menu.addSeparator()
        menu.add(JMenuItem("Export Configuration…").apply {
            addActionListener {
                val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                tw?.show()
            }
        })
        menu.add(JMenuItem("Import Configuration…").apply {
            addActionListener {
                val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                tw?.show()
            }
        })
        menu.addSeparator()
        menu.add(JMenuItem("Detect Resource Usage").apply {
            addActionListener {
                val tw = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager")
                tw?.show()
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
