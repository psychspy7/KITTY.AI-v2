package com.kitty.ai.ui

import android.app.Activity
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.kitty.ai.audio.DeviceSpeaker
import com.kitty.ai.audio.SpeechPlayer
import com.kitty.ai.auth.BrowserLogin
import com.kitty.ai.auth.GoogleLogin
import com.kitty.ai.data.*
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class KittyState(
    val uid: String? = null,
    val name: String = "",
    val email: String = "",
    val screen: String = "Chat",
    val selected: String = UUID.randomUUID().toString(),
    val data: LocalSnapshot = LocalSnapshot(),
    val busy: Boolean = false,
    val syncing: Boolean = false,
    val speaking: String? = null,
    val signingIn: Boolean = false,
    val browserSigningIn: Boolean = false,
    val signInError: String? = null,
    val error: String? = null,
    val update: UpdateInfo? = null,
    val showConsent: Boolean = false,
)

class KittyViewModel(application: Application) : AndroidViewModel(application) {
    private val auth = FirebaseAuth.getInstance()
    private val login = GoogleLogin(auth)
    private val browserLogin = BrowserLogin(application, auth)
    private val api = ApiClient(auth)
    private val store = LocalStore(application)
    private val player = SpeechPlayer(application)
    private val deviceSpeaker = DeviceSpeaker(application)
    private val mutable = MutableStateFlow(KittyState())
    val state = mutable.asStateFlow()
    val updater = AppUpdater(application, viewModelScope)
    val backendConfigured
        get() = api.configured

    private var epoch = 0
    private var session: Job? = null
    private var loginJob: Job? = null
    private var reply: Job? = null
    private var speech: Job? = null
    private var speechGeneration = 0
    private val persistence = Mutex()
    private val listener = FirebaseAuth.AuthStateListener { switchAccount() }

    init {
        auth.addAuthStateListener(listener)
        if (auth.currentUser == null && browserLogin.hasPending())
            mutable.update { it.copy(signingIn = true, browserSigningIn = true) }
    }

    private fun switchAccount() {
        val account = auth.currentUser
        if (account?.uid == mutable.value.uid) return
        epoch++
        val generation = epoch
        session?.cancel()
        reply?.cancel()
        speech?.cancel()
        api.cancelAll()
        player.stop()
        deviceSpeaker.stop()
        mutable.value =
            KittyState(
                uid = account?.uid,
                name = account?.displayName?.substringBefore(" ").orEmpty(),
                email = account?.email.orEmpty(),
            )
        if (account == null) return
        session = viewModelScope.launch {
            val local = persistence.withLock { store.read(account.uid) }
            if (epoch != generation) return@launch
            mutable.update {
                it.copy(
                    data =
                        local.copy(
                            messages =
                                local.messages.map { m ->
                                    if (m.status == "streaming") m.copy(status = "cancelled") else m
                                }
                        ),
                    selected = local.conversations.firstOrNull()?.id ?: it.selected,
                )
            }
            refresh()
        }
    }

    private var loginAttempt = 0
    private var foreground = false

    fun setForeground(active: Boolean) {
        foreground = active
        if (active) resumeBrowserSignIn()
        else if (mutable.value.browserSigningIn) {
            // Browsers own the foreground during Google login. Cached apps can lose network access.
            loginAttempt++
            loginJob?.cancel()
            loginJob = null
        }
    }

    private fun launchLogin(browser: Boolean, operation: suspend () -> Unit) {
        if (loginJob?.isActive == true) return
        val attempt = ++loginAttempt
        mutable.update { it.copy(signingIn = true, browserSigningIn = browser, signInError = null) }
        loginJob = viewModelScope.launch {
            try {
                operation()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Log exception types only; Google credentials and tokens never enter logs.
                android.util.Log.w(
                    "KittyLogin",
                    "Sign-in failed: ${e.javaClass.name}; cause: ${e.cause?.javaClass?.name ?: "none"}",
                )
                if (loginAttempt == attempt) mutable.update { it.copy(signInError = loginError(e)) }
            } finally {
                if (loginAttempt == attempt) {
                    val pending = browser && browserLogin.hasPending() && mutable.value.uid == null
                    mutable.update { it.copy(signingIn = pending, browserSigningIn = pending) }
                }
            }
        }
    }

