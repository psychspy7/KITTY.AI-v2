package com.kitty.ai.data

import java.net.URI

object TrustedUpdates {
    fun allowed(value: String): Boolean = runCatching {
        val url = URI(value)
        url.scheme == "https" &&
            url.host == "github.com" &&
            url.userInfo == null &&
            url.port == -1 &&
            url.rawQuery == null &&
            url.rawFragment == null &&
            Regex(
                    "/psychspy7/KITTY\\.AI-v2/releases/download/[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*\\.apk"
                )
                .matches(url.rawPath)
    }
        .getOrDefault(false)
}
