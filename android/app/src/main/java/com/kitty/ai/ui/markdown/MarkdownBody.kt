package com.kitty.ai.ui.markdown

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.collect

@Composable
internal fun MarkdownBody(source: String, streaming: Boolean, modifier: Modifier = Modifier) {
    var rendered by remember { mutableStateOf(emptyList<MarkdownBlock>()) }
    val currentSource by rememberUpdatedState(source)
    val isStreaming by rememberUpdatedState(streaming)
    LaunchedEffect(Unit) {
        snapshotFlow { currentSource to isStreaming }.collect { (text, live) ->
            rendered = withContext(Dispatchers.Default) { MarkdownDocument.parse(text) }
            if (live) delay(60) // Conflate streamed updates without blocking the UI thread.
        }
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        rendered.forEach { block ->
            when {
                block.divider -> HorizontalDivider(Modifier.padding(vertical = 4.dp))
                block.table.isNotEmpty() -> Row(Modifier.horizontalScroll(rememberScrollState())) {
                    Column {
                        block.table.forEachIndexed { rowIndex, row ->
                            Row(Modifier.background(if (rowIndex == 0) Color(0xFF302B37) else Color(0xFF222226))) {
                                row.forEach { cell -> Text(cell.annotated(), Modifier.width(160.dp).padding(10.dp),
                                    fontSize = 13.sp, lineHeight = 21.sp,
                                    fontWeight = if (rowIndex == 0) FontWeight.SemiBold else FontWeight.Normal) }
                            }
                            HorizontalDivider(color = Color(0xFF403945))
                        }
                    }
                }
                block.code -> Surface(color = Color(0xFF242429), shape = RoundedCornerShape(12.dp)) {
                    Text(block.content.text, Modifier.horizontalScroll(rememberScrollState()).padding(14.dp),
                        fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 21.sp)
                }
                else -> Text(block.content.annotated(),
                    modifier = if (block.quote) Modifier.background(Color(0xFF27232E), RoundedCornerShape(8.dp)).padding(12.dp) else Modifier,
                    fontSize = when (block.heading) { 1 -> 25.sp; 2 -> 21.sp; 3 -> 18.sp; else -> 15.sp },
                    lineHeight = if (block.heading > 0) 30.sp else 25.sp,
                    fontWeight = if (block.heading > 0) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
    }
}

private fun MarkdownText.annotated(): AnnotatedString = buildAnnotatedString {
    append(text)
    spans.forEach { span ->
        if (span.style == MarkdownStyle.Link) {
            addLink(LinkAnnotation.Url(span.value, TextLinkStyles(SpanStyle(color = Color(0xFFD0B4FF), textDecoration = TextDecoration.Underline))), span.start, span.end)
        } else addStyle(when (span.style) {
            MarkdownStyle.Bold -> SpanStyle(fontWeight = FontWeight.Bold)
            MarkdownStyle.Italic -> SpanStyle(fontStyle = FontStyle.Italic)
            MarkdownStyle.Code -> SpanStyle(fontFamily = FontFamily.Monospace, background = Color(0xFF35313D))
            MarkdownStyle.Strike -> SpanStyle(textDecoration = TextDecoration.LineThrough)
            else -> SpanStyle()
        }, span.start, span.end)
    }
}