    private fun loginError(error: Exception): String {
        val code = (error as? com.google.firebase.auth.FirebaseAuthException)?.errorCode
        return if (code != null)
            "Google sign-in could not finish ($code). Try browser sign-in below."
        else if (error is IllegalStateException)
            error.message ?: "Sign-in could not finish. Try browser sign-in."
        else
            "Google sign-in could not finish (${error.javaClass.simpleName}). Check your connection and try again."
    }

    fun signIn(activity: Activity, clientId: String) =
        launchLogin(false) {
            browserLogin.cancel()
            login.signIn(activity, clientId)
        }

    fun browserSignIn(activity: Activity) =
        launchLogin(true) {
            browserLogin.cancel()
            browserLogin.open(activity)
        }

    fun resumeBrowserSignIn() {
        if (!foreground || auth.currentUser != null || !browserLogin.hasPending()) return
        launchLogin(true) { browserLogin.finish() }
    }

    fun cancelBrowserSignIn() {
        loginAttempt++
        loginJob?.cancel()
        loginJob = null
        viewModelScope.launch { browserLogin.cancel() }
        mutable.update {
            it.copy(
                signingIn = false,
                browserSigningIn = false,
                signInError = "Browser sign-in cancelled. You can try again.",
            )
        }
    }

    fun signOut(activity: Activity) {
        stop()
        viewModelScope.launch { login.signOut(activity) }
    }

    fun navigate(screen: String) {
        mutable.update { it.copy(screen = screen, error = null) }
    }

    fun dismissError() {
        mutable.update { it.copy(error = null) }
    }

    fun dismissUpdate() {
        mutable.update { it.copy(update = null) }
    }

    private suspend fun save(uid: String, generation: Int) {
        persistence.withLock { if (epoch == generation) store.write(uid, mutable.value.data) }
    }

    private fun fail(e: Exception, generation: Int) {
        if (epoch == generation)
            mutable.update { it.copy(error = e.localizedMessage ?: "Please try again.") }
    }

    fun refresh() {
        val uid = mutable.value.uid ?: return
        val generation = epoch
        if (!api.configured) return
        viewModelScope.launch {
            if (mutable.value.syncing || mutable.value.busy) return@launch
            mutable.update { it.copy(syncing = true) }
            try {
                val conversations = api.get<List<Conversation>>(uid, "conversations")
                val memories = api.get<List<Memory>>(uid, "memories")
                val notices = api.get<List<Notice>>(uid, "announcements")
                val consent = api.get<Consent>(uid, "consent")
                val selected = mutable.value.selected
                val messages =
                    if (conversations.any { it.id == selected })
                        api.get<List<ChatMessage>>(uid, "conversations/$selected")
                    else emptyList()
                if (epoch == generation) {
                    mutable.update {
                        it.copy(
                            data =
                                mergeHistory(it.data, conversations, messages, selected)
                                    .copy(
                                        memories = memories,
                                        notices = notices,
                                        consent = consent.consent,
                                    )
                        )
                    }
                    save(uid, generation)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e, generation)
            } finally {
                if (epoch == generation) mutable.update { it.copy(syncing = false) }
            }
        }
    }

    fun newChat() {
        if (mutable.value.busy) {
            mutable.update { it.copy(error = "Stop the current reply first.") }
            return
        }
        stopSpeech()
        mutable.update {
            it.copy(selected = UUID.randomUUID().toString(), screen = "Chat", error = null)
        }
    }

    fun openChat(id: String) {
        if (mutable.value.busy) {
            mutable.update { it.copy(error = "Stop the current reply first.") }
            return
        }
        stopSpeech()
        mutable.update { it.copy(selected = id, screen = "Chat") }
        refresh()
    }

