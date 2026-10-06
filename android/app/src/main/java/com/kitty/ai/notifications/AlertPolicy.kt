package com.kitty.ai.notifications

import com.kitty.ai.data.ChatMessage
import com.kitty.ai.data.Notice
import com.kitty.ai.data.TrustedUpdates
import com.kitty.ai.data.UpdateInfo

/** First sync establishes a baseline, so installing KITTY never replays old announcements. */
object AlertPolicy {
    fun newNotices(notices: List<Notice>, seen: Set<String>?): List<Notice> =
        if (seen == null) emptyList() else notices.filter { it.read == 0 && it.id !in seen }

    fun replyReady(message: ChatMessage, seen: Set<String>): Boolean =
        message.role == "assistant" &&
            message.status == "complete" &&
            message.text.isNotBlank() &&
            message.id !in seen

    fun updateReady(info: UpdateInfo, installed: Int, notified: Int): Boolean =
        info.versionCode > installed &&
            info.versionCode > notified &&
            info.versionName.isNotBlank() &&
            TrustedUpdates.allowed(info.url) &&
            Regex("[a-fA-F0-9]{64}").matches(info.sha256)

    fun accountMatches(expected: String?, actual: String?, active: String?): Boolean =
        !expected.isNullOrBlank() && expected == actual && expected == active
}
