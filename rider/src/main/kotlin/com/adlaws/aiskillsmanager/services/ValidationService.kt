package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.*
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.nio.file.Files
import java.nio.file.Paths

/**
 * Validates installed resources for integrity issues.
 *
 * Mirrors the VS Code extension's `validationService.ts`:
 * - Skills: checks for SKILL.md, non-empty frontmatter, implementation files
 * - Single files: checks for empty content, missing frontmatter
 * - Reports severity levels: ERROR, WARNING, INFO
 */
@Service(Service.Level.PROJECT)
class ValidationService(private val project: Project) {

    /**
     * Validate all installed resources and return a list of issues.
     */
    fun validate(resources: List<InstalledResource>): List<ValidationIssue> {
        val issues = mutableListOf<ValidationIssue>()
        for (resource in resources) {
            issues.addAll(validateResource(resource))
        }
        return issues
    }

    private fun validateResource(resource: InstalledResource): List<ValidationIssue> {
        val issues = mutableListOf<ValidationIssue>()
        val path = Paths.get(resource.path)

        if (!Files.exists(path)) {
            issues.add(ValidationIssue(resource, ValidationSeverity.ERROR, "Not found on disk"))
            return issues
        }

        if (resource.category == ResourceCategory.SKILLS) {
            validateSkill(resource, path, issues)
        } else {
            validateSingleFile(resource, path, issues)
        }

        return issues
    }

    private fun validateSkill(resource: InstalledResource, path: java.nio.file.Path, issues: MutableList<ValidationIssue>) {
        if (!Files.isDirectory(path)) {
            issues.add(ValidationIssue(resource, ValidationSeverity.ERROR, "Expected directory, found file"))
            return
        }

        val skillMd = path.resolve("SKILL.md")
        if (!Files.exists(skillMd)) {
            issues.add(ValidationIssue(resource, ValidationSeverity.ERROR, "Missing SKILL.md"))
            return
        }

        try {
            val content = Files.readString(skillMd)
            if (content.isBlank()) {
                issues.add(ValidationIssue(resource, ValidationSeverity.WARNING, "SKILL.md is empty"))
                return
            }

            if (!content.trimStart().startsWith("---")) {
                issues.add(ValidationIssue(resource, ValidationSeverity.WARNING, "No YAML frontmatter in SKILL.md"))
            } else {
                // Check frontmatter fields
                val resourceClient = ResourceClient()
                val meta = resourceClient.parseSkillMd(content)
                if (meta["name"].isNullOrBlank()) {
                    issues.add(ValidationIssue(resource, ValidationSeverity.WARNING, "Frontmatter missing 'name'"))
                }
                if (meta["description"].isNullOrBlank()) {
                    issues.add(ValidationIssue(resource, ValidationSeverity.INFO, "Frontmatter missing 'description'"))
                }
            }

            // Check for implementation files besides SKILL.md
            val fileCount = Files.list(path).use { it.count() }
            if (fileCount == 0L) {
                issues.add(ValidationIssue(resource, ValidationSeverity.ERROR, "Skill folder is empty"))
            } else if (fileCount == 1L) {
                issues.add(ValidationIssue(resource, ValidationSeverity.INFO, "Only SKILL.md present, no implementation files"))
            }
        } catch (e: Exception) {
            issues.add(ValidationIssue(resource, ValidationSeverity.ERROR, "Cannot read skill folder: ${e.message}"))
        }
    }

    private fun validateSingleFile(resource: InstalledResource, path: java.nio.file.Path, issues: MutableList<ValidationIssue>) {
        if (Files.isDirectory(path)) {
            issues.add(ValidationIssue(resource, ValidationSeverity.ERROR, "Expected file, found directory"))
            return
        }

        try {
            val size = Files.size(path)
            if (size == 0L) {
                issues.add(ValidationIssue(resource, ValidationSeverity.WARNING, "File is empty (0 bytes)"))
                return
            }

            val content = Files.readString(path)
            if (content.length < 10) {
                issues.add(ValidationIssue(resource, ValidationSeverity.INFO, "Very little content (< 10 characters)"))
            }

            // Check for frontmatter in known file types
            val frontmatterTypes = listOf(".instructions.md", ".chatmode.md", ".prompt.md", ".agent.md")
            if (frontmatterTypes.any { resource.name.endsWith(it) }) {
                if (!content.trimStart().startsWith("---")) {
                    issues.add(ValidationIssue(resource, ValidationSeverity.INFO, "No YAML frontmatter found"))
                }
            }
        } catch (e: Exception) {
            issues.add(ValidationIssue(resource, ValidationSeverity.WARNING, "Cannot read file: ${e.message}"))
        }
    }

    companion object {
        fun getInstance(project: Project): ValidationService =
            project.getService(ValidationService::class.java)
    }
}
