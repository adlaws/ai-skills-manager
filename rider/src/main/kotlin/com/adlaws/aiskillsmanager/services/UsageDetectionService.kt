package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.*
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.nio.file.Files
import java.nio.file.Paths

/**
 * Scans workspace files for references to installed resources.
 *
 * Mirrors the VS Code extension's `usageDetectionService.ts`:
 * - Scans common config files (copilot-instructions.md, settings.json, mcp.json, etc.)
 * - Matches resource names (case-insensitive) including stripped extensions
 * - Reports which resources are in use and which are unused
 */
@Service(Service.Level.PROJECT)
class UsageDetectionService(private val project: Project) {

    companion object {
        /** File patterns to scan for resource references. */
        val SCAN_PATTERNS = listOf(
            ".github/copilot-instructions.md",
            ".vscode/settings.json",
            ".vscode/mcp.json",
            "copilot-instructions.md",
            ".copilot-codegeneration-instructions.md",
            "AGENTS.md",
            "CLAUDE.md",
            ".claude/settings.json",
            ".cursorrules",
            "package.json"
        )

        /** Directory patterns to scan (all files inside). */
        val SCAN_DIR_PATTERNS = listOf(
            ".github/instructions",
            ".github/prompts",
            ".github/chatmodes",
            ".github/agents"
        )

        /** Extensions to strip for fuzzy matching. */
        val STRIP_EXTENSIONS = listOf(
            ".chatmode.md", ".instructions.md", ".prompt.md", ".agent.md", ".md"
        )

        fun getInstance(project: Project): UsageDetectionService =
            project.getService(UsageDetectionService::class.java)
    }

    /**
     * Detect usage of installed resources in workspace files.
     */
    fun detectUsage(resources: List<InstalledResource>): UsageResult {
        val basePath = project.basePath ?: return UsageResult(emptyMap(), emptySet(), emptySet())
        val base = Paths.get(basePath)

        // Build name variants for matching
        val nameVariants = mutableMapOf<String, String>() // lowercase variant → original name
        for (resource in resources) {
            nameVariants[resource.name.lowercase()] = resource.name
            // Strip known extensions for fuzzy matching
            var stripped = resource.name
            for (ext in STRIP_EXTENSIONS) {
                if (stripped.lowercase().endsWith(ext)) {
                    stripped = stripped.dropLast(ext.length)
                    break
                }
            }
            if (stripped != resource.name) {
                nameVariants[stripped.lowercase()] = resource.name
            }
        }

        val usageMap = mutableMapOf<String, MutableList<UsageReference>>()
        val inUseNames = mutableSetOf<String>()

        // Scan individual files
        for (pattern in SCAN_PATTERNS) {
            val filePath = base.resolve(pattern)
            if (Files.isRegularFile(filePath)) {
                scanFile(filePath, nameVariants, usageMap, inUseNames)
            }
        }

        // Scan directory patterns
        for (dirPattern in SCAN_DIR_PATTERNS) {
            val dirPath = base.resolve(dirPattern)
            if (Files.isDirectory(dirPath)) {
                try {
                    Files.list(dirPath).use { stream ->
                        stream.filter { Files.isRegularFile(it) }.forEach { filePath ->
                            scanFile(filePath, nameVariants, usageMap, inUseNames)
                        }
                    }
                } catch (_: Exception) { }
            }
        }

        val allNames = resources.map { it.name }.toSet()
        val unusedNames = allNames - inUseNames

        return UsageResult(usageMap, inUseNames, unusedNames)
    }

    private fun scanFile(
        filePath: java.nio.file.Path,
        nameVariants: Map<String, String>,
        usageMap: MutableMap<String, MutableList<UsageReference>>,
        inUseNames: MutableSet<String>
    ) {
        try {
            val lines = Files.readAllLines(filePath)
            for ((lineIndex, line) in lines.withIndex()) {
                val lineLower = line.lowercase()
                for ((variant, originalName) in nameVariants) {
                    if (lineLower.contains(variant)) {
                        inUseNames.add(originalName)
                        usageMap.getOrPut(originalName) { mutableListOf() }.add(
                            UsageReference(
                                filePath = filePath.toString(),
                                line = lineIndex + 1,
                                text = line.trim()
                            )
                        )
                    }
                }
            }
        } catch (_: Exception) {
            // Skip unreadable files
        }
    }
}
