package com.adlaws.aiskillsmanager.services

import com.adlaws.aiskillsmanager.model.*
import com.google.gson.Gson
import com.google.gson.JsonParser
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.time.LocalDate
import java.util.Base64
import java.util.concurrent.TimeUnit

/**
 * Contribution Service – push local changes back to the source GitHub repository.
 *
 * Mirrors the VS Code extension's `contributionService.ts`:
 * 1. Verify source repo metadata
 * 2. Read local file(s) from disk
 * 3. Verify push access
 * 4. Create branch via GitHub API
 * 5. Commit changed file(s)
 * 6. Create a pull request
 *
 * Single-file resources use the Contents API (PUT).
 * Multi-file resources (skills) use the Git Data API (blobs → tree → commit).
 */
class ContributionService(private val project: Project) {

    companion object {
        private val LOG = Logger.getInstance(ContributionService::class.java)
        private const val API_URL = "https://api.github.com"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        fun getInstance(project: Project): ContributionService =
            project.getService(ContributionService::class.java)
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()

    /**
     * Check whether a resource has source metadata and can propose changes.
     */
    fun canProposeChanges(resource: InstalledResource, metadata: InstallMetadata?): Boolean {
        if (metadata != null && metadata.sourceRepo.isNotBlank()) return true
        return resource.sourceRepo?.isNotBlank() == true
    }

    /**
     * Get the GitHub token for write operations.
     * Uses the configured token from settings.
     */
    fun getWriteToken(): String? {
        val settings = SettingsService.getInstance()
        val token = settings.getGithubToken()
        return if (token.isNotBlank()) token else null
    }

    /**
     * Check if the authenticated user has push access to a repository.
     */
    fun checkPushAccess(token: String, owner: String, repo: String): Boolean {
        val request = Request.Builder()
            .url("$API_URL/repos/$owner/$repo")
            .headers(authHeaders(token))
            .build()

        return try {
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) return false
            val body = response.body?.string() ?: return false
            val json = JsonParser.parseString(body).asJsonObject
            val perms = json.getAsJsonObject("permissions") ?: return false
            perms.get("push")?.asBoolean == true
        } catch (e: Exception) {
            LOG.warn("checkPushAccess failed: ${e.message}")
            false
        }
    }

