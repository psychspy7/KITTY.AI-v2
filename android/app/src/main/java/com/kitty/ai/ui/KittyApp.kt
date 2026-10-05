package com.kitty.ai.ui

import android.app.Activity
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kitty.ai.BuildConfig
import com.kitty.ai.R
import com.kitty.ai.data.*

private val Midnight = Color(0xFF100D20)
private val Lilac = Color(0xFFD0B4FF)
private val KittyColors =
    darkColorScheme(
        primary = Lilac,
        onPrimary = Color(0xFF2C1645),
        secondary = Color(0xFFE8BEDD),
        background = Midnight,
        surface = Color(0xFF191429),
        surfaceContainer = Color(0xFF221A34),
        surfaceContainerHigh = Color(0xFF2B223D),
        onBackground = Color(0xFFF4EEFF),
        onSurface = Color(0xFFF4EEFF),
        onSurfaceVariant = Color(0xFFB0A2C4),
        outline = Color(0xFF493A5C),
    )

@Composable
fun KittyApp(vm: KittyViewModel, activity: Activity) {
    val state by vm.state.collectAsStateWithLifecycle()
    val download by vm.updater.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) vm.stopSpeech()
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }
    MaterialTheme(colorScheme = KittyColors, typography = Typography()) {
        val snackbar = remember { SnackbarHostState() }
        LaunchedEffect(state.error) {
            state.error?.let {
                snackbar.showSnackbar(it, actionLabel = "Dismiss")
                vm.dismissError()
            }
        }
        Scaffold(
            containerColor = Midnight,
            snackbarHost = { SnackbarHost(snackbar) },
            topBar = { if (state.uid != null) KittyHeader(state, vm) },
            bottomBar = {
                if (state.uid != null)
                    KittyNavigation(
                        state.screen,
                        state.data.notices.count { it.read == 0 },
                        vm::navigate,
                    )
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                if (state.uid == null) LoginScreen(state, vm, activity)
                else
                    when (state.screen) {
                        "Chat" -> ChatScreen(state, vm)
                        "History" -> HistoryScreen(state, vm)
                        "Memory" -> MemoryScreen(state, vm)
                        "Inbox" -> InboxScreen(state, vm)
                        "Settings" -> SettingsScreen(state, vm, activity)
                    }
            }
        }
        state.update?.let { update ->
            val newer = update.versionCode > BuildConfig.VERSION_CODE
            val published =
                TrustedUpdates.allowed(update.url) &&
                    Regex("[a-fA-F0-9]{64}").matches(update.sha256)
            AlertDialog(
                onDismissRequest = vm::dismissUpdate,
                title = {
                    Text(
                        if (!published) "No release published yet"
                        else if (newer) "A new chapter for KITTY" else "You’re up to date"
                    )
                },
                text = {
                    Text(
                        if (!published) "The owner has not published an APK update yet."
                        else if (newer) "${update.versionName}\n\n${update.notes}"
                        else "KITTY ${BuildConfig.VERSION_NAME} is the latest published version."
                    )
                },
                confirmButton = {
                    if (newer && published)
                        TextButton(
                            onClick = {
                                vm.updater.download(update)
                                vm.dismissUpdate()
                            }
                        ) {
                            Text("Download update")
                        }
                    else TextButton(onClick = vm::dismissUpdate) { Text("Done") }
                },
                dismissButton = {
                    if (newer) TextButton(onClick = vm::dismissUpdate) { Text("Later") }
                },
            )
        }
        if (download.phase != "idle") {
            AlertDialog(
                onDismissRequest = { if (download.phase != "downloading") vm.updater.dismiss() },
                title = {
                    Text(
                        when (download.phase) {
                            "downloading" -> "Downloading KITTY"
                            "ready" -> "Update ready"
                            else -> "Update needs attention"
                        }
                    )
                },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        when (download.phase) {
                            "downloading" -> {
                                Text(
                                    "You can cancel at any time. KITTY checks the APK before installation."
                                )
                                download.progress?.let {
                                    LinearProgressIndicator(
                                        progress = { it },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                } ?: LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                                download.progress?.let { Text("${(it * 100).toInt()}%") }
                            }
                            "ready" ->
                                Text(
                                    if (download.permissionRequired)
                                        "Allow updates from KITTY in Android settings, return here and tap Install. Android will ask you to confirm."
                                    else
                                        "KITTY ${download.info?.versionName} is verified and ready. Android will ask you to confirm installation."
                                )
                            else -> Text(download.error ?: "Please try again.")
                        }
                    }
                },
                confirmButton = {
                    when (download.phase) {
                        "downloading" -> TextButton(onClick = vm.updater::cancel) { Text("Cancel") }
                        "ready" ->
                            TextButton(onClick = { vm.updater.install(activity) }) {
                                Text("Install")
                            }
                        else ->
                            download.info?.let { info ->
                                TextButton(onClick = { vm.updater.download(info) }) {
                                    Text("Retry")
                                }
                            }
                    }
                },
                dismissButton = {
                    if (download.phase != "downloading")
                        TextButton(onClick = vm.updater::dismiss) { Text("Later") }
                },
            )
        }
    }
}

