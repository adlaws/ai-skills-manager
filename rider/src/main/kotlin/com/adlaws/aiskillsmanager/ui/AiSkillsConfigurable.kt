package com.adlaws.aiskillsmanager.ui

import com.adlaws.aiskillsmanager.model.InstallScope
import com.adlaws.aiskillsmanager.model.ResourceCategory
import com.adlaws.aiskillsmanager.services.SettingsService
import com.intellij.openapi.options.Configurable
import com.intellij.ui.components.JBTextField
import com.intellij.ui.table.JBTable
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import javax.swing.*
import javax.swing.table.DefaultTableModel

/**
 * Settings UI page under Tools → AI Skills Manager.
 *
 * Mirrors the VS Code extension's configuration contribution points:
 * - Repository management (add/remove/toggle)
 * - Workspace and global install location paths per category
 * - Local collection management
 * - GitHub token and cache timeout
 */
class AiSkillsConfigurable : Configurable {

    private var panel: JPanel? = null

    // Repository table
    private val repoTableModel = DefaultTableModel(arrayOf("Owner", "Repo", "Branch", "Skills Path", "Enabled"), 0)
    private val repoTable = JBTable(repoTableModel)

    // Local collections table
    private val localTableModel = DefaultTableModel(arrayOf("Path", "Label", "Enabled"), 0)
    private val localTable = JBTable(localTableModel)

    // Install locations
    private val workspaceLocationFields = mutableMapOf<ResourceCategory, JBTextField>()
    private val globalLocationFields = mutableMapOf<ResourceCategory, JBTextField>()

    // Other settings
    private val githubTokenField = JBTextField()
    private val cacheTimeoutField = JBTextField()

    override fun getDisplayName(): String = "AI Skills Manager"

    override fun createComponent(): JComponent {
        val mainPanel = JPanel()
        mainPanel.layout = BoxLayout(mainPanel, BoxLayout.Y_AXIS)
        mainPanel.border = BorderFactory.createEmptyBorder(10, 10, 10, 10)

        // ---- Repositories section ----
        mainPanel.add(createSectionLabel("Repositories"))
        mainPanel.add(Box.createVerticalStrut(4))

        val repoPanel = JPanel(BorderLayout())
        repoTable.preferredScrollableViewportSize = Dimension(600, 120)
        repoPanel.add(JScrollPane(repoTable), BorderLayout.CENTER)

        val repoButtons = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            add(JButton("Add").apply {
                addActionListener { addRepository() }
            })
            add(Box.createVerticalStrut(4))
            add(JButton("Remove").apply {
                addActionListener { removeSelectedRepo() }
            })
        }
        repoPanel.add(repoButtons, BorderLayout.EAST)
        mainPanel.add(repoPanel)
        mainPanel.add(Box.createVerticalStrut(12))

        // ---- Local Collections section ----
        mainPanel.add(createSectionLabel("Local Collections"))
        mainPanel.add(Box.createVerticalStrut(4))

        val localPanel = JPanel(BorderLayout())
        localTable.preferredScrollableViewportSize = Dimension(600, 100)
        localPanel.add(JScrollPane(localTable), BorderLayout.CENTER)

