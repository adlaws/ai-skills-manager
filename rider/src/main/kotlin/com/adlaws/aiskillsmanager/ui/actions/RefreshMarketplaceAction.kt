package com.adlaws.aiskillsmanager.ui.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Action to refresh the marketplace resource list.
 * Triggers via the tool window's content manager.
 */
class RefreshMarketplaceAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager") ?: return
        // The tool window factory creates the panels, so we just toggle visibility to force refresh
        if (toolWindow.isVisible) {
            toolWindow.hide()
            toolWindow.show()
        }
    }
}
