package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.InstallScope
import com.adlaws.aiskillsmanager.model.ResourceCategory
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project

/**
 * Creates new resources from built-in templates.
 *
 * Mirrors the VS Code extension's `scaffoldingService.ts`:
 * - Each category has a template that generates properly structured content with frontmatter
 * - Skills create a folder with SKILL.md
 * - Other categories create a single file
 */
@Service(Service.Level.PROJECT)
class ScaffoldingService(private val project: Project) {

    /**
     * Create a new resource from a template.
     *
     * @return The path to the created file, or null on failure.
     */
    fun createResource(name: String, category: ResourceCategory, scope: InstallScope = InstallScope.WORKSPACE): String? {
        val projectService = ProjectService.getInstance(project)
        val targetDir = projectService.resolveInstallPath(category, scope)
        java.nio.file.Files.createDirectories(targetDir)

        return try {
            when (category) {
                ResourceCategory.CHATMODES -> createChatMode(name, targetDir)
                ResourceCategory.INSTRUCTIONS -> createInstructions(name, targetDir)
                ResourceCategory.PROMPTS -> createPrompt(name, targetDir)
                ResourceCategory.AGENTS -> createAgent(name, targetDir)
                ResourceCategory.SKILLS -> createSkill(name, targetDir)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun createChatMode(name: String, dir: java.nio.file.Path): String {
        val file = dir.resolve("$name.chatmode.md")
        val content = """
            |---
            |description: A custom chat mode
            |tools: []
            |---
            |
            |# $name
            |
            |Describe the behaviour of this chat mode here.
        """.trimMargin()
        java.nio.file.Files.writeString(file, content)
        return file.toString()
    }

    private fun createInstructions(name: String, dir: java.nio.file.Path): String {
        val file = dir.resolve("$name.instructions.md")
        val content = """
            |---
            |description: $name instructions
            |applyTo: "**/*"
            |---
            |
            |# $name
            |
            |Add your instructions here.
        """.trimMargin()
        java.nio.file.Files.writeString(file, content)
        return file.toString()
    }

    private fun createPrompt(name: String, dir: java.nio.file.Path): String {
        val file = dir.resolve("$name.prompt.md")
        val content = """
            |---
            |description: $name prompt
            |mode: agent
            |tools: []
            |---
            |
            |# $name
            |
            |Add your prompt steps here.
        """.trimMargin()
        java.nio.file.Files.writeString(file, content)
        return file.toString()
    }

    private fun createAgent(name: String, dir: java.nio.file.Path): String {
        val file = dir.resolve("$name.agent.md")
        val content = """
            |---
            |description: A custom agent
            |tools: []
            |---
            |
            |# $name
            |
            |Describe the agent's capabilities and behaviour here.
        """.trimMargin()
        java.nio.file.Files.writeString(file, content)
        return file.toString()
    }

    private fun createSkill(name: String, dir: java.nio.file.Path): String {
        val skillDir = dir.resolve(name)
        java.nio.file.Files.createDirectories(skillDir)
        val skillMd = skillDir.resolve("SKILL.md")
        val content = """
            |---
            |name: $name
            |description: A custom skill
            |license: MIT
            |compatibility: copilot
            |---
            |
            |# $name
            |
            |Describe the skill here.
        """.trimMargin()
        java.nio.file.Files.writeString(skillMd, content)

        // Also create a README.md
        val readme = skillDir.resolve("README.md")
        java.nio.file.Files.writeString(readme, "# $name\n\nA custom AI skill.\n")
        return skillMd.toString()
    }

    companion object {
        fun getInstance(project: Project): ScaffoldingService =
            project.getService(ScaffoldingService::class.java)
    }
}
