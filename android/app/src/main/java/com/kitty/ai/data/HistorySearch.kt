package com.kitty.ai.data

/** Pure local search: never sends history or the query to a server. */
fun matchingConversationIds(chats: List<Conversation>, messages: List<ChatMessage>, query: String): Set<String> {
    val terms = query.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(8)
    if (terms.isEmpty()) return chats.map { it.id }.toSet()
    val candidates = chats.map { it.id }.toSet()
    val found = chats.filter { chat -> terms.all { chat.title.contains(it, ignoreCase = true) } }.map { it.id }.toMutableSet()
    messages.forEach { if (it.conversation_id in candidates && terms.all { term -> it.text.contains(term, ignoreCase = true) }) found.add(it.conversation_id) }
    return found
}
