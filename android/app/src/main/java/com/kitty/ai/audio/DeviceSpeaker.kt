package com.kitty.ai.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/** Account/session ownership stays in the ViewModel; this owns one cancellable playback. */
class DeviceSpeaker(context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var focus: AudioFocusRequest? = null
    private var engine: TextToSpeech? = null
    private var initialized = false
    private var initializationFailed = false
    private var generation = 0
    private var pending: (() -> Unit)? = null
    private var completion: (() -> Unit)? = null
    private var failure: ((String) -> Unit)? = null
    private var lastUtterance = ""

    init {
        engine =
            TextToSpeech(context.applicationContext) { status ->
                main.post {
                    initialized = status == TextToSpeech.SUCCESS
                    initializationFailed = !initialized
                    if (initialized) {
                        engine?.setOnUtteranceProgressListener(
                            object : UtteranceProgressListener() {
                                override fun onStart(id: String?) {}

                                override fun onDone(id: String?) = finish(id, null)

                                @Deprecated("Android callback")
                                override fun onError(id: String?) =
                                    finish(
                                        id,
                                        "Device speech could not play. Check your installed voices.",
                                    )

                                override fun onError(id: String?, code: Int) = onError(id)
                            }
                        )
                        pending?.invoke()
                    } else
                        failure?.invoke(
                            "Device speech is unavailable. Install a text-to-speech engine or choose the cloud voice in Settings."
                        )
                    pending = null
                }
            }
    }

    private fun finish(id: String?, error: String?) {
        main.post {
            if (id?.startsWith("$generation:") == true && (error != null || id == lastUtterance)) {
                val done = completion
                val failed = failure
                stop()
                if (error == null) done?.invoke() else failed?.invoke(error)
            }
        }
    }

    fun stop() {
        generation++
        pending = null
        completion = null
        failure = null
        engine?.stop()
        focus?.let { manager.abandonAudioFocusRequest(it) }
        focus = null
    }

    fun play(text: String, onFinished: () -> Unit, onError: (String) -> Unit) {
        stop()
        val playback = generation
        completion = onFinished
        failure = onError
        val start = {
            if (generation == playback) {
                try {
                    check(!initializationFailed) {
                        "Device speech is unavailable. Install a text-to-speech engine."
                    }
                    val tts = checkNotNull(engine)
                    val language = tts.setLanguage(Locale.getDefault())
                    check(
                        language != TextToSpeech.LANG_MISSING_DATA &&
                            language != TextToSpeech.LANG_NOT_SUPPORTED
                    ) {
                        "Install a voice for your device language in Android text-to-speech settings."
                    }
                    val attributes =
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    tts.setAudioAttributes(attributes)
                    val request =
                        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                            .setAudioAttributes(attributes)
                            .setOnAudioFocusChangeListener { change ->
                                if (change <= 0 && generation == playback) {
                                    stop()
                                    onFinished()
                                }
                            }
                            .build()
                    check(
                        manager.requestAudioFocus(request) ==
                            AudioManager.AUDIOFOCUS_REQUEST_GRANTED
                    ) {
                        "Audio is busy. Try again."
                    }
                    focus = request
                    val chunks = text.chunked(TextToSpeech.getMaxSpeechInputLength())
                    lastUtterance = "$playback:${chunks.lastIndex}"
                    chunks.forEachIndexed { index, chunk ->
                        check(
                            tts.speak(
                                chunk,
                                if (index == 0) TextToSpeech.QUEUE_FLUSH
                                else TextToSpeech.QUEUE_ADD,
                                null,
                                "$playback:$index",
                            ) == TextToSpeech.SUCCESS
                        ) {
                            "Device speech could not start."
                        }
                    }
                } catch (error: Exception) {
                    stop()
                    onError(error.message ?: "Device speech could not play.")
                }
            }
        }
        if (initialized || initializationFailed) start() else pending = start
    }

    fun close() {
        stop()
        engine?.shutdown()
        engine = null
    }
}
