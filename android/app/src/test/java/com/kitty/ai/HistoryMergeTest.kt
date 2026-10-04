package com.kitty.ai

import com.kitty.ai.data.*
import org.junit.Assert.*
import org.junit.Test

class HistoryMergeTest {
    private val question = ChatMessage("r-u", "c", "user", "Hello", 1, request_id = "r")
    private val failed = ChatMessage("r-a", "c", "assistant", "Partial", 2, "failed", "r")
    private val local =
        LocalSnapshot(
            conversations = listOf(Conversation("c", "Hello", 1)),
            messages = listOf(question, failed),
        )

    @Test
    fun preservesAttemptThatNeverReachedBackend() {
        val merged = mergeHistory(local, emptyList(), emptyList(), "c")
        assertEquals(local.messages, merged.messages)
        assertEquals(local.conversations, merged.conversations)
    }

    @Test
    fun completedReplayReplacesPartialWithoutDuplicate() {
        val completed = failed.copy(text = "Full answer", status = "complete")
        val remote = listOf(question, completed)
        val merged = mergeHistory(local, local.conversations, remote, "c")
        assertEquals(remote, merged.messages)
        assertEquals(2, merged.messages.size)
    }

    @Test
    fun keepsOtherUnsyncedConversationsDiscoverable() {
        val remote = Conversation("other", "Synced chat", 3)
        val merged = mergeHistory(local, listOf(remote), emptyList(), "other")
        assertEquals(setOf("c", "other"), merged.conversations.map { it.id }.toSet())
        assertEquals(local.messages, merged.messages)
    }
}
