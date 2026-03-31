package com.adlaws.aiskillsmanager.ui

import com.adlaws.aiskillsmanager.model.*
import com.adlaws.aiskillsmanager.services.ResourceClient
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.components.JBScrollPane
import java.awt.BorderLayout
import java.awt.Desktop
import java.net.URI
import javax.swing.*

/**
 * Resource detail panel displayed as a tab in the tool window.
 *
 * Mirrors the VS Code extension's `resourceDetailPanel.ts`:
 * - Shows resource name, description, metadata badges
 * - Renders content as HTML (simple markdown-like rendering)
 * - Source link to GitHub
 */
class ResourceDetailPanel private constructor(
    private val project: Project,
    private val item: ResourceItem,
    private val resourceClient: ResourceClient?
) {

    companion object {
        /**
         * Show a detail panel for a resource in the AI Skills Manager tool window.
         */
        fun show(project: Project, item: ResourceItem, resourceClient: ResourceClient?) {
            val panel = ResourceDetailPanel(project, item, resourceClient)
            val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("AI Skills Manager") ?: return
            val contentFactory = com.intellij.ui.content.ContentFactory.getInstance()
            val content = contentFactory.createContent(panel.component, item.name, true)
            content.isCloseable = true
            toolWindow.contentManager.addContent(content)
            toolWindow.contentManager.setSelectedContent(content)
        }
    }

    val component: JComponent

    init {
        val html = buildHtml()
        val editorPane = JEditorPane("text/html", html).apply {
            isEditable = false
            caretPosition = 0
            addHyperlinkListener { e ->
                if (e.eventType == javax.swing.event.HyperlinkEvent.EventType.ACTIVATED) {
                    try { Desktop.getDesktop().browse(URI(e.url.toString())) } catch (_: Exception) {}
                }
            }
        }

        val panel = JPanel(BorderLayout())
        panel.add(JBScrollPane(editorPane), BorderLayout.CENTER)
        component = panel
    }

    private fun buildHtml(): String {
        val sb = StringBuilder()
        sb.append("""
            <html>
            <head>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                       padding: 16px; line-height: 1.6; }
                h1 { margin-top: 0; }
                .badge { display: inline-block; padding: 2px 8px; border-radius: 10px;
                         background: #e0e0e0; font-size: 0.85em; margin-right: 6px; }
                .meta { color: #666; margin-bottom: 16px; }
                .source { background: #f5f5f5; padding: 8px 12px; border-radius: 6px;
                          margin-bottom: 16px; font-size: 0.9em; }
                pre { background: #f5f5f5; padding: 12px; border-radius: 6px;
                      overflow-x: auto; font-size: 0.9em; }
                code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
            </style>
            </head>
            <body>
        """.trimIndent())

        // Category icon + name
        val categoryEmoji = when (item.category) {
            ResourceCategory.CHATMODES -> "💬"
            ResourceCategory.INSTRUCTIONS -> "📖"
            ResourceCategory.PROMPTS -> "💡"
            ResourceCategory.AGENTS -> "🤖"
            ResourceCategory.SKILLS -> "📦"
        }
        sb.append("<h1>$categoryEmoji ${escapeHtml(item.name)}</h1>")

        // Description
        if (!item.description.isNullOrBlank()) {
            sb.append("<p>${escapeHtml(item.description)}</p>")
        }

        // Badges
        sb.append("<div class='meta'>")
        sb.append("<span class='badge'>${item.category.label}</span>")
        if (!item.license.isNullOrBlank()) {
            sb.append("<span class='badge'>📄 ${escapeHtml(item.license)}</span>")
        }
        if (!item.compatibility.isNullOrBlank()) {
            sb.append("<span class='badge'>🔧 ${escapeHtml(item.compatibility)}</span>")
        }
        if (item.tags.isNotEmpty()) {
            for (tag in item.tags) {
                sb.append("<span class='badge'>🏷 ${escapeHtml(tag)}</span>")
            }
        }
        sb.append("</div>")

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
            // Strip frontmatter for display
            val displayContent = stripFrontmatter(content)
            sb.append("<hr>")
            sb.append(simpleMarkdownToHtml(displayContent))
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

    /**
     * Very basic markdown → HTML conversion for display.
     */
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
        // Bold: **text**
        var result = text.replace(Regex("\\*\\*(.+?)\\*\\*"), "<b>$1</b>")
        // Inline code: `text`
        result = result.replace(Regex("`(.+?)`"), "<code>$1</code>")
        return result
    }

    private fun escapeHtml(text: String): String {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace("\"", "&quot;")
    }
}
