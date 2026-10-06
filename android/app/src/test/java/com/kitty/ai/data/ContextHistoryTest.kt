package com.kitty.ai.data

import org.junit.Assert.*
import org.junit.Test

class ContextHistoryTest {
    private fun message(id:String, role:String="assistant", text:String="reply", cid:String="a") = ChatMessage(id,cid,role,text,1,request_id=id)
    @Test fun exportPreservesOtherChatsAndNewerLocalText() {
        val local=LocalSnapshot(messages=listOf(message("same",text="newer"),message("other",cid="b")))
        val merged=mergeExport(local,HistoryExport(messages=listOf(message("same",text="older"),message("new"))))
        assertEquals(3,merged.messages.size)
        assertEquals("newer",merged.messages.first { it.id=="same" }.text)
        assertTrue(merged.messages.any { it.conversation_id=="b" })
    }
    @Test fun repeatedExportIsIdempotentAndAddsReplyProof() {
        val local=LocalSnapshot(messages=listOf(message("same")))
        val page=HistoryExport(messages=listOf(message("same").copy(proof="receipt",questionHash="hash")))
        val merged=mergeExport(mergeExport(local,page),page)
        assertEquals(1,merged.messages.size)
        assertEquals("receipt",merged.messages.single().proof)
    }
    @Test fun recentContextExcludesOtherAccountsChatsFailuresAndRetry() {
        val messages=listOf(message("1",role="user"),message("2",cid="b"),message("3").copy(status="failed"),message("retry"),message("4",role="system"),message("5"))
        val recent=recentContext(messages,"a","retry")
        assertEquals(listOf("user","assistant"),recent.map { it.role })
    }
    @Test fun unicodeContextStaysWithinByteBudget() {
        val recent=recentContext(listOf(message("1",text="界".repeat(7000))),"a","")
        assertTrue(recent.sumOf { it.content.toByteArray(Charsets.UTF_8).size }<=6000)
    }
}
