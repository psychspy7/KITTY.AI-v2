package com.kitty.ai.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

object LoginProof {
    fun newVerifier(): String = encode(ByteArray(32).also { SecureRandom().nextBytes(it) })

    fun challenge(verifier: String): String =
        encode(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    private fun encode(bytes: ByteArray): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}
