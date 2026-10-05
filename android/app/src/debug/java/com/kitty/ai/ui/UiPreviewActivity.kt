package com.kitty.ai.ui

import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import com.kitty.ai.audio.DeviceSpeaker
import com.kitty.ai.audio.SpeechPlayer
import com.kitty.ai.data.ChatMessage
import com.kitty.ai.data.LocalSnapshot
import com.kitty.ai.data.SpeechAudio

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
            var page by remember { mutableStateOf("Chat") }
            var audioStatus by remember { mutableStateOf("Audio idle") }
            val fixture =
                KittyState(
                    uid = "qa-fixture",
                    name = "Sir",
                    email = "fixture@example.com",
                    selected = "fixture-chat",
                    data =
                        if (intent.getBooleanExtra("withReply", false))
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
                                            "Of course, Sir. Pick one important task, give it a focused hour, then take a break. Even empires need a tea interval.",
                                            2,
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
