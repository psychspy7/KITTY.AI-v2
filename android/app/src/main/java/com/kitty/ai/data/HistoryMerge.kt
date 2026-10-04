package com.kitty.ai.data

/** Keep interrupted local attempts that never reached the server, without duplicating replays. */
fun mergeHistory(
    local: LocalSnapshot,
    conversations: List<Conversation>,
    messages: List<ChatMessage>,
    selected: String,
): LocalSnapshot {
    val remoteRequests = messages.map { it.request_id }.toSet()
    val unsyncedRequests =
        local.messages
            .filter {
                it.conversation_id == selected &&
                    it.role == "assistant" &&
                    it.status in setOf("failed", "cancelled") &&
                    it.request_id !in remoteRequests
            }
            .map { it.request_id }
            .toSet()
    val retained =
        local.messages.filter {
            it.conversation_id == selected && it.request_id in unsyncedRequests
        }
    val remoteIds = conversations.map { it.id }.toSet()
    val failedConversations =
        local.messages
            .filter {
                it.role == "assistant" && it.status in setOf("failed", "cancelled")
            }
            .map { it.conversation_id }
            .toSet()
    val unsyncedConversations =
        local.conversations.filter {
            it.id !in remoteIds && it.id in failedConversations
        }
    return local.copy(
        conversations =
            (conversations + unsyncedConversations).sortedByDescending { it.updated_at },
        messages =
            local.messages.filter { it.conversation_id != selected } +
                (messages + retained).sortedBy { it.created_at },
    )
}
