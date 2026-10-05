package com.kitty.ai.data

import java.net.URI

object TrustedUpdates {
    fun allowed(value: String): Boolean = runCatching {
        val url = URI(value)
        url.scheme == "https" &&
            url.userInfo == null &&
            url.port == -1 &&
            url.rawQuery == null &&
            url.rawFragment == null &&
            ((url.host == "kitty-ai-v2.kitty-ai.workers.dev" &&
                Regex("/downloads/KITTY-AI-[0-9]+(?:\\.[0-9]+){1,3}\\.apk").matches(url.rawPath)) ||
                (url.host == "github.com" &&
                    Regex(
                            "/psychspy7/KITTY\\.AI-v2/releases/download/[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*\\.apk"
                        )
                        .matches(url.rawPath)))
    }
        .getOrDefault(false)
}