@Composable
private fun KittyHeader(state: KittyState, vm: KittyViewModel) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 22.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(
            painterResource(R.drawable.kitty_icon),
            "KITTY",
            Modifier.size(38.dp).clip(RoundedCornerShape(11.dp)),
        )
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text("KITTY", fontSize = 18.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(5.dp).background(Color(0xFFA9D9C2), CircleShape))
                Spacer(Modifier.width(5.dp))
                Text(
                    if (state.busy) "Finding the words…" else "A little wit. A lot of help.",
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        IconButton(onClick = vm::newChat) { Icon(Icons.Outlined.Add, "New chat") }
        IconButton(onClick = { vm.navigate("Settings") }) {
            Icon(Icons.Outlined.Settings, "Settings")
        }
    }
}

@Composable
private fun KittyNavigation(screen: String, unread: Int, onSelect: (String) -> Unit) {
    NavigationBar(containerColor = Color(0xFF171124), tonalElevation = 0.dp) {
        listOf(
                "Chat" to Icons.Outlined.ChatBubbleOutline,
                "History" to Icons.Outlined.History,
                "Memory" to Icons.Outlined.AutoAwesome,
                "Inbox" to Icons.Outlined.Inbox,
            )
            .forEach { (label, icon) ->
                NavigationBarItem(
                    selected = screen == label,
                    onClick = { onSelect(label) },
                    icon = {
                        if (label == "Inbox" && unread > 0)
                            BadgedBox(badge = { Badge { Text(unread.toString()) } }) {
                                Icon(icon, label)
                            }
                        else Icon(icon, label)
                    },
                    label = { Text(label, fontSize = 10.sp) },
                    colors =
                        NavigationBarItemDefaults.colors(
                            indicatorColor = Color(0xFF372547),
                            selectedIconColor = Lilac,
                            selectedTextColor = Lilac,
                        ),
                )
            }
    }
}

@Composable
private fun LoginScreen(state: KittyState, vm: KittyViewModel, activity: Activity) {
    Column(
        Modifier.fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF25163A), Midnight, Midnight)))
            .verticalScroll(rememberScrollState())
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(
            painterResource(R.drawable.kitty_icon),
            "KITTY emblem",
            Modifier.size(146.dp).clip(RoundedCornerShape(40.dp)),
        )
        Spacer(Modifier.height(35.dp))
        Text("YOUR EVERYDAY +1", color = Lilac, fontSize = 10.sp, letterSpacing = 3.sp)
        Spacer(Modifier.height(15.dp))
        Text("Meet KITTY.", fontSize = 40.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(14.dp))
        Text(
            "Sharp mind. Soft landing.\nA little mischief, always on your side.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 15.sp,
            lineHeight = 24.sp,
        )
        Spacer(Modifier.height(42.dp))
        Button(
            onClick = { vm.signIn(activity, activity.getString(R.string.default_web_client_id)) },
            enabled = !state.signingIn,
            shape = RoundedCornerShape(14.dp),
            colors =
                ButtonDefaults.buttonColors(
                    containerColor = Color.White,
                    contentColor = Color(0xFF202124),
                ),
            modifier = Modifier.fillMaxWidth().height(54.dp),
        ) {
            if (state.signingIn) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            else {
                Text("G", fontWeight = FontWeight.Bold, color = Color(0xFF4285F4), fontSize = 20.sp)
                Spacer(Modifier.width(14.dp))
                Text("Sign in with Google", fontWeight = FontWeight.Medium)
            }
        }
        Spacer(Modifier.height(20.dp))
        Text(
            "Your chats and memories belong to your account.\nCreated by Virat with the help of Kitty Corp.",
            fontSize = 10.sp,
            lineHeight = 17.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!vm.backendConfigured) {
            Spacer(Modifier.height(20.dp))
            Text(
                "Firebase configuration is included. Google login and chatting still need the account setup described in the beginner guide.",
                fontSize = 11.sp,
                color = Lilac,
            )
        }
    }
}