    fun send(text: String, retryId: String? = null) {
        val current = mutable.value
        val uid = current.uid ?: return
        if (current.busy || current.syncing || text.isBlank()) return
        if (text.length > 8000) {
            mutable.update { it.copy(error = "Please keep messages under 8,000 characters.") }
            return
        }
        stopSpeech()
        val generation = epoch
        val request = retryId ?: UUID.randomUUID().toString()
        val conversation = current.selected
        val timestamp = System.currentTimeMillis()
        val userMessage =
            ChatMessage(
                "$request-u",
                conversation,
                "user",
                text.trim(),
                timestamp,
                request_id = request,
            )
        val assistant =
            ChatMessage(
                "$request-a",
                conversation,
                "assistant",
                "",
                timestamp + 1,
                "streaming",
                request,
            )
        mutable.update { value ->
            value.copy(
                busy = true,
                error = null,
                data =
                    value.data.copy(
                        messages =
                            value.data.messages.filter { m -> m.request_id != request } +
                                listOf(userMessage, assistant),
                        conversations =
                            listOf(
                                Conversation(
                                    conversation,
                                    value.data.conversations
                                        .find { c -> c.id == conversation }
                                        ?.title ?: text.take(64),
                                    timestamp,
                                )
                            ) + value.data.conversations.filter { c -> c.id != conversation },
                    ),
            )
        }
        reply = viewModelScope.launch {
            var status = "complete"
            try {
                save(uid, generation)
                api.stream(uid, ChatRequest(request, conversation, text.trim())) { delta ->
                    if (epoch == generation)
                        mutable.update {
                            it.copy(
                                data =
                                    it.data.copy(
                                        messages =
                                            it.data.messages.map { m ->
                                                if (m.id == assistant.id)
                                                    m.copy(text = m.text + delta)
                                                else m
                                            }
                                    )
                            )
                        }
                }
            } catch (e: CancellationException) {
                status = "cancelled"
                throw e
            } catch (e: Exception) {
                status = "failed"
                fail(e, generation)
            } finally {
                if (epoch == generation) {
                    mutable.update {
                        it.copy(
                            busy = false,
                            data =
                                it.data.copy(
                                    messages =
                                        it.data.messages.map { m ->
                                            if (m.id == assistant.id) m.copy(status = status) else m
                                        }
                                ),
                        )
                    }
                    withContext(NonCancellable) { save(uid, generation) }
                }
            }
        }
    }

    fun retry(message: ChatMessage) {
        val question =
            mutable.value.data.messages.find {
                it.request_id == message.request_id && it.role == "user"
            } ?: return
        send(question.text, message.request_id)
    }

    fun stop() {
        reply?.cancel()
        stopSpeech()
    }

    fun stopSpeech() {
        speechGeneration++
        speech?.cancel()
        player.stop()
        deviceSpeaker.stop()
        mutable.update { it.copy(speaking = null) }
    }

    fun speak(message: ChatMessage) {
        if (mutable.value.speaking == message.id) {
            stopSpeech()
            return
        }
        val uid = mutable.value.uid ?: return
        val generation = epoch
        stopSpeech()
        val playback = speechGeneration
        mutable.update { it.copy(speaking = message.id) }
        if (mutable.value.data.deviceSpeech) {
            deviceSpeaker.play(
                message.text,
                onFinished = {
                    if (epoch == generation && speechGeneration == playback)
                        mutable.update { it.copy(speaking = null) }
                },
                onError = { error ->
                    if (epoch == generation && speechGeneration == playback)
                        mutable.update { it.copy(speaking = null, error = error) }
                },
            )
            return
        }
        speech = viewModelScope.launch {
            try {
                val audio =
                    api.json.decodeFromString<SpeechAudio>(
                        api.send(uid, "speech", "POST", MessageRequest(message.id))
                    )
                if (epoch == generation && speechGeneration == playback)
                    player.play(
                        audio,
                        onError = { error ->
                            if (epoch == generation && speechGeneration == playback)
                                mutable.update { it.copy(speaking = null, error = error) }
                        },
                    ) {
                        if (epoch == generation && speechGeneration == playback)
                            mutable.update { it.copy(speaking = null) }
                    }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (speechGeneration == playback) {
                    fail(e, generation)
                    if (epoch == generation) mutable.update { it.copy(speaking = null) }
                }
            }
        }
    }

