package com.kitty.ai.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.DateFormat
import java.util.Date

@Composable
internal fun CorpHub(state: KittyState) {
    val uri = LocalUriHandler.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Your KITTY connection.", fontSize = 28.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold)
        Text("Made by Kitty Corp. Created by Virat.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val paid = state.membership?.paid == true
                Text(if (paid) "KITTY Plus" else "KITTY Free", fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                Text(if (paid) "Active through " + DateFormat.getDateInstance().format(Date(state.membership.expiresAt)) else "Five minutes of chat per day. Resets at 05:30 India / midnight UTC.")
                Text("Plus: ₹99 per calendar month · 100 chats and 10 cloud-speech requests daily. Renew manually.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { uri.openUri("https://kittycorp.vercel.app/memberships") }, modifier = Modifier.fillMaxWidth()) { Text(if (paid) "Manage membership" else "View membership") }
                Text("Use the same Google account as KITTY: " + state.email, fontSize = 12.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        OutlinedButton(onClick = { uri.openUri("https://kittycorp.vercel.app/contact?subject=Review") }, modifier = Modifier.fillMaxWidth()) { Text("Share honest feedback") }
        OutlinedButton(onClick = { uri.openUri("https://kittycorp.vercel.app/") }, modifier = Modifier.fillMaxWidth()) { Text("Explore Kitty Corp") }
        TextButton(onClick = { uri.openUri("mailto:kittycorp.info@gmail.com?subject=KITTY%20AI%20support") }) { Text("Contact support") }
        TextButton(onClick = { uri.openUri("https://www.linkedin.com/in/virat-anand-928460442/") }) { Text("Meet the creator") }
        HorizontalDivider()
        Text("Reference library", fontWeight = FontWeight.SemiBold)
        Text("KITTY can use relevant public references alongside your personal context. References can be dated; ask for current verification when it matters.", fontSize = 13.sp, lineHeight = 21.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = { uri.openUri("https://huggingface.co/datasets/Salesforce/wikitext") }) { Text("Dataset sources & licences") }
    }
}
