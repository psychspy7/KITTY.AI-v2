package com.kitty.ai.data

import java.io.InputStream
import java.net.URI
import java.security.MessageDigest

object UpdateRules {
    const val MAX_BYTES = 100L * 1024 * 1024

    fun metadataValid(update: UpdateInfo, installedVersion: Long): Boolean =
        update.versionCode > installedVersion &&
            TrustedUpdates.allowed(update.url) &&
            Regex("[a-fA-F0-9]{64}").matches(update.sha256)

    fun redirectAllowed(value: String): Boolean = runCatching {
        val uri = URI(value)
        uri.scheme == "https" &&
            uri.userInfo == null &&
            uri.port == -1 &&
            uri.host in
                setOf(
                    "github.com",
                    "release-assets.githubusercontent.com",
                    "objects.githubusercontent.com",
                    "github-releases.githubusercontent.com",
                )
    }
        .getOrDefault(false)

    fun hash(stream: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(65536)
        while (true) {
            val n = stream.read(buffer)
            if (n < 0) break
            digest.update(buffer, 0, n)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun identityMatches(
        packageName: String,
        actualPackage: String,
        installedVersion: Long,
        expectedVersion: Long,
        actualVersion: Long,
        installedSigners: Set<String>,
        candidateSigners: Set<String>,
    ): Boolean =
        packageName == actualPackage &&
            expectedVersion == actualVersion &&
            actualVersion > installedVersion &&
            installedSigners.isNotEmpty() &&
            installedSigners == candidateSigners
}
