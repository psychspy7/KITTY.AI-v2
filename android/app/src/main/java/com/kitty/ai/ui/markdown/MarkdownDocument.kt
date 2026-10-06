package com.kitty.ai.ui.markdown

import java.net.URI
import org.commonmark.node.*
import org.commonmark.parser.Parser
import org.commonmark.ext.gfm.tables.*
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension

enum class MarkdownStyle { Bold, Italic, Code, Strike, Link }
data class MarkdownSpan(val start: Int, val end: Int, val style: MarkdownStyle, val value: String = "")
data class MarkdownText(val text: String, val spans: List<MarkdownSpan> = emptyList())
data class MarkdownBlock(val content: MarkdownText = MarkdownText(""), val heading: Int = 0,
    val code: Boolean = false, val quote: Boolean = false, val divider: Boolean = false,
    val table: List<List<MarkdownText>> = emptyList())

/** Native text model: HTML never executes, images never load, and links cannot invoke app schemes. */
object MarkdownDocument {
    private val parser = Parser.builder().extensions(listOf(TablesExtension.create(), StrikethroughExtension.create())).build()
    fun safeLink(value: String): Boolean = runCatching {
        val uri = URI(value)
        uri.scheme?.lowercase() in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null
    }.getOrDefault(false)

    fun parse(source: String): List<MarkdownBlock> {
        val result = mutableListOf<MarkdownBlock>()
        fun blocks(node: Node, depth: Int = 0, prefix: String = "", quoted: Boolean = false) {
            if (depth > 16) return
            when (node) {
                is Paragraph -> result += MarkdownBlock(inline(node, prefix), quote = quoted)
                is Heading -> result += MarkdownBlock(inline(node, prefix), heading = node.level, quote = quoted)
                is FencedCodeBlock -> result += MarkdownBlock(MarkdownText(node.literal.trimEnd('\n')), code = true, quote = quoted)
                is IndentedCodeBlock -> result += MarkdownBlock(MarkdownText(node.literal.trimEnd('\n')), code = true, quote = quoted)
                is HtmlBlock -> result += MarkdownBlock(MarkdownText(node.literal), quote = quoted)
                is ThematicBreak -> result += MarkdownBlock(divider = true)
                is BlockQuote -> children(node).forEach { blocks(it, depth + 1, prefix, true) }
                is BulletList, is OrderedList -> {
                    var number = if (node is OrderedList) node.markerStartNumber ?: 1 else 1
                    children(node).forEach { item ->
                        val marker = if (node is OrderedList) "${number++}. " else "• "
                        children(item).forEachIndexed { index, child ->
                            blocks(child, depth + 1, "  ".repeat(depth.coerceAtMost(6)) + if (index == 0) marker else "  ", quoted)
                        }
                    }
                }
                is TableBlock -> {
                    val rows = children(node).flatMap { section -> children(section).toList() }
                        .take(100).map { row -> children(row).take(12).map { inline(it) }.toList() }.toList()
                    result += MarkdownBlock(table = rows)
                }
                else -> children(node).forEach { blocks(it, depth, prefix, quoted) }
            }
        }
        blocks(parser.parse(source.take(32000)))
        return result
    }

    private fun children(node: Node): Sequence<Node> = sequence {
        var child = node.firstChild
        while (child != null) { yield(child); child = child.next }
    }

    private fun inline(node: Node, prefix: String = ""): MarkdownText {
        val text = StringBuilder(prefix)
        val spans = mutableListOf<MarkdownSpan>()
        fun visit(current: Node, depth: Int = 0) {
            if (depth > 32) return
            val start = text.length
            when (current) {
                is Text -> text.append(current.literal)
                is Code -> text.append(current.literal)
                is SoftLineBreak, is HardLineBreak -> text.append('\n')
                is HtmlInline -> text.append(current.literal)
                else -> children(current).forEach { visit(it, depth + 1) }
            }
            val style = when (current) {
                is StrongEmphasis -> MarkdownStyle.Bold
                is Emphasis -> MarkdownStyle.Italic
                is Code -> MarkdownStyle.Code
                is Strikethrough -> MarkdownStyle.Strike
                is Link -> if (safeLink(current.destination)) MarkdownStyle.Link else null
                else -> null
            }
            if (style != null && start < text.length) spans += MarkdownSpan(start, text.length, style, if (current is Link) current.destination else "")
        }
        children(node).forEach { visit(it) }
        return MarkdownText(text.toString(), spans)
    }
}
