package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.*
import com.google.gson.JsonParser
import com.intellij.openapi.diagnostic.Logger
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/**
 * GitHub API client for fetching resources from configured repositories.
 *
 * Mirrors the VS Code extension's `resourceClient.ts`:
 * - Full repos use the Contents API to list category folders
 * - Skills repos (with skillsPath) use the Git Trees API for recursive scanning
 * - Raw content fetched from raw.githubusercontent.com
 * - In-memory cache with configurable TTL
 * - SHA fetching for update detection
 * - Tag extraction from YAML frontmatter
 */
class ResourceClient {

    private val LOG = Logger.getInstance(ResourceClient::class.java)

    // Thread pool for parallel HTTP requests (mirrors VS Code's Promise.all/allSettled)
    private val executor = Executors.newFixedThreadPool(8)

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    // Simple in-memory cache: key → (data, timestamp)
    private val cache = ConcurrentHashMap<String, Pair<Any, Long>>()
    private var cacheTtlMs: Long = 3600_000 // default 1 hour

    /**
     * Sync settings from SettingsService (token + cache TTL).
     */
    fun syncSettings() {
        try {
            val settings = SettingsService.getInstance()
            githubToken = settings.getGithubToken().ifBlank { null }
            cacheTtlMs = settings.getCacheTimeout().toLong() * 1000
        } catch (_: Exception) {
            // Service may not be available in tests
        }
    }

    /**
     * GitHub personal access token for authenticated requests.
     */
    var githubToken: String? = null

    /**
     * Fetch all resources from all enabled repos.
     * Returns a map of repoKey → (category → items), plus a set of failed repo keys.
     */
    fun fetchAllResources(): Pair<Map<String, Map<ResourceCategory, List<ResourceItem>>>, Set<String>> {
        syncSettings()
        val settings = SettingsService.getInstance()
        val repos = settings.getRepositories().filter { it.enabled }
        LOG.info("fetchAllResources: ${repos.size} enabled repos: ${repos.map { it.key }}")
        val results = ConcurrentHashMap<String, Map<ResourceCategory, List<ResourceItem>>>()
        val failed = ConcurrentHashMap.newKeySet<String>()

        // Fetch all repos in parallel
        val futures = repos.map { repo ->
            executor.submit {
                try {
                    LOG.info("  Fetching repo: ${repo.key} (skillsPath=${repo.skillsPath}, singleSkill=${repo.singleSkill})")
                    val data = fetchResources(repo)
                    LOG.info("  Result for ${repo.key}: ${data.size} categories, ${data.values.sumOf { it.size }} items")
                    if (data.isNotEmpty()) {
                        results[repo.key] = data
                    }
                } catch (e: Exception) {
                    LOG.warn("  FAILED repo ${repo.key}: ${e.message}", e)
                    failed.add(repo.key)
                }
            }
        }
        // Wait for all repo fetches to complete
        futures.forEach { it.get() }
        LOG.info("fetchAllResources done: ${results.size} repos loaded, ${failed.size} failed")
        return results.toMap() to failed.toSet()
    }

    /**
     * Fetch all resources from a repository, grouped by category.
     */
    fun fetchResources(repo: ResourceRepository): Map<ResourceCategory, List<ResourceItem>> {
        return if (repo.skillsPath != null) {
            fetchViaTreesApi(repo)
        } else {
            fetchViaContentsApi(repo)
        }
    }

    /**
     * Fetch a single resource's raw content.
     */
    fun fetchRawContent(owner: String, repo: String, branch: String, path: String): String? {
        val url = "https://raw.githubusercontent.com/$owner/$repo/$branch/$path"
        return httpGet(url)
    }

