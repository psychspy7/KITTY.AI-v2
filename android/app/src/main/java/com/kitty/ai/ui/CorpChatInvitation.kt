package com.kitty.ai.ui
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** External navigation sends no account identifiers or chat content. */
@Composable
internal fun CorpChatInvitation(text:String,purchaseAvailable:Boolean,onDismiss:(()->Unit)?) {
 val uri=LocalUriHandler.current
 Surface(Modifier.fillMaxWidth().padding(horizontal=18.dp,vertical=6.dp),color=MaterialTheme.colorScheme.surfaceContainer,shape=MaterialTheme.shapes.medium) {
  Column(Modifier.padding(horizontal=14.dp,vertical=10.dp)) {
   Text(text,fontSize=12.sp,lineHeight=18.sp)
   Row {
    TextButton(onClick={uri.openUri("https://kittycorp.vercel.app/contact?subject=Review")},modifier=Modifier.weight(1f)){Text("Visit KITTY CORP & share feedback",fontSize=11.sp)}
    if(onDismiss!=null)TextButton(onClick=onDismiss){Text("Dismiss",fontSize=11.sp)}
   }
   if(purchaseAvailable)TextButton(onClick={uri.openUri("https://kittycorp.vercel.app/memberships")}){Text("View KITTY Plus",fontSize=12.sp)}
  }
 }
}
