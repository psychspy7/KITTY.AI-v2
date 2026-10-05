package com.kitty.ai.data

data class ReplyEvent(val type: String, val data: String)

/** SSE comments are heartbeats; an event is dispatched only at its blank-line boundary. */
class ReplyEvents {
    private var type = "delta"
    private val data = mutableListOf<String>()
    private var size = 0

    fun line(line: String): ReplyEvent? {
        if (line.isEmpty()) {
            val result = if (data.isEmpty()) null else ReplyEvent(type, data.joinToString("\n"))
            type = "delta"
            data.clear()
            size = 0
            return result
        }
        if (line.startsWith(":")) return null
        val field = line.substringBefore(':')
        val value = line.substringAfter(':', "").removePrefix(" ")
        when (field) {
            "event" -> type = value
            "data" -> {
                size += value.length
                check(size <= 262144) { "Reply event is too large." }
                data.add(value)
            }
        }
        return null
    }
}
