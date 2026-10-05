package com.kitty.ai

import com.kitty.ai.data.ReplyEvents
import org.junit.Assert.*
import org.junit.Test

class ReplyEventsTest {
    @Test
    fun multilineJsonAndCommentsStayInOneEvent() {
        val decoder = ReplyEvents()
        assertNull(decoder.line("event: delta"))
        assertNull(decoder.line(": heartbeat"))
        assertNull(decoder.line("data: {"))
        assertNull(decoder.line("data: \"text\":\"hi\"}"))
        assertEquals("{\n\"text\":\"hi\"}", decoder.line("")?.data)
    }

    @Test
    fun doneDispatchesOnceAtBoundary() {
        val decoder = ReplyEvents()
        decoder.line("event:done")
        decoder.line("data:{}")
        assertEquals("done", decoder.line("")?.type)
        assertNull(decoder.line(""))
        decoder.line("data: next")
        assertEquals("delta", decoder.line("")?.type)
    }

    @Test
    fun heartbeatCannotCompleteAReply() {
        val decoder = ReplyEvents()
        decoder.line(": ping")
        assertNull(decoder.line(""))
    }

    @Test(expected = IllegalStateException::class)
    fun oversizedEventIsRejected() {
        ReplyEvents().line("data:" + "a".repeat(262145))
    }
}
