package com.kitty.ai.data

import kotlinx.serialization.Serializable

@Serializable
data class ChatMessage(
    val id: String,
    val conversation_id: String,
    val role: String,
    val text: String,
    val created_at: Long,
    val status: String = "complete",
    val request_id: String = "",
    val proof: String = "",
    val questionHash: String = "",
)

@Serializable
data class Conversation(
    val id: String,
    val title: String,
    val updated_at: Long,
    val uid: String = "",
)

@Serializable data class Memory(val id: String, val text: String, val updated_at: Long = 0)

@Serializable
data class Notice(
    val id: String,
    val title: String,
    val body: String,
    val created_at: Long,
    val read: Int = 0,
)

@Serializable
data class UpdateInfo(
    val versionCode: Int = 1,
    val versionName: String = "1.0.0",
    val url: String = "",
    val sha256: String = "",
    val notes: String = "",
)

@Serializable data class Consent(val consent: Boolean = false)

@Serializable
data class Identity(
    val uid: String,
    val email: String,
    val admin: Boolean = false,
    val activationPending: Boolean = false,
)

@Serializable data class SpeechAudio(val data: String, val mimeType: String)

@Serializable
data class ChatRequest(val requestId: String, val conversationId: String, val text: String, val context: List<RecentMessage> = emptyList())

@Serializable data class RecentMessage(val role:String, val content:String)
@Serializable data class ReplyReceipt(val proof:String="", val questionHash:String="")
@Serializable data class ReplyAck(val requestId:String)
@Serializable data class HistoryAck(val token:String)
@Serializable data class HistoryExport(val token:String="", val conversations:List<Conversation> = emptyList(), val messages:List<ChatMessage> = emptyList(), val next:Int? = null, val complete:Boolean=false)
@Serializable data class ContextSummary(val facts:List<String> = emptyList(), val goals:List<String> = emptyList(), val topic:String="")
@Serializable data class SavedContext(val conversationId:String, val revision:Long, val summary:ContextSummary)
@Serializable data class VerifiedReply(val messageId:String, val text:String, val questionHash:String, val proof:String)
@Serializable data class SharedReply(val messageId:String,val conversationId:String,val question:String,val text:String,val questionHash:String,val proof:String)

@Serializable data class MemoryRequest(val id: String, val text: String)

@Serializable data class MessageRequest(val messageId: String)

@Serializable data class NoticeRead(val id: String)

@Serializable
data class LocalSnapshot(
    val conversations: List<Conversation> = emptyList(),
    val messages: List<ChatMessage> = emptyList(),
    val memories: List<Memory> = emptyList(),
    val notices: List<Notice> = emptyList(),
    val consent: Boolean = false,
    val deviceSpeech: Boolean = true,
    val historyMigrated: Boolean = false,
    val usageInsights: Boolean = false,
)
