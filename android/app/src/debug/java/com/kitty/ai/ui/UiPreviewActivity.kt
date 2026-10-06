package com.kitty.ai.ui

import android.Manifest
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import com.kitty.ai.BuildConfig
import com.kitty.ai.audio.DeviceSpeaker
import com.kitty.ai.audio.SpeechPlayer
import com.kitty.ai.data.ChatMessage
import com.kitty.ai.data.LocalSnapshot
import com.kitty.ai.data.Notice
import com.kitty.ai.data.SpeechAudio
import com.kitty.ai.data.UpdateInfo
import com.kitty.ai.notifications.KittyNotifications
import kotlinx.coroutines.delay

/** UI/audio fixture only: no Firebase sign-in and no backend chat request. Absent from release. */
class UiPreviewActivity : ComponentActivity() {
    private lateinit var speaker: DeviceSpeaker
    private lateinit var player: SpeechPlayer

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        speaker = DeviceSpeaker(this)
        player = SpeechPlayer(this)
        val vm = ViewModelProvider(this)[KittyViewModel::class.java]
        setContent {
            var page by remember { mutableStateOf(intent.getStringExtra("page") ?: "Chat") }
            var audioStatus by remember { mutableStateOf("Audio idle") }
            var alertStatus by remember { mutableStateOf("Synthetic notification fixture") }
            val alerts = remember { KittyNotifications(this) { "qa-notifications" } }
            var prompt by remember { mutableStateOf(alerts.needsPrompt()) }
            val permission =
                rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
                    alertStatus = if (it) "Permission allowed" else "Permission denied"
                }
            var streamingText by remember { mutableStateOf("") }
            var streaming by remember { mutableStateOf(false) }
            LaunchedEffect(intent.getBooleanExtra("longStream", false)) {
                if (intent.getBooleanExtra("longStream", false)) {
                    streaming = true
                    for (i in 1..70) {
                        streamingText += "\n\n**Step $i** · Readable bold, *italic*, and `code`. Take a small useful step, then check your progress. This is a synthetic streaming test."
                        delay(700)
                    }
                    streaming = false
                }
            }
            val fixture =
                KittyState(
                    uid = "qa-fixture",
                    name = "Sir",
                    email = "fixture@example.com",
                    selected = "fixture-chat",
                    data =
                        if (intent.getBooleanExtra("withReply", false) || intent.getBooleanExtra("longStream", false))
                            LocalSnapshot(
                                messages =
                                    listOf(
                                        ChatMessage(
                                            "u",
                                            "fixture-chat",
                                            "user",
                                            "Help me plan my day.",
                                            1,
                                        ),
                                        ChatMessage(
                                            "a",
                                            "fixture-chat",
                                            "assistant",
                                            if (intent.getBooleanExtra("longStream", false)) streamingText else "Of course, **Sir**. Pick one important task, give it a focused hour, then take a break. Even empires need a tea interval.\n\n- A clear priority\n- A little *mischief*\n\n`Keep it simple.`",
                                            2,
                                            if (streaming) "streaming" else "complete",
                                        ),
                                    )
                            )
                        else LocalSnapshot(),
                )
            MaterialTheme(
                colorScheme =
                    darkColorScheme(background = androidx.compose.ui.graphics.Color(0xFF151518))
            ) {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.statusBarsPadding().navigationBarsPadding()) {
                        Row {
                            TextButton(onClick = { page = "Chat" }) { Text("Chat fixture") }
                            TextButton(onClick = { page = "Settings" }) { Text("Settings fixture") }
                            TextButton(onClick = { page = "Audio" }) { Text("Audio fixture") }
                        }
                        when (page) {
                            "Chat" -> ChatScreen(fixture, vm)
                            "Settings" -> SettingsScreen(fixture, vm, this@UiPreviewActivity)
                            "Boot" -> KittyBootScreen()
                            "Notifications" ->
                                Column(Modifier.padding(20.dp)) {
                                    Text(alertStatus)
                                    TextButton(onClick = { prompt = true }) {
                                        Text("Ask notification permission")
                                    }
                                    TextButton(
                                        onClick = {
                                            alerts.activate("qa-notifications")
                                            alerts.replyFinished(
                                                "qa-notifications",
                                                ChatMessage(
                                                    "qa-reply",
                                                    "qa-chat",
                                                    "assistant",
                                                    "Synthetic reply",
                                                    1,
                                                ),
                                            )
                                            alertStatus =
                                                "Active alerts: ${getSystemService(NotificationManager::class.java).activeNotifications.size}"
                                        }
                                    ) {
                                        Text("Reply alert / repeat")
                                    }
                                    TextButton(
                                        onClick = {
                                            alerts.activate("qa-notifications")
                                            alerts.seedNotices(
                                                "qa-notifications",
                                                listOf(Notice("qa-old", "Old", "Old", 1)),
                                            )
                                            alerts.observeNotices(
                                                "qa-notifications",
                                                listOf(
                                                    Notice("qa-old", "Old", "Old", 1),
                                                    Notice("qa-new", "New", "New", 2),
                                                ),
                                            )
                                            alertStatus =
                                                "Active alerts: ${getSystemService(NotificationManager::class.java).activeNotifications.size}"
                                        }
                                    ) {
                                        Text("Inbox alert / repeat")
                                    }
                                    TextButton(
                                        onClick = {
                                            alerts.activate("qa-notifications")
                                            alerts.observeUpdate(
                                                "qa-notifications",
                                                UpdateInfo(
                                                    BuildConfig.VERSION_CODE + 1,
                                                    "QA fixture",
                                                    "https://kitty-ai-v2.kitty-ai.workers.dev/downloads/KITTY-AI-1.5.2.apk",
                                                    "a".repeat(64),
                                                ),
                                            )
                                            alertStatus =
                                                "Active alerts: ${getSystemService(NotificationManager::class.java).activeNotifications.size}"
                                        }
                                    ) {
                                        Text("Update alert / repeat")
                                    }
                                    TextButton(
                                        onClick = {
                                            alerts.activate(null)
                                            alertStatus =
                                                "Active alerts: ${getSystemService(NotificationManager::class.java).activeNotifications.size}"
                                        }
                                    ) {
                                        Text("Sign-out fence")
                                    }
                                }
                            else ->
                                Column(Modifier.padding(24.dp)) {
                                    Text(audioStatus)
                                    TextButton(
                                        onClick = {
                                            player.stop()
                                            audioStatus = "Device playing"
                                            speaker.play(
                                                "Hello Sir. KITTY is ready.",
                                                {
                                                    audioStatus = "Device playback finished"
                                                },
                                                { audioStatus = it },
                                            )
                                        }
                                    ) {
                                        Text("Play device voice")
                                    }
                                    TextButton(
                                        onClick = {
                                            speaker.stop()
                                            audioStatus = "Cloud playing"
                                            val bytes =
                                                assets.open("qa-voice.wav").use { it.readBytes() }
                                            player.play(
                                                SpeechAudio(
                                                    Base64.encodeToString(bytes, Base64.NO_WRAP),
                                                    "audio/wav",
                                                )
                                            ) {
                                                audioStatus = "Cloud playback finished"
                                            }
                                        }
                                    ) {
                                        Text("Play Cloudflare voice")
                                    }
                                    TextButton(
                                        onClick = {
                                            speaker.stop()
                                            player.stop()
                                            audioStatus = "Audio stopped"
                                        }
                                    ) {
                                        Text("Stop audio")
                                    }
                                }
                        }
                        if (page == "Notifications" && prompt)
                            NotificationPrompt(
                                onDismiss = {
                                    alerts.promptHandled()
                                    prompt = false
                                },
                                onAllow = {
                                    alerts.promptHandled()
                                    alerts.optIn()
                                    prompt = false
                                    if (Build.VERSION.SDK_INT >= 33)
                                        permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                                },
                            )
                    }
                }
            }
        }
    }

    override fun onStop() {
        if (::speaker.isInitialized) speaker.stop()
        if (::player.isInitialized) player.stop()
        super.onStop()
    }

    override fun onDestroy() {
        if (::speaker.isInitialized) speaker.close()
        if (::player.isInitialized) player.stop()
        super.onDestroy()
    }
}
