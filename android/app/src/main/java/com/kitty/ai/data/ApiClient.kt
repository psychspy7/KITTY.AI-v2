package com.kitty.ai.data

import com.google.firebase.auth.FirebaseAuth
import com.kitty.ai.BuildConfig
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

class ApiClient(private val auth: FirebaseAuth) {
    val json = Json { ignoreUnknownKeys = true }
    private val client =
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(110, TimeUnit.SECONDS)
            .callTimeout(120, TimeUnit.SECONDS)
            .build()
    private val base = BuildConfig.BACKEND_URL.trimEnd('/')
    val configured
        get() = !base.endsWith(".invalid")

    private suspend fun request(
        uid: String,
        path: String,
        method: String,
        payload: String?,
    ): Request {
        check(configured) { "Backend setup is pending. Open Settings for setup details." }
        val account = auth.currentUser ?: error("Please sign in.")
        check(account.uid == uid) { "Account changed. Please try again." }
        val token = account.getIdToken(false).await().token ?: error("Please sign in again.")
        check(auth.currentUser?.uid == uid) { "Account changed." }
        return Request.Builder()
            .url("$base/api/$path")
            .header("Authorization", "Bearer $token")
            .method(method, payload?.toRequestBody("application/json".toMediaType()))
            .build()
    }

    suspend fun raw(
        uid: String,
        path: String,
        method: String = "GET",
        payload: String? = null,
    ): String {
        val request = request(uid, path, method, payload)
        return coroutineScope {
            val call = client.newCall(request)
            val watcher =
                launch(Dispatchers.Default, start = CoroutineStart.UNDISPATCHED) {
                    try {
                        awaitCancellation()
                    } finally {
                        call.cancel()
                    }
                }
            try {
                withContext(Dispatchers.IO) {
                    call.execute().use { response ->
                        val data = response.body?.string().orEmpty()
                        if (!response.isSuccessful) error(errorMessage(data, response.code))
                        data
                    }
                }
            } finally {
                watcher.cancel()
            }
        }
    }

    suspend inline fun <reified T> get(uid: String, path: String): T =
        json.decodeFromString(raw(uid, path))

    suspend inline fun <reified T> send(
        uid: String,
        path: String,
        method: String,
        data: T,
    ): String = raw(uid, path, method, json.encodeToString(data))

    suspend fun stream(uid: String, input: ChatRequest, onDelta: (String) -> Unit): ReplyReceipt {
        val request = request(uid, "chat", "POST", json.encodeToString(input))
        return coroutineScope {
            val call = client.newCall(request)
            val watcher =
                launch(Dispatchers.Default, start = CoroutineStart.UNDISPATCHED) {
                    try {
                        awaitCancellation()
                    } finally {
                        call.cancel()
                    }
                }
            val pending = StringBuilder()
            var last = System.nanoTime()
            var receipt = ReplyReceipt()
            try {
                withContext(Dispatchers.IO) {
                    call.execute().use { response ->
                        if (!response.isSuccessful)
                            error(errorMessage(response.body?.string().orEmpty(), response.code))
                        val source = response.body?.source() ?: error("Empty reply.")
                        val events = ReplyEvents()
                        var done = false
                        while (!done && !source.exhausted()) {
                            currentCoroutineContext().ensureActive()
                            val line = source.readUtf8Line() ?: break
                            val event = events.line(line) ?: continue
                            if (event.type !in listOf("delta", "done", "error")) continue
                            val payload = json.parseToJsonElement(event.data).jsonObject
                            when (event.type) {
                                "delta" -> {
                                    pending.append(
                                        payload["text"]?.jsonPrimitive?.content.orEmpty()
                                    )
                                    if (System.nanoTime() - last > 50_000_000) {
                                        onDelta(pending.toString())
                                        pending.clear()
                                        last = System.nanoTime()
                                    }
                                }
                                "done" -> {
                                    receipt = json.decodeFromString<ReplyReceipt>(event.data)
                                    done = true
                                }
                                "error" ->
                                    error(
                                        payload["message"]?.jsonPrimitive?.content
                                            ?: "Reply interrupted. Try again."
                                    )
                            }
                        }
                        check(done) { "Connection interrupted. Retry this message." }
                    }
                }
            } finally {
                if (pending.isNotEmpty()) onDelta(pending.toString())
                watcher.cancel()
            }
            receipt
        }
    }

    private fun errorMessage(data: String, code: Int) =
        runCatching { json.parseToJsonElement(data).jsonObject["error"]?.jsonPrimitive?.content }
            .getOrNull() ?: "Connection failed ($code). Try again."

    fun cancelAll() = client.dispatcher.cancelAll()
}