    /**
     * Fetch the SHA of a specific file or directory for update detection.
     */
    fun fetchResourceSha(owner: String, repo: String, branch: String, path: String): String? {
        val url = "https://api.github.com/repos/$owner/$repo/contents/$path?ref=$branch"
        val json = httpGet(url) ?: return null
        return try {
            val parsed = JsonParser.parseString(json)
            if (parsed.isJsonObject) {
                parsed.asJsonObject.get("sha")?.asString
            } else if (parsed.isJsonArray && parsed.asJsonArray.size() > 0) {
                // For directories, use the Trees API to get the tree SHA
                fetchTreeSha(owner, repo, branch, path)
            } else null
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Fetch all files in a skill folder using the Trees API.
     * Returns list of (relativePath, content) pairs.
     */
    fun fetchSkillFiles(repo: ResourceRepository, skillPath: String): List<Pair<String, String>> {
        val treeUrl = "https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${repo.branch}?recursive=1"
        val json = httpGet(treeUrl) ?: return emptyList()

        val prefix = skillPath.trimEnd('/') + "/"

        try {
            val root = JsonParser.parseString(json).asJsonObject
            val tree = root.getAsJsonArray("tree") ?: return emptyList()

            // Collect all blob paths under the skill folder
            val blobPaths = mutableListOf<Pair<String, String>>() // (relativePath, fullPath)
            for (element in tree) {
                val item = element.asJsonObject
                val itemPath = item.get("path")?.asString ?: continue
                val type = item.get("type")?.asString ?: continue

                if (type == "blob" && itemPath.startsWith(prefix)) {
                    blobPaths.add(itemPath.removePrefix(prefix) to itemPath)
                }
            }

            // Fetch all file contents in parallel (mirrors VS Code's Promise.all)
            val futures = blobPaths.map { (relativePath, fullPath) ->
                executor.submit<Pair<String, String>?> {
                    val content = fetchRawContent(repo.owner, repo.repo, repo.branch, fullPath)
                    if (content != null) relativePath to content else null
                }
            }
            return futures.mapNotNull { it.get() }
        } catch (_: Exception) {
            // Failed to parse tree
        }

        return emptyList()
    }

    /**
     * Clear the in-memory cache.
     */
    fun clearCache() {
        cache.clear()
    }

    /**
     * Clear cached data for a single repository.
     */
    fun clearCacheForRepo(repoKey: String) {
        cache.keys().toList().forEach { key ->
            if (key.contains(repoKey)) {
                cache.remove(key)
            }
        }
    }

    // ---- Private implementation ----

    private fun fetchViaContentsApi(repo: ResourceRepository): Map<ResourceCategory, List<ResourceItem>> {
        val result = ConcurrentHashMap<ResourceCategory, List<ResourceItem>>()

        // Fetch all categories in parallel (mirrors VS Code's Promise.allSettled)
        val futures = ResourceCategory.entries.map { category ->
            executor.submit {
                try {
                    val url = "https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${category.id}?ref=${repo.branch}"
                    val json = httpGet(url) ?: return@submit
                    val items = parseContentsResponse(json, repo, category)
                    if (items.isNotEmpty()) {
                        val enriched = if (category == ResourceCategory.SKILLS) {
                            enrichSkillItems(items, repo)
                        } else {
                            items
                        }
                        result[category] = enriched
                    }
                } catch (_: Exception) {
                    // Skip categories that don't exist or fail to parse
                }
            }
        }
        futures.forEach { it.get() }
        return result.toMap()
    }

    private fun fetchViaTreesApi(repo: ResourceRepository): Map<ResourceCategory, List<ResourceItem>> {
        if (repo.singleSkill) {
            return fetchSingleSkill(repo)
        }

        val url = "https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${repo.branch}?recursive=1"
        val json = httpGet(url) ?: return emptyMap()
        return parseTreeResponse(json, repo)
    }

    private fun fetchSingleSkill(repo: ResourceRepository): Map<ResourceCategory, List<ResourceItem>> {
        val skillsPath = repo.skillsPath ?: return emptyMap()
        val skillMdPath = "$skillsPath/SKILL.md"
        val content = fetchRawContent(repo.owner, repo.repo, repo.branch, skillMdPath) ?: return emptyMap()
        val meta = parseSkillMd(content)
        val skillName = meta["name"] ?: skillsPath.substringAfterLast('/')
        val item = ResourceItem(
            name = skillName,
            category = ResourceCategory.SKILLS,
            path = skillsPath,
            repoOwner = repo.owner,
            repoName = repo.repo,
            repoBranch = repo.branch,
            description = meta["description"],
            license = meta["license"],
            compatibility = meta["compatibility"],
            tags = parseTags(meta["tags"]),
            bodyContent = meta["body"],
            fullContent = content,
            isFolder = true
        )
        return mapOf(ResourceCategory.SKILLS to listOf(item))
    }

    private fun parseContentsResponse(
        json: String,
        repo: ResourceRepository,
        category: ResourceCategory
    ): List<ResourceItem> {
        val array = JsonParser.parseString(json).asJsonArray
        return array.mapNotNull { element ->
            val obj = element.asJsonObject
            val name = obj.get("name")?.asString ?: return@mapNotNull null
            val path = obj.get("path")?.asString ?: return@mapNotNull null
            val type = obj.get("type")?.asString
            val sha = obj.get("sha")?.asString
            ResourceItem(
                name = name,
                category = category,
                path = path,
                repoOwner = repo.owner,
                repoName = repo.repo,
                repoBranch = repo.branch,
                sha = sha,
                isFolder = type == "dir"
            )
        }
    }

    private fun parseTreeResponse(json: String, repo: ResourceRepository): Map<ResourceCategory, List<ResourceItem>> {
        val skillsPath = repo.skillsPath?.trimEnd('/') ?: return emptyMap()
        val result = mutableMapOf<ResourceCategory, MutableList<ResourceItem>>()

        try {
            val root = JsonParser.parseString(json).asJsonObject
            val tree = root.getAsJsonArray("tree") ?: return emptyMap()

            // Find all SKILL.md files under the skillsPath
            val skillMdPaths = mutableListOf<String>()
            for (element in tree) {
                val item = element.asJsonObject
                val itemPath = item.get("path")?.asString ?: continue
                val type = item.get("type")?.asString ?: continue

                if (type == "blob" && itemPath.startsWith("$skillsPath/") && itemPath.endsWith("/SKILL.md")) {
                    skillMdPaths.add(itemPath)
                }
            }

            // Pre-build SHA lookup map from tree (avoids repeated scans)
            val dirShaMap = mutableMapOf<String, String>()
            for (element in tree) {
                val item = element.asJsonObject
                if (item.get("type")?.asString == "tree") {
                    val path = item.get("path")?.asString ?: continue
                    val sha = item.get("sha")?.asString ?: continue
                    dirShaMap[path] = sha
                }
            }

            // Fetch all SKILL.md content in parallel (mirrors VS Code's Promise.all)
            val futures = skillMdPaths.map { skillMdPath ->
                executor.submit<ResourceItem?> {
                    try {
                        val skillDirPath = skillMdPath.removeSuffix("/SKILL.md")
                        val skillName = skillDirPath.substringAfterLast('/')
                        val content = fetchRawContent(repo.owner, repo.repo, repo.branch, skillMdPath)
                        val meta = if (content != null) parseSkillMd(content) else emptyMap()

                        ResourceItem(
                            name = meta["name"] ?: skillName,
                            category = ResourceCategory.SKILLS,
                            path = skillDirPath,
                            repoOwner = repo.owner,
                            repoName = repo.repo,
                            repoBranch = repo.branch,
                            sha = dirShaMap[skillDirPath],
                            description = meta["description"],
                            license = meta["license"],
                            compatibility = meta["compatibility"],
                            tags = parseTags(meta["tags"]),
                            bodyContent = meta["body"],
                            fullContent = content,
                            isFolder = true
                        )
                    } catch (_: Exception) {
                        null
                    }
                }
            }
            val skillItems = futures.mapNotNull { it.get() }
            if (skillItems.isNotEmpty()) {
                result.getOrPut(ResourceCategory.SKILLS) { mutableListOf() }.addAll(skillItems)
            }
        } catch (_: Exception) {
            // Failed to parse tree
        }

        return result
    }

    /**
     * Enrich skill items (directories) with metadata from SKILL.md frontmatter.
     */
    private fun enrichSkillItems(items: List<ResourceItem>, repo: ResourceRepository): List<ResourceItem> {
        // Fetch all SKILL.md files in parallel (mirrors VS Code's Promise.allSettled)
        val futures: List<Pair<ResourceItem, Future<ResourceItem>>> = items.map { item ->
            item to executor.submit<ResourceItem> {
                if (!item.isFolder) return@submit item
                val skillMdPath = "${item.path}/SKILL.md"
                val content = fetchRawContent(repo.owner, repo.repo, repo.branch, skillMdPath)
                if (content != null) {
                    val meta = parseSkillMd(content)
                    item.copy(
                        name = meta["name"] ?: item.name,
                        description = meta["description"],
                        license = meta["license"],
                        compatibility = meta["compatibility"],
                        tags = parseTags(meta["tags"]),
                        bodyContent = meta["body"],
                        fullContent = content
                    )
                } else {
                    item
                }
            }
        }
        return futures.map { (original, future) ->
            try { future.get() } catch (_: Exception) { original }
        }
    }

    /**
     * Fetch tree SHA for a directory path.
     */
    private fun fetchTreeSha(owner: String, repo: String, branch: String, path: String): String? {
        val url = "https://api.github.com/repos/$owner/$repo/git/trees/$branch?recursive=1"
        val json = httpGet(url) ?: return null
        try {
            val root = JsonParser.parseString(json).asJsonObject
            val tree = root.getAsJsonArray("tree") ?: return null
            for (element in tree) {
                val item = element.asJsonObject
                if (item.get("path")?.asString == path && item.get("type")?.asString == "tree") {
                    return item.get("sha")?.asString
                }
            }
        } catch (_: Exception) { }
        return null
    }

    /**
     * Parse SKILL.md YAML frontmatter into a property map.
     */
    internal fun parseSkillMd(content: String): Map<String, String> {
        val result = mutableMapOf<String, String>()
        val lines = content.lines()
        if (lines.isEmpty() || lines[0].trim() != "---") return result

        var endIndex = -1
        for (i in 1 until lines.size) {
            if (lines[i].trim() == "---") {
                endIndex = i
                break
            }
        }
        if (endIndex < 0) return result

        // Parse frontmatter lines
        for (i in 1 until endIndex) {
            val line = lines[i]
            val colonPos = line.indexOf(':')
            if (colonPos > 0) {
                val key = line.substring(0, colonPos).trim()
                val value = line.substring(colonPos + 1).trim().removeSurrounding("\"")
                if (value.isNotEmpty()) {
                    result[key] = value
                }
            }
        }

        // Body content after second ---
        if (endIndex + 1 < lines.size) {
            val body = lines.subList(endIndex + 1, lines.size).joinToString("\n").trim()
            if (body.isNotEmpty()) {
                result["body"] = body
            }
        }

        return result
    }

    /**
     * Parse tags from a frontmatter value (comma-separated string or YAML array notation).
     */
    private fun parseTags(tagsValue: String?): List<String> {
        if (tagsValue.isNullOrBlank()) return emptyList()
        // Handle YAML array: [tag1, tag2] or simple comma-separated
        val cleaned = tagsValue.removePrefix("[").removeSuffix("]")
        return cleaned.split(",").map { it.trim().removeSurrounding("\"") }.filter { it.isNotEmpty() }
    }

    private fun httpGet(url: String): String? {
        // Check cache
        cache[url]?.let { (data, timestamp) ->
            if (System.currentTimeMillis() - timestamp < cacheTtlMs) {
                @Suppress("UNCHECKED_CAST")
                return data as? String
            }
        }

        val requestBuilder = Request.Builder().url(url)
        githubToken?.let { token ->
            if (token.isNotBlank()) {
                requestBuilder.addHeader("Authorization", "Bearer $token")
            }
        }
        requestBuilder.addHeader("Accept", "application/vnd.github.v3+json")

        return try {
            val response = client.newCall(requestBuilder.build()).execute()
            if (response.isSuccessful) {
                val body = response.body?.string()
                body?.let { cache[url] = it to System.currentTimeMillis() }
                body
            } else {
                LOG.warn("httpGet $url returned HTTP ${response.code}: ${response.message}")
                null
            }
        } catch (e: Exception) {
            LOG.warn("httpGet $url exception: ${e.message}")
            null
        }
    }
}