    fun deviceSpeech(value: Boolean) {
        val uid = mutable.value.uid ?: return
        val generation = epoch
        stopSpeech()
        mutable.update { it.copy(data = it.data.copy(deviceSpeech = value)) }
        viewModelScope.launch { save(uid, generation) }
    }

    fun saveMemory(id: String?, text: String) {
        val uid = mutable.value.uid ?: return
        val generation = epoch
        viewModelScope.launch {
            try {
                api.send(
                    uid,
                    "memories",
                    "PUT",
                    MemoryRequest(id ?: UUID.randomUUID().toString(), text),
                )
                if (epoch == generation) refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e, generation)
            }
        }
    }

    fun deleteMemory(id: String) {
        val uid = mutable.value.uid ?: return
        val generation = epoch
        viewModelScope.launch {
            try {
                api.raw(uid, "memories/$id", "DELETE")
                if (epoch == generation) refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e, generation)
            }
        }
    }

    fun deleteChat(id: String) {
        val uid = mutable.value.uid ?: return
        val generation = epoch
        viewModelScope.launch {
            try {
                api.raw(uid, "conversations/$id", "DELETE")
                if (epoch == generation) {
                    mutable.update {
                        it.copy(
                            data =
                                it.data.copy(
                                    conversations =
                                        it.data.conversations.filter { c -> c.id != id },
                                    messages =
                                        it.data.messages.filter { m -> m.conversation_id != id },
                                )
                        )
                    }
                    if (mutable.value.selected == id) newChat()
                    save(uid, generation)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e, generation)
            }
        }
    }

    fun clearLocal() {
        val uid = mutable.value.uid ?: return
        stop()
        epoch++
        val generation = epoch
        session?.cancel()
        api.cancelAll()
        viewModelScope.launch {
            persistence.withLock { store.clear(uid) }
            if (epoch == generation)
                mutable.update {
                    it.copy(
                        data =
                            LocalSnapshot(
                                consent = it.data.consent,
                                deviceSpeech = it.data.deviceSpeech,
                            ),
                        busy = false,
                        syncing = false,
                        selected = UUID.randomUUID().toString(),
                    )
                }
        }
    }

    fun consent(value: Boolean) {
        val uid = mutable.value.uid ?: return
        val generation = epoch
        viewModelScope.launch {
            try {
                api.send(uid, "consent", "PUT", Consent(value))
                if (epoch == generation) {
                    mutable.update { it.copy(data = it.data.copy(consent = value)) }
                    save(uid, generation)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e, generation)
            }
        }
    }

    fun share(message: ChatMessage) {
        val uid = mutable.value.uid ?: return
        val generation = epoch
        viewModelScope.launch {
            try {
                api.send(uid, "examples", "POST", MessageRequest(message.id))
                if (epoch == generation)
                    mutable.update {
                        it.copy(
                            error =
                                "Example shared for owner review. You can withdraw consent in Settings."
                        )
                    }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e, generation)
            }
        }
    }

    fun readNotice(id: String) {
        val uid = mutable.value.uid ?: return
        val generation = epoch
        viewModelScope.launch {
            try {
                api.send(uid, "announcements/read", "POST", NoticeRead(id))
                if (epoch == generation) {
                    mutable.update {
                        it.copy(
                            data =
                                it.data.copy(
                                    notices =
                                        it.data.notices.map { n ->
                                            if (n.id == id) n.copy(read = 1) else n
                                        }
                                )
                        )
                    }
                    save(uid, generation)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e, generation)
            }
        }
    }

    fun checkUpdates() {
        val uid = mutable.value.uid ?: return
        val generation = epoch
        viewModelScope.launch {
            try {
                val update = api.get<UpdateInfo>(uid, "update")
                if (epoch == generation) mutable.update { it.copy(update = update) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e, generation)
            }
        }
    }

    override fun onCleared() {
        loginJob?.cancel()
        updater.cancel()
        auth.removeAuthStateListener(listener)
        session?.cancel()
        reply?.cancel()
        speech?.cancel()
        api.cancelAll()
        player.stop()
        deviceSpeaker.stop()
        deviceSpeaker.close()
        super.onCleared()
    }
}
