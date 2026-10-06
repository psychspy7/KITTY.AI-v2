package com.kitty.ai

import com.kitty.ai.ui.markdown.*
import org.junit.Assert.*
import org.junit.Test

class MarkdownDocumentTest {
    @Test fun boldAndNestedItalicRenderWithoutDelimiters() {
        val block = MarkdownDocument.parse("A **bold and *italic*** answer.").single().content
        assertEquals("A bold and italic answer.", block.text)
        assertTrue(block.spans.any { it.style == MarkdownStyle.Bold && block.text.substring(it.start,it.end) == "bold and italic" })
        assertTrue(block.spans.any { it.style == MarkdownStyle.Italic && block.text.substring(it.start,it.end) == "italic" })
    }
    @Test fun escapedAndCodeStarsStayLiteral() {
        val code = MarkdownDocument.parse("Use `**literal**` and \\*\\*escaped\\*\\*.").single().content
        assertEquals("Use **literal** and **escaped**.", code.text)
        assertFalse(code.spans.any { it.style == MarkdownStyle.Bold })
        assertTrue(code.spans.any { it.style == MarkdownStyle.Code })
        assertEquals("**code**", MarkdownDocument.parse("```kotlin\n**code**\n```").single().content.text)
    }
    @Test fun headingsListsAndTablesHaveNativeStructure() {
        val blocks = MarkdownDocument.parse("## Plan\n\n7. First\n8. Second\n\n| Name | Value |\n| --- | --- |\n| **A** | B |")
        assertEquals(2, blocks.first().heading)
        assertTrue(blocks.any { it.content.text == "7. First" })
        assertEquals(2, blocks.last().table.size)
        assertEquals("A", blocks.last().table[1][0].text)
    }
    @Test fun linksCannotInvokeIntentsAndImagesDoNotFetch() {
        val unsafe = MarkdownDocument.parse("[Open](javascript:alert(1)) ![Cat](https://example.com/private.png)").single().content
        assertFalse(unsafe.spans.any { it.style == MarkdownStyle.Link })
        assertEquals("Open Cat", unsafe.text)
        assertTrue(MarkdownDocument.safeLink("https://example.com/page"))
        assertFalse(MarkdownDocument.safeLink("intent://login"))
        assertFalse(MarkdownDocument.safeLink("https://user:password@example.com"))
    }
    @Test fun incrementalIncompleteMarkdownBecomesFormattedAtCompletion() {
        assertEquals("**Hel", MarkdownDocument.parse("**Hel").single().content.text)
        val complete = MarkdownDocument.parse("**Hello**").single().content
        assertEquals("Hello", complete.text)
        assertEquals(MarkdownStyle.Bold, complete.spans.single().style)
    }
}