        val localButtons = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            add(JButton("Add").apply {
                addActionListener { addLocalCollection() }
            })
            add(Box.createVerticalStrut(4))
            add(JButton("Remove").apply {
                addActionListener { removeSelectedLocal() }
            })
        }
        localPanel.add(localButtons, BorderLayout.EAST)
        mainPanel.add(localPanel)
        mainPanel.add(Box.createVerticalStrut(12))

        // ---- Install Locations section ----
        mainPanel.add(createSectionLabel("Install Locations"))
        mainPanel.add(Box.createVerticalStrut(4))

        val locPanel = JPanel(GridBagLayout())
        val gbc = GridBagConstraints().apply {
            insets = Insets(2, 4, 2, 4)
            fill = GridBagConstraints.HORIZONTAL
        }

        // Headers
        gbc.gridy = 0; gbc.gridx = 0; gbc.weightx = 0.0
        locPanel.add(JLabel("Category"), gbc)
        gbc.gridx = 1; gbc.weightx = 1.0
        locPanel.add(JLabel("Workspace Path"), gbc)
        gbc.gridx = 2; gbc.weightx = 1.0
        locPanel.add(JLabel("Global Path"), gbc)

        var row = 1
        for (category in ResourceCategory.entries) {
            gbc.gridy = row; gbc.gridx = 0; gbc.weightx = 0.0
            locPanel.add(JLabel(category.label), gbc)

            val wsField = JBTextField()
            workspaceLocationFields[category] = wsField
            gbc.gridx = 1; gbc.weightx = 1.0
            locPanel.add(wsField, gbc)

            val globalField = JBTextField()
            globalLocationFields[category] = globalField
            gbc.gridx = 2; gbc.weightx = 1.0
            locPanel.add(globalField, gbc)

            row++
        }
        mainPanel.add(locPanel)
        mainPanel.add(Box.createVerticalStrut(12))

        // ---- Other Settings section ----
        mainPanel.add(createSectionLabel("Other Settings"))
        mainPanel.add(Box.createVerticalStrut(4))

        val otherPanel = JPanel(GridBagLayout())
        val ogbc = GridBagConstraints().apply {
            insets = Insets(2, 4, 2, 4)
            fill = GridBagConstraints.HORIZONTAL
        }

        ogbc.gridy = 0; ogbc.gridx = 0; ogbc.weightx = 0.0
        otherPanel.add(JLabel("GitHub Token:"), ogbc)
        ogbc.gridx = 1; ogbc.weightx = 1.0
        githubTokenField.toolTipText = "Personal access token for higher rate limits (optional)"
        otherPanel.add(githubTokenField, ogbc)

        ogbc.gridy = 1; ogbc.gridx = 0; ogbc.weightx = 0.0
        otherPanel.add(JLabel("Cache Timeout (seconds):"), ogbc)
        ogbc.gridx = 1; ogbc.weightx = 1.0
        cacheTimeoutField.toolTipText = "How long to cache API responses (default: 3600)"
        otherPanel.add(cacheTimeoutField, ogbc)

        mainPanel.add(otherPanel)

        // Load current values
        loadFromSettings()

        panel = JPanel(BorderLayout())
        panel!!.add(JScrollPane(mainPanel), BorderLayout.CENTER)
        return panel!!
    }

    override fun isModified(): Boolean {
        val settings = SettingsService.getInstance()

        // Check repositories
        if (repoTableModel.rowCount != settings.getState().repositories.size) return true

        // Check install locations
        for (category in ResourceCategory.entries) {
            val wsVal = workspaceLocationFields[category]?.text ?: ""
            val globalVal = globalLocationFields[category]?.text ?: ""
            if (wsVal != settings.getInstallLocation(category, InstallScope.WORKSPACE)) return true
            if (globalVal != settings.getInstallLocation(category, InstallScope.GLOBAL)) return true
        }

        // Check other settings
        if (githubTokenField.text != settings.getGithubToken()) return true
        if (cacheTimeoutField.text != settings.getCacheTimeout().toString()) return true

        return false
    }

    override fun apply() {
        val settings = SettingsService.getInstance()

        // Apply repositories
        settings.getState().repositories.clear()
        for (i in 0 until repoTableModel.rowCount) {
            val owner = repoTableModel.getValueAt(i, 0)?.toString() ?: ""
            val repo = repoTableModel.getValueAt(i, 1)?.toString() ?: ""
            val branch = repoTableModel.getValueAt(i, 2)?.toString().takeIf { !it.isNullOrBlank() } ?: "main"
            val skillsPath = repoTableModel.getValueAt(i, 3)?.toString()?.ifBlank { null }
            val enabled = repoTableModel.getValueAt(i, 4) as? Boolean ?: true
            if (owner.isNotBlank() && repo.isNotBlank()) {
                settings.addRepository(owner, repo, branch, skillsPath)
                if (!enabled) settings.toggleRepository(owner, repo)
            }
        }

        // Apply local collections
        settings.getState().localCollections.clear()
        for (i in 0 until localTableModel.rowCount) {
            val path = localTableModel.getValueAt(i, 0)?.toString() ?: ""
            val label = localTableModel.getValueAt(i, 1)?.toString()?.ifBlank { null }
            val enabled = localTableModel.getValueAt(i, 2) as? Boolean ?: true
            if (path.isNotBlank()) {
                settings.addLocalCollection(path, label)
                if (!enabled) settings.toggleLocalCollection(path)
            }
        }

        // Apply install locations
        for (category in ResourceCategory.entries) {
            val wsVal = workspaceLocationFields[category]?.text ?: category.defaultPath
            val globalVal = globalLocationFields[category]?.text ?: "~/.agents/${category.id}"
            settings.setInstallLocation(category, InstallScope.WORKSPACE, wsVal)
            settings.setInstallLocation(category, InstallScope.GLOBAL, globalVal)
        }

        // Apply other settings
        settings.setGithubToken(githubTokenField.text)
        settings.setCacheTimeout(cacheTimeoutField.text.toIntOrNull() ?: 3600)
    }

    override fun reset() {
        loadFromSettings()
    }

    private fun loadFromSettings() {
        val settings = SettingsService.getInstance()

        // Repositories
        repoTableModel.rowCount = 0
        for (repo in settings.getRepositories()) {
            repoTableModel.addRow(arrayOf(repo.owner, repo.repo, repo.branch, repo.skillsPath ?: "", repo.enabled))
        }

        // Local collections
        localTableModel.rowCount = 0
        for (col in settings.getLocalCollections()) {
            localTableModel.addRow(arrayOf(col.path, col.label ?: "", col.enabled))
        }

        // Install locations
        for (category in ResourceCategory.entries) {
            workspaceLocationFields[category]?.text = settings.getInstallLocation(category, InstallScope.WORKSPACE)
            globalLocationFields[category]?.text = settings.getInstallLocation(category, InstallScope.GLOBAL)
        }

        // Other
        githubTokenField.text = settings.getGithubToken()
        cacheTimeoutField.text = settings.getCacheTimeout().toString()
    }

    private fun addRepository() {
        repoTableModel.addRow(arrayOf("", "", "main", "", true))
    }

    private fun removeSelectedRepo() {
        val row = repoTable.selectedRow
        if (row >= 0) repoTableModel.removeRow(row)
    }

    private fun addLocalCollection() {
        localTableModel.addRow(arrayOf("", "", true))
    }

    private fun removeSelectedLocal() {
        val row = localTable.selectedRow
        if (row >= 0) localTableModel.removeRow(row)
    }

    private fun createSectionLabel(text: String): JLabel {
        return JLabel("<html><b>$text</b></html>").apply {
            border = BorderFactory.createEmptyBorder(4, 0, 2, 0)
        }
    }
}