    /**
     * Get the HEAD commit SHA of a branch.
     */
    fun getBranchHeadSha(token: String, owner: String, repo: String, branch: String): String? {
        val request = Request.Builder()
            .url("$API_URL/repos/$owner/$repo/git/ref/heads/$branch")
            .headers(authHeaders(token))
            .build()

        return try {
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) return null
            val body = response.body?.string() ?: return null
            val json = JsonParser.parseString(body).asJsonObject
            json.getAsJsonObject("object")?.get("sha")?.asString
        } catch (e: Exception) {
            LOG.warn("getBranchHeadSha failed: ${e.message}")
            null
        }
    }

    /**
     * Create a new branch from a base commit SHA.
     */
    fun createBranch(token: String, owner: String, repo: String, branchName: String, baseSha: String): Boolean {
        val payload = gson.toJson(mapOf(
            "ref" to "refs/heads/$branchName",
            "sha" to baseSha
        ))

        val request = Request.Builder()
            .url("$API_URL/repos/$owner/$repo/git/refs")
            .headers(authHeaders(token))
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()

        return try {
            val response = client.newCall(request).execute()
            response.isSuccessful || response.code == 201
        } catch (e: Exception) {
            LOG.warn("createBranch failed: ${e.message}")
            false
        }
    }

    /**
     * Commit a single file using the Contents API (PUT).
     */
    fun commitSingleFile(
        token: String, owner: String, repo: String, branch: String,
        filePath: String, content: String, commitMessage: String
    ): Boolean {
        val existingSha = getFileSha(token, owner, repo, branch, filePath)

        val payloadMap = mutableMapOf<String, Any>(
            "message" to commitMessage,
            "content" to Base64.getEncoder().encodeToString(content.toByteArray()),
            "branch" to branch
        )
        if (existingSha != null) {
            payloadMap["sha"] = existingSha
        }

        val request = Request.Builder()
            .url("$API_URL/repos/$owner/$repo/contents/$filePath")
            .headers(authHeaders(token))
            .put(gson.toJson(payloadMap).toRequestBody(JSON_MEDIA_TYPE))
            .build()

        return try {
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                LOG.warn("commitSingleFile failed for $filePath: ${response.code} ${response.body?.string()}")
            }
            response.isSuccessful
        } catch (e: Exception) {
            LOG.warn("commitSingleFile exception: ${e.message}")
            false
        }
    }

    /**
     * Commit multiple files atomically using the Git Data API.
     * Creates blobs → tree → commit → updates the branch ref.
     */
    fun commitMultipleFiles(
        token: String, owner: String, repo: String, branch: String,
        baseSha: String, basePath: String,
        files: List<Pair<String, String>>, // (relativePath, content)
        commitMessage: String
    ): Boolean {
        try {
            // 1. Create blobs
            val blobShas = mutableListOf<Pair<String, String>>() // (fullPath, sha)
            for ((relativePath, content) in files) {
                val blobPayload = gson.toJson(mapOf(
                    "content" to Base64.getEncoder().encodeToString(content.toByteArray()),
                    "encoding" to "base64"
                ))
                val blobRequest = Request.Builder()
                    .url("$API_URL/repos/$owner/$repo/git/blobs")
                    .headers(authHeaders(token))
                    .post(blobPayload.toRequestBody(JSON_MEDIA_TYPE))
                    .build()
                val blobResponse = client.newCall(blobRequest).execute()
                if (!blobResponse.isSuccessful) {
                    LOG.warn("Failed to create blob for $relativePath")
                    return false
                }
                val blobJson = JsonParser.parseString(blobResponse.body?.string()).asJsonObject
                val sha = blobJson.get("sha").asString
                blobShas.add("$basePath/$relativePath" to sha)
            }

            // 2. Get the base tree SHA
            val commitRequest = Request.Builder()
                .url("$API_URL/repos/$owner/$repo/git/commits/$baseSha")
                .headers(authHeaders(token))
                .build()
            val commitResponse = client.newCall(commitRequest).execute()
            if (!commitResponse.isSuccessful) return false
            val commitJson = JsonParser.parseString(commitResponse.body?.string()).asJsonObject
            val baseTreeSha = commitJson.getAsJsonObject("tree").get("sha").asString

            // 3. Create new tree
            val treeItems = blobShas.map { (path, sha) ->
                mapOf("path" to path, "mode" to "100644", "type" to "blob", "sha" to sha)
            }
            val treePayload = gson.toJson(mapOf(
                "base_tree" to baseTreeSha,
                "tree" to treeItems
            ))
            val treeRequest = Request.Builder()
                .url("$API_URL/repos/$owner/$repo/git/trees")
                .headers(authHeaders(token))
                .post(treePayload.toRequestBody(JSON_MEDIA_TYPE))
                .build()
            val treeResponse = client.newCall(treeRequest).execute()
            if (!treeResponse.isSuccessful) return false
            val newTreeSha = JsonParser.parseString(treeResponse.body?.string()).asJsonObject.get("sha").asString

            // 4. Create commit
            val newCommitPayload = gson.toJson(mapOf(
                "message" to commitMessage,
                "tree" to newTreeSha,
                "parents" to listOf(baseSha)
            ))
            val newCommitRequest = Request.Builder()
                .url("$API_URL/repos/$owner/$repo/git/commits")
                .headers(authHeaders(token))
                .post(newCommitPayload.toRequestBody(JSON_MEDIA_TYPE))
                .build()
            val newCommitResponse = client.newCall(newCommitRequest).execute()
            if (!newCommitResponse.isSuccessful) return false
            val newCommitSha = JsonParser.parseString(newCommitResponse.body?.string()).asJsonObject.get("sha").asString

            // 5. Update branch ref
            val refPayload = gson.toJson(mapOf("sha" to newCommitSha))
            val refRequest = Request.Builder()
                .url("$API_URL/repos/$owner/$repo/git/refs/heads/$branch")
                .headers(authHeaders(token))
                .patch(refPayload.toRequestBody(JSON_MEDIA_TYPE))
                .build()
            val refResponse = client.newCall(refRequest).execute()
            return refResponse.isSuccessful

        } catch (e: Exception) {
            LOG.warn("commitMultipleFiles failed: ${e.message}", e)
            return false
        }
    }

    /**
     * Create a pull request.
     * Returns (prNumber, prUrl) or null on failure.
     */
    fun createPullRequest(
        token: String, owner: String, repo: String,
        head: String, base: String, title: String, body: String
    ): Pair<Int, String>? {
        val payload = gson.toJson(mapOf(
            "title" to title,
            "body" to body,
            "head" to head,
            "base" to base
        ))

        val request = Request.Builder()
            .url("$API_URL/repos/$owner/$repo/pulls")
            .headers(authHeaders(token))
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()

        return try {
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                LOG.warn("createPullRequest failed: ${response.code} ${response.body?.string()}")
                return null
            }
            val json = JsonParser.parseString(response.body?.string()).asJsonObject
            val prNumber = json.get("number").asInt
            val prUrl = json.get("html_url").asString
            prNumber to prUrl
        } catch (e: Exception) {
            LOG.warn("createPullRequest failed: ${e.message}")
            null
        }
    }

    /**
     * Read local files for a resource.
     * Skills are multi-file (recursive), others are single file.
     */
    fun readLocalFiles(resource: InstalledResource): List<Pair<String, String>> {
        val path = Paths.get(resource.path)
        if (!Files.exists(path)) return emptyList()

        return if (Files.isDirectory(path)) {
            readSkillFiles(path)
        } else {
            try {
                listOf(path.fileName.toString() to Files.readString(path))
            } catch (_: Exception) {
                emptyList()
            }
        }
    }

    /**
     * Recursively read files from a skill directory.
     */
    private fun readSkillFiles(dir: Path, basePath: String = ""): List<Pair<String, String>> {
        val files = mutableListOf<Pair<String, String>>()
        try {
            Files.list(dir).use { stream ->
                stream.forEach { entry ->
                    val name = entry.fileName.toString()
                    if (name == ".ai-skills-meta.json") return@forEach

                    val relativePath = if (basePath.isEmpty()) name else "$basePath/$name"
                    if (Files.isRegularFile(entry)) {
                        try {
                            files.add(relativePath to Files.readString(entry))
                        } catch (_: Exception) { /* skip unreadable */ }
                    } else if (Files.isDirectory(entry)) {
                        files.addAll(readSkillFiles(entry, relativePath))
                    }
                }
            }
        } catch (_: Exception) { /* directory unreadable */ }
        return files
    }

    /**
     * Generate a branch name from the resource metadata.
     */
    fun generateBranchName(resource: InstalledResource): String {
        val sanitized = resource.name.lowercase()
            .replace(Regex("[^a-z0-9-]"), "-")
            .replace(Regex("-+"), "-")
            .trim('-')
        val date = LocalDate.now().toString()
        return "ai-skills-manager/${resource.category.id}/$sanitized/$date"
    }

    /**
     * Parse sourceRepo string (\"owner/repo\") into owner + repo.
     */
    fun parseSourceRepo(sourceRepoStr: String): Pair<String, String>? {
        val parts = sourceRepoStr.split("/")
        return if (parts.size == 2 && parts[0].isNotBlank() && parts[1].isNotBlank()) {
            parts[0] to parts[1]
        } else null
    }

    // ---- Private helpers ----

    private fun getFileSha(token: String, owner: String, repo: String, branch: String, filePath: String): String? {
        val request = Request.Builder()
            .url("$API_URL/repos/$owner/$repo/contents/$filePath?ref=$branch")
            .headers(authHeaders(token))
            .build()

        return try {
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) return null
            val json = JsonParser.parseString(response.body?.string()).asJsonObject
            json.get("sha")?.asString
        } catch (_: Exception) {
            null
        }
    }

    private fun authHeaders(token: String): okhttp3.Headers {
        return okhttp3.Headers.Builder()
            .add("Accept", "application/vnd.github.v3+json")
            .add("Authorization", "Bearer $token")
            .add("User-Agent", "IntelliJ-AI-Skills-Manager")
            .add("Content-Type", "application/json")
            .build()
    }
}
