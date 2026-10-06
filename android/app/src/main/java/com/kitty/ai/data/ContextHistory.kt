package com.kitty.ai.data

/** Merge an upgrade export without discarding newer local replies or another chat. */
fun mergeExport(local: LocalSnapshot, page: HistoryExport): LocalSnapshot {
    val messages = (page.messages + local.messages).groupBy { it.id }.map { (_, versions) ->
        val current = versions.last()
        val exported = versions.first()
        if (current.text == exported.text && current.proof.isEmpty())
            current.copy(proof = exported.proof, questionHash = exported.questionHash)
        else current
    }.sortedBy { it.created_at }
    return local.copy(
        conversations = (page.conversations + local.conversations).associateBy { it.id }.values.sortedByDescending { it.updated_at },
        messages = messages,
    )
}

fun recentContext(messages: List<ChatMessage>, conversation: String, request: String): List<RecentMessage> {
    var remaining = 6000
    return messages.filter { it.conversation_id == conversation && it.request_id != request && it.status == "complete" && it.role in listOf("user", "assistant") }
        .takeLast(16).asReversed().mapNotNull {
            var text = it.text.takeLast(remaining.coerceAtLeast(0))
            while (text.toByteArray(Charsets.UTF_8).size > remaining) text = text.drop(1)
            remaining -= text.toByteArray(Charsets.UTF_8).size
            if (text.isEmpty()) null else RecentMessage(it.role, text)
        }.asReversed()
}
