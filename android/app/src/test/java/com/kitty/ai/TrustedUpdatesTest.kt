package com.kitty.ai

import com.kitty.ai.data.TrustedUpdates
import org.junit.Assert.*
import org.junit.Test

class TrustedUpdatesTest {
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
