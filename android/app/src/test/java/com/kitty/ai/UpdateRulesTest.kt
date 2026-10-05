package com.kitty.ai

import com.kitty.ai.data.TrustedUpdates
import com.kitty.ai.data.UpdateInfo
import com.kitty.ai.data.UpdateRules
import org.junit.Assert.*
import org.junit.Test

class UpdateRulesTest {
    private val url =
        "https://github.com/psychspy7/KITTY.AI-v2/releases/download/v1.0.2/KITTY-AI-1.0.2.apk"

    @Test
    fun verifiesChecksumAgainstKnownVector() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            UpdateRules.hash("abc".byteInputStream()),
        )
    }

    @Test
    fun requiresNewerTrustedReleaseAndChecksum() {
        val update =
            UpdateInfo(versionCode = 3, versionName = "1.0.2", url = url, sha256 = "a".repeat(64))
        assertTrue(UpdateRules.metadataValid(update, 2))
        assertFalse(UpdateRules.metadataValid(update, 3))
        assertFalse(UpdateRules.metadataValid(update.copy(sha256 = ""), 2))
        assertFalse(UpdateRules.metadataValid(update.copy(sha256 = "z".repeat(64)), 2))
        assertFalse(UpdateRules.metadataValid(update.copy(url = "https://evil.example/a.apk"), 2))
    }

    @Test
    fun rejectsUntrustedRedirects() {
        assertTrue(
            UpdateRules.redirectAllowed(
                "https://release-assets.githubusercontent.com/asset.apk?token=temporary"
            )
        )
        listOf(
                "http://github.com/a.apk",
                "https://github.com.evil.example/a.apk",
                "https://evil.example/a.apk",
                "https://x@github.com/a.apk",
                "https://github.com:8443/a.apk",
            )
            .forEach { assertFalse(UpdateRules.redirectAllowed(it)) }
    }

    @Test
    fun requiresExactPackageVersionAndSigningCertificate() {
        fun valid(
            pkg: String = "com.kitty.ai",
            version: Long = 3,
            own: Set<String> = setOf("owner"),
            candidate: Set<String> = setOf("owner"),
        ) = UpdateRules.identityMatches("com.kitty.ai", pkg, 2, 3, version, own, candidate)
        assertTrue(valid())
        assertFalse(valid(pkg = "com.evil.app"))
        assertFalse(valid(version = 2))
        assertFalse(valid(version = 4))
        assertFalse(valid(candidate = setOf("attacker")))
        assertFalse(valid(own = emptySet(), candidate = emptySet()))
        assertFalse(valid(candidate = setOf("owner", "attacker")))
    }

    @Test
    fun rejectsAmbiguousReleasePaths() {
        listOf(
                url + "?download=1",
                url + "#fragment",
                url.replace("v1.0.2/", "v1.0.2/extra/"),
                url.replace("KITTY-AI-1.0.2.apk", "../a.apk"),
                url.replace("KITTY-AI-1.0.2.apk", "a%2fother.apk"),
                url.replace("github.com", "github.com:8443"),
            )
            .forEach { assertFalse(TrustedUpdates.allowed(it)) }
    }
}
