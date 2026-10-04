package com.kitty.ai.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.util.Base64
import com.kitty.ai.data.SpeechAudio
import java.io.File

class SpeechPlayer(private val context: Context) {
    private var player: MediaPlayer? = null
    private var audioFile: File? = null
    private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var focus: AudioFocusRequest? = null
    private var generation = 0

    fun stop() {
        generation++
        player?.runCatching { stop() }
        player?.release()
        player = null
        focus?.let { manager.abandonAudioFocusRequest(it) }
        focus = null
        audioFile?.delete()
        audioFile = null
    }

    fun play(audio: SpeechAudio, onFinished: () -> Unit) {
        stop()
        val playback = generation
        require(audio.mimeType == "audio/wav") { "Unsupported audio format." }
        val attributes =
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        val request =
            AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener {
                    if (it <= 0 && generation == playback) {
                        stop()
                        onFinished()
                    }
                }
                .build()
        check(manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            "Audio is busy. Try again."
        }
        focus = request
        val file = File.createTempFile("kitty-voice-", ".wav", context.cacheDir)
        audioFile = file
        file.writeBytes(Base64.decode(audio.data, Base64.DEFAULT))
        val next = MediaPlayer()
        player = next
        next.setAudioAttributes(attributes)
        next.setDataSource(file.absolutePath)
        next.setOnPreparedListener { if (player === it) it.start() }
        next.setOnCompletionListener {
            if (player === it) {
                stop()
                onFinished()
            }
        }
        next.setOnErrorListener { failed, _, _ ->
            if (player === failed) {
                stop()
                onFinished()
            }
            true
        }
        next.prepareAsync()
    }
}
