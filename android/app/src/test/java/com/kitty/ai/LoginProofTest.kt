package com.kitty.ai

import com.kitty.ai.auth.LoginProof
import org.junit.Assert.*
import org.junit.Test

class LoginProofTest {
    @Test
    fun matchesRfc7636Challenge() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            LoginProof.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
    }

    @Test
    fun createsIndependentUrlSafePrivateProofs() {
        val first = LoginProof.newVerifier()
        val second = LoginProof.newVerifier()
        assertTrue(Regex("[A-Za-z0-9_-]{43}").matches(first))
        assertNotEquals(first, second)
        assertNotEquals(first, LoginProof.challenge(first))
    }
}
