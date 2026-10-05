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
data class ChatRequest(val requestId: String, val conversationId: String, val text: String)

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
)
