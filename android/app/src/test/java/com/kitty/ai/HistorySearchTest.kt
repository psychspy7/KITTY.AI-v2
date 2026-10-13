package com.kitty.ai
import com.kitty.ai.data.*
import org.junit.Assert.*
import org.junit.Test
class HistorySearchTest {
 @Test fun matchesTitleOrBodyButNeverOrphanedMessages() {
  val chats=listOf(Conversation("a","My day",1),Conversation("b","Reading",2))
  val messages=listOf(ChatMessage("1","b","assistant","Plan a quiet weekend",1),ChatMessage("2","foreign","user","weekend",1))
  assertEquals(setOf("b"),matchingConversationIds(chats,messages," QUIET weekend "))
  assertEquals(setOf("a"),matchingConversationIds(chats,messages,"MY DAY"))
  assertEquals(setOf("a","b"),matchingConversationIds(chats,messages,""))
 }
}
