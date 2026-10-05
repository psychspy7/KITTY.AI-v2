package com.kitty.ai

import com.kitty.ai.data.TrustedUpdates
import org.junit.Assert.*
import org.junit.Test

class TrustedUpdatesTest {
    @Test
    fun acceptsOnlyThePinnedKittyDownloadHostAndPath() {
        assertTrue(
            TrustedUpdates.allowed(
                "https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.0.3.apk"
            )
        )
        listOf(
                "https://evil.kitty-ai.workers.dev/downloads/KITTY-AI-1.0.3.apk",
                "https://kitty-ai-v2.kitty-ai.workers.dev/elsewhere/KITTY-AI-1.0.3.apk",
                "https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.0.3.apk?other=1",
            )
            .forEach { assertFalse(TrustedUpdates.allowed(it)) }
    }

    @Test
    fun acceptsOwnerRelease() {
        assertTrue(
            TrustedUpdates.allowed(
                "https://github.com/psychspy7/KITTY.AI-v2/releases/download/v1.0.1/kitty.apk"
            )
        )
    }

    @Test
    fun rejectsOtherRepoAndCredentials() {
        assertFalse(
            TrustedUpdates.allowed("https://github.com/attacker/kitty/releases/download/v1/a.apk")
        )
        assertFalse(
            TrustedUpdates.allowed(
                "https://github.com@evil.example/psychspy7/KITTY.AI-v2/releases/download/v1/a.apk"
            )
        )
        assertFalse(
            TrustedUpdates.allowed(
                "http://github.com/psychspy7/KITTY.AI-v2/releases/download/v1/a.apk"
            )
        )
        assertFalse(
            TrustedUpdates.allowed(
                "https://github.com/psychspy7/KITTY.AI-v2/releases/download/v1/a.exe"
            )
        )
    }
}
