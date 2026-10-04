package com.kitty.ai.data

import java.net.URI

object TrustedUpdates {
    fun allowed(value: String): Boolean = runCatching {
        val url = URI(value)
        url.scheme == "https" &&
            url.host == "github.com" &&
            url.userInfo == null &&
            url.path.startsWith("/psychspy7/KITTY.AI-v2/releases/download/") &&
            url.path.endsWith(".apk")
    }.getOrDefault(false)
}