@Composable
private fun ChatScreen(state: KittyState, vm: KittyViewModel) {
    var draft by remember(state.uid, state.selected) { mutableStateOf("") }
    val messages = state.data.messages.filter { it.conversation_id == state.selected }
    val list = rememberLazyListState()
    LaunchedEffect(messages.lastOrNull()?.text?.length, messages.size) {
        if (
            messages.isNotEmpty() &&
                (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= messages.size - 3
        )
            list.scrollToItem(messages.lastIndex)
    }
    Column(Modifier.fillMaxSize().imePadding()) {
        if (messages.isEmpty())
            Column(
                Modifier.weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 26.dp, vertical = 30.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    "HELLO, ${state.name.ifBlank {"FRIEND"}.uppercase()}",
                    fontSize = 10.sp,
                    letterSpacing = 2.sp,
                    color = Lilac,
                )
                Spacer(Modifier.height(15.dp))
                Text(
                    "Big thoughts.\nSmall talk.\nI’m all ears.",
                    fontSize = 38.sp,
                    lineHeight = 45.sp,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.height(17.dp))
                Text(
                    "What’s on your mind? We can untangle it together.",
                    fontSize = 14.sp,
                    lineHeight = 22.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(32.dp))
                listOf(
                        "Help me think something through" to Icons.Outlined.Lightbulb,
                        "Make a plan for my day" to Icons.Outlined.CalendarToday,
                        "Teach me something surprising" to Icons.Outlined.AutoAwesome,
                    )
                    .forEach { (text, icon) ->
                        Surface(
                            onClick = { draft = text },
                            shape = RoundedCornerShape(15.dp),
                            color = Color(0xFF21182F),
                            modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
                        ) {
                            Row(
                                Modifier.padding(17.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(icon, null, Modifier.size(18.dp), tint = Lilac)
                                Spacer(Modifier.width(12.dp))
                                Text(text, fontSize = 12.sp, modifier = Modifier.weight(1f))
                                Icon(
                                    Icons.Outlined.NorthEast,
                                    null,
                                    Modifier.size(14.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
            }
        else
            LazyColumn(
                state = list,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(20.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                items(messages, key = { it.id }) { message -> MessageCard(message, state, vm) }
            }
        AnimatedVisibility(state.syncing) {
            LinearProgressIndicator(Modifier.fillMaxWidth(), color = Lilac)
        }
        Row(
            Modifier.fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .clip(RoundedCornerShape(23.dp))
                .background(Color(0xFF271D39))
                .border(1.dp, Color(0xFF4B365E), RoundedCornerShape(23.dp))
                .padding(start = 5.dp, end = 7.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            TextField(
                value = draft,
                onValueChange = { if (it.length <= 8000) draft = it },
                placeholder = { Text("Ask KITTY anything…", fontSize = 14.sp) },
                modifier = Modifier.weight(1f),
                maxLines = 5,
                shape = RoundedCornerShape(23.dp),
                colors =
                    TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                    ),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions =
                    KeyboardActions(
                        onSend = {
                            if (draft.isNotBlank() && !state.busy && !state.syncing) {
                                vm.send(draft)
                                draft = ""
                            }
                        }
                    ),
            )
            IconButton(
                onClick = {
                    if (state.busy) vm.stop()
                    else {
                        vm.send(draft)
                        if (draft.isNotBlank() && !state.syncing) draft = ""
                    }
                },
                enabled = state.busy || (!state.syncing && draft.isNotBlank()),
                modifier =
                    Modifier.padding(bottom = 7.dp)
                        .size(38.dp)
                        .background(
                            if (state.busy || draft.isNotBlank()) Lilac else Color(0xFF423150),
                            CircleShape,
                        ),
            ) {
                Icon(
                    if (state.busy) Icons.Outlined.Stop else Icons.Outlined.ArrowUpward,
                    if (state.busy) "Stop reply" else "Send message",
                    tint = Midnight,
                    modifier = Modifier.size(21.dp),
                )
            }
        }
        Text(
            "KITTY can make mistakes. Check important details.",
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 8.dp),
            fontSize = 9.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun MessageCard(message: ChatMessage, state: KittyState, vm: KittyViewModel) {
    val assistant = message.role == "assistant"
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (assistant) Alignment.Start else Alignment.End,
    ) {
        if (assistant) {
            Text("KITTY", fontSize = 10.sp, letterSpacing = 1.8.sp, color = Lilac)
            Spacer(Modifier.height(10.dp))
        }
        Surface(
            color = if (assistant) Color.Transparent else Color(0xFF322344),
            shape = RoundedCornerShape(18.dp),
        ) {
            SelectionContainer {
                Text(
                    message.text.ifEmpty {
                        if (message.status == "streaming") "Thinking…" else "Reply stopped."
                    },
                    fontSize = 15.sp,
                    lineHeight = 25.sp,
                    modifier = Modifier.padding(if (assistant) 0.dp else 16.dp),
                )
            }
        }
        if (assistant)
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (message.status == "complete") {
                    IconButton(onClick = { vm.speak(message) }) {
                        Icon(
                            if (state.speaking == message.id) Icons.Outlined.StopCircle
                            else Icons.Outlined.VolumeUp,
                            if (state.speaking == message.id) "Stop speech" else "Listen to reply",
                            Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (state.data.consent)
                        TextButton(onClick = { vm.share(message) }) {
                            Text("Share for review", fontSize = 10.sp)
                        }
                } else if (message.status != "streaming") {
                    TextButton(
                        onClick = { vm.retry(message) },
                        enabled = !state.busy && !state.syncing,
                    ) {
                        Icon(Icons.Outlined.Refresh, null, Modifier.size(15.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Retry", fontSize = 11.sp)
                    }
                    Text(
                        message.status,
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
    }
}

@Composable
private fun SectionHeading(title: String, subtitle: String) {
    Text(title, fontSize = 29.sp, fontWeight = FontWeight.Medium)
    Spacer(Modifier.height(10.dp))
    Text(
        subtitle,
        fontSize = 13.sp,
        lineHeight = 21.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(25.dp))
}

@Composable
private fun HistoryScreen(state: KittyState, vm: KittyViewModel) {
    var deleting by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().padding(24.dp)) {
        SectionHeading("A thought, saved.", "Pick up where you left off.")
        OutlinedButton(onClick = vm::refresh, enabled = !state.syncing) {
            Icon(Icons.Outlined.Sync, null, Modifier.size(16.dp))
            Spacer(Modifier.width(8.dp))
            Text("Sync history")
        }
        Spacer(Modifier.height(18.dp))
        if (state.data.conversations.isEmpty())
            EmptyCard(
                Icons.Outlined.History,
                "Your story starts here.",
                "Your conversations will appear after your first chat.",
            )
        else
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(state.data.conversations, key = { it.id }) { chat ->
                    Surface(
                        onClick = { vm.openChat(chat.id) },
                        shape = RoundedCornerShape(16.dp),
                        color = Color(0xFF231A32),
                    ) {
                        Row(
                            Modifier.padding(18.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(chat.title, maxLines = 2, fontSize = 14.sp)
                                Spacer(Modifier.height(8.dp))
                                Text(
                                    java.text.DateFormat.getDateInstance()
                                        .format(java.util.Date(chat.updated_at)),
                                    fontSize = 10.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            IconButton(onClick = { deleting = chat.id }) {
                                Icon(
                                    Icons.Outlined.DeleteOutline,
                                    "Delete conversation",
                                    Modifier.size(18.dp),
                                )
                            }
                        }
                    }
                }
            }
    }
    deleting?.let { id ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete this conversation?") },
            text = {
                Text(
                    "This removes it from your account’s backend history and this device, including shared examples."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.deleteChat(id)
                        deleting = null
                    }
                ) {
                    Text("Delete")
                }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun MemoryScreen(state: KittyState, vm: KittyViewModel) {
    var edit by remember { mutableStateOf<Memory?>(null) }
    var adding by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(24.dp)) {
        SectionHeading(
            "Little things, remembered.",
            "Tell KITTY what matters to you. Memories help with relevant replies; they don’t change her identity.",
        )
        Button(
            onClick = {
                edit = null
                text = ""
                adding = true
            },
            shape = RoundedCornerShape(13.dp),
        ) {
            Icon(Icons.Outlined.Add, null, Modifier.size(16.dp))
            Spacer(Modifier.width(7.dp))
            Text("Add a memory")
        }
        Spacer(Modifier.height(22.dp))
        if (state.data.memories.isEmpty())
            EmptyCard(
                Icons.Outlined.AutoAwesome,
                "Make it personal.",
                "A preference, a goal, or something you’d like KITTY to remember.",
            )
        else
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(state.data.memories, key = { it.id }) { memory ->
                    Surface(shape = RoundedCornerShape(16.dp), color = Color(0xFF231A32)) {
                        Column(Modifier.padding(18.dp)) {
                            Text(memory.text, fontSize = 14.sp, lineHeight = 23.sp)
                            Row {
                                TextButton(
                                    onClick = {
                                        edit = memory
                                        text = memory.text
                                        adding = true
                                    }
                                ) {
                                    Text("Edit")
                                }
                                TextButton(onClick = { vm.deleteMemory(memory.id) }) {
                                    Text("Forget")
                                }
                            }
                        }
                    }
                }
            }
    }
    if (adding)
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text(if (edit == null) "A note for KITTY" else "Edit memory") },
            text = {
                OutlinedTextField(
                    value = text,
                    onValueChange = { if (it.length <= 500) text = it },
                    label = { Text("Personal memory") },
                    minLines = 3,
                    maxLines = 6,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.saveMemory(edit?.id, text)
                        adding = false
                    },
                    enabled = text.isNotBlank(),
                ) {
                    Text("Remember")
                }
            },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("Cancel") } },
        )
}

@Composable
private fun InboxScreen(state: KittyState, vm: KittyViewModel) {
    Column(Modifier.fillMaxSize().padding(24.dp)) {
        SectionHeading(
            "A note from us.",
            "News and announcements from Kitty Corp. Refresh to check for new notices.",
        )
        TextButton(onClick = vm::refresh, enabled = !state.syncing) { Text("Refresh Inbox") }
        if (state.data.notices.isEmpty())
            EmptyCard(
                Icons.Outlined.Inbox,
                "All quiet for now.",
                "Announcements appear here. Background push notifications are not enabled.",
            )
        else
            LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                items(state.data.notices, key = { it.id }) { notice ->
                    Surface(
                        onClick = { vm.readNotice(notice.id) },
                        shape = RoundedCornerShape(18.dp),
                        color = Color(0xFF231A32),
                    ) {
                        Column(Modifier.padding(20.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    notice.title,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.weight(1f),
                                )
                                if (notice.read == 0)
                                    Box(Modifier.size(7.dp).background(Lilac, CircleShape))
                            }
                            Spacer(Modifier.height(12.dp))
                            Text(
                                notice.body,
                                fontSize = 13.sp,
                                lineHeight = 22.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(15.dp))
                            Text(
                                if (notice.read == 0) "Tap to mark as read" else "Read",
                                fontSize = 10.sp,
                                color = Lilac,
                            )
                        }
                    }
                }
            }
    }
}

@Composable
private fun SettingsScreen(state: KittyState, vm: KittyViewModel, activity: Activity) {
    var consentDialog by remember { mutableStateOf(false) }
    var clearDialog by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        SectionHeading("Your space.", "A few essentials, exactly where you need them.")
        Surface(shape = RoundedCornerShape(18.dp), color = Color(0xFF231A32)) {
            Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(44.dp).background(Color(0xFF45305E), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(state.name.take(1).uppercase(), color = Lilac, fontSize = 22.sp)
                }
                Spacer(Modifier.width(15.dp))
                Column {
                    Text(state.name.ifBlank { "KITTY user" }, fontSize = 16.sp)
                    Text(
                        state.email,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        Spacer(Modifier.height(20.dp))
        SettingsItem(
            Icons.Outlined.SystemUpdate,
            "Check for updates",
            "Trusted GitHub Releases · ${BuildConfig.VERSION_NAME}",
            vm::checkUpdates,
        )
        SettingsItem(
            Icons.Outlined.CloudSync,
            "Sync account data",
            "History, memories and Inbox",
            vm::refresh,
        )
        SettingsItem(
            Icons.Outlined.DeleteSweep,
            "Clear this device’s cache",
            "Cloud history remains available",
            { clearDialog = true },
        )
        HorizontalDivider(Modifier.padding(vertical = 22.dp), color = Color(0xFF342742))
        Text("PRIVACY & LEARNING", fontSize = 10.sp, letterSpacing = 2.sp, color = Lilac)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Allow example sharing", fontSize = 14.sp)
                Text(
                    "Then choose individual replies to share for owner review.",
                    fontSize = 11.sp,
                    lineHeight = 18.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(
                checked = state.data.consent,
                onCheckedChange = { if (it) consentDialog = true else vm.consent(false) },
            )
        }
        Text(
            "Sharing is optional. Normal chat saving does not train or fine-tune a model. Turning this off removes your examples from the review queue. API providers process submitted content under their own policies.",
            fontSize = 11.sp,
            lineHeight = 19.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 15.dp),
        )
        HorizontalDivider(Modifier.padding(vertical = 10.dp), color = Color(0xFF342742))
        SettingsItem(
            Icons.Outlined.Logout,
            "Switch Google account",
            "Stops the current reply and audio",
            { vm.signOut(activity) },
        )
        Spacer(Modifier.height(20.dp))
        Text(
            "KITTY AI\nCreated by Virat with the help of Kitty Corp.",
            fontSize = 11.sp,
            lineHeight = 18.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            "Firebase UID: ${state.uid}",
            fontSize = 9.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 12.dp),
        )
        if (!vm.backendConfigured) {
            Spacer(Modifier.height(20.dp))
            Text(
                "Backend connection pending. Deploy the Worker, then rebuild with -PkittyBackendUrl=https://your-worker.workers.dev. See the beginner guide in the source project.",
                fontSize = 12.sp,
                lineHeight = 20.sp,
                color = Lilac,
            )
        }
    }
    if (consentDialog)
        AlertDialog(
            onDismissRequest = { consentDialog = false },
            title = { Text("Choose what KITTY may learn from") },
            text = {
                Text(
                    "Enable sharing, then use ‘Share for review’ on an individual reply. The owner can see that question and answer. Avoid sharing sensitive details. You can withdraw consent at any time. This does not automatically fine-tune a model."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.consent(true)
                        consentDialog = false
                    }
                ) {
                    Text("Allow sharing")
                }
            },
            dismissButton = {
                TextButton(onClick = { consentDialog = false }) { Text("Keep private") }
            },
        )
    if (clearDialog)
        AlertDialog(
            onDismissRequest = { clearDialog = false },
            title = { Text("Clear local cache?") },
            text = {
                Text(
                    "This clears this account’s saved data on this device. Sync restores your cloud data."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.clearLocal()
                        clearDialog = false
                    }
                ) {
                    Text("Clear")
                }
            },
            dismissButton = { TextButton(onClick = { clearDialog = false }) { Text("Cancel") } },
        )
}

@Composable
private fun SettingsItem(icon: ImageVector, title: String, detail: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(21.dp), tint = Lilac)
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp)
            Spacer(Modifier.height(4.dp))
            Text(detail, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(
            Icons.Outlined.ChevronRight,
            null,
            Modifier.size(18.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun EmptyCard(icon: ImageVector, title: String, detail: String) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = Color(0xFF21182E),
        modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
    ) {
        Column(Modifier.padding(26.dp)) {
            Icon(icon, null, Modifier.size(26.dp), tint = Lilac)
            Spacer(Modifier.height(20.dp))
            Text(title, fontSize = 18.sp)
            Spacer(Modifier.height(9.dp))
            Text(
                detail,
                fontSize = 12.sp,
                lineHeight = 20.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
