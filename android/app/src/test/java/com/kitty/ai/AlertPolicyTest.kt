package com.kitty.ai

import com.kitty.ai.data.ChatMessage
import com.kitty.ai.data.Notice
import com.kitty.ai.data.UpdateInfo
import com.kitty.ai.notifications.AlertPolicy
import org.junit.Assert.*
import org.junit.Test

class AlertPolicyTest {
    private val old = Notice("old", "News", "Old notice", 1)
    private val unread = Notice("new", "News", "New notice", 2)
    private val reply = ChatMessage("reply", "chat", "assistant", "Hello Sir", 3)
    private val release =
        UpdateInfo(
            7,
            "1.5.2",
            "https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.5.2.apk",
            "a".repeat(64),
        )

    @Test
    fun installBaselinesHistoricalNotices() {
        assertTrue(AlertPolicy.newNotices(listOf(old, unread), null).isEmpty())
        assertEquals(listOf(unread), AlertPolicy.newNotices(listOf(unread), emptySet()))
    }

    @Test
    fun resyncDoesNotReplayReadOrPreviouslySeenNotices() {
        assertEquals(
            listOf(unread),
            AlertPolicy.newNotices(
                listOf(old, unread, unread.copy(id = "read", read = 1)),
                setOf("old"),
            ),
        )
        assertTrue(AlertPolicy.newNotices(listOf(old, unread), setOf("old", "new")).isEmpty())
    }

    @Test
    fun onlyCompletedVisibleRepliesAlertOnce() {
        assertTrue(AlertPolicy.replyReady(reply, emptySet()))
        assertFalse(AlertPolicy.replyReady(reply, setOf("reply")))
        for (status in listOf("streaming", "failed", "cancelled")) assertFalse(
            AlertPolicy.replyReady(reply.copy(status = status), emptySet())
        )
        assertFalse(AlertPolicy.replyReady(reply.copy(text = " "), emptySet()))
        assertFalse(AlertPolicy.replyReady(reply.copy(role = "user"), emptySet()))
    }

    @Test
    fun updateMustBeNewTrustedAndNotAlreadyAnnounced() {
        assertTrue(AlertPolicy.updateReady(release, 6, 0))
        assertFalse(AlertPolicy.updateReady(release, 7, 0))
        assertFalse(AlertPolicy.updateReady(release, 6, 7))
        assertFalse(AlertPolicy.updateReady(release.copy(sha256 = "bad"), 6, 0))
        assertFalse(
            AlertPolicy.updateReady(release.copy(url = "https://evil.example/app.apk"), 6, 0)
        )
        assertFalse(
            AlertPolicy.updateReady(
                release.copy(url = "http://kitty-ai-v2.kitty-ai.workers.dev/downloads/app.apk"),
                6,
                0,
            )
        )
    }

    @Test
    fun signOutAndAccountSwitchFenceDelayedAlerts() {
        assertTrue(AlertPolicy.accountMatches("a", "a", "a"))
        assertFalse(AlertPolicy.accountMatches("a", "b", "a"))
        assertFalse(AlertPolicy.accountMatches("a", "a", "b"))
        assertFalse(AlertPolicy.accountMatches("a", null, "a"))
        assertFalse(AlertPolicy.accountMatches(null, null, null))
        assertFalse(AlertPolicy.accountMatches("", "", ""))
    }
}
