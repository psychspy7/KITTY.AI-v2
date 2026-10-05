package com.kitty.ai.auth

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.kitty.ai.BuildConfig
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class BrowserLogin(context: Context, private val auth: FirebaseAuth) {
    private val prefs = context.getSharedPreferences("kitty-browser-login", Context.MODE_PRIVATE)
    private val client =
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .callTimeout(25, TimeUnit.SECONDS)
            .build()
    private val base = BuildConfig.BACKEND_URL.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    fun hasPending(): Boolean = prefs.getString("id", null) != null

    suspend fun open(activity: Activity) {
        check(base.startsWith("https://") && !base.endsWith(".invalid")) {
            "Backend setup is pending."
        }
        val verifier = LoginProof.newVerifier()
        val result =
            post(
                "start",
                buildJsonObject { put("challenge", LoginProof.challenge(verifier)) }.toString(),
            )
        val id = result.getValue("id").jsonPrimitive.content
        check(Regex("[a-f0-9-]{36}").matches(id)) { "Invalid sign-in response." }
        val expires = result.getValue("expiresAt").jsonPrimitive.content.toLong()
        withContext(Dispatchers.IO) {
            check(
                prefs
                    .edit()
                    .putString("id", id)
                    .putString("verifier", verifier)
                    .putLong("expires", expires)
                    .commit()
            ) {
                "Unable to save sign-in request."
            }
        }
        activity.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse("$base/phone-login.html?session=$id"))
        )
    }

    suspend fun finish() {
        val id = prefs.getString("id", null) ?: return
        val verifier = prefs.getString("verifier", null) ?: error("Open a new browser sign-in.")
        val expires = prefs.getLong("expires", 0L)
        val body = buildJsonObject {
            put("id", id)
            put("verifier", verifier)
        }
            .toString()
        try {
            var connectionFailures = 0
            while (System.currentTimeMillis() < expires) {
                currentCoroutineContext().ensureActive()
                val result =
                    try {
                        post("poll", body)
                    } catch (e: IOException) {
                        android.util.Log.w(
                            "KittyLogin",
                            "Browser poll transport: ${e.javaClass.name}; cause: ${e.cause?.javaClass?.name ?: "none"}; message: ${if (e.message in listOf("Canceled", "Socket closed", "timeout")) e.message else "I/O failure"}",
                        )
                        currentCoroutineContext().ensureActive()
                        if (++connectionFailures >= 5)
                            error(
                                "KITTY cannot reach sign-in right now. Check your connection and try again."
                            )
                        delay(3000)
                        continue
                    }
                connectionFailures = 0
                if (result["pending"]?.jsonPrimitive?.content == "true") {
                    delay(3000)
                    continue
                }
                val token = result.getValue("googleIdToken").jsonPrimitive.content
                val expectedUid = result.getValue("uid").jsonPrimitive.content
                val signedIn =
                    auth
                        .signInWithCredential(GoogleAuthProvider.getCredential(token, null))
                        .await()
                        .user
                if (signedIn == null || signedIn.uid != expectedUid) {
                    auth.signOut()
                    error("Google returned a different account. Please sign in again.")
                }
                return
            }
            error("Browser sign-in expired. Please try again.")
        } catch (e: CancellationException) {
            throw e
        } finally {
            // A lifecycle cancellation keeps the private proof for resume after recreation.
            if (currentCoroutineContext()[kotlinx.coroutines.Job]?.isActive != false) clear()
        }
    }

    suspend fun cancel() {
        val id = prefs.getString("id", null)
        val verifier = prefs.getString("verifier", null)
        clear()
        if (id != null && verifier != null) {
            try {
                post(
                    "cancel",
                    buildJsonObject {
                        put("id", id)
                        put("verifier", verifier)
                    }
                        .toString(),
                )
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                /* Server expires the request after ten minutes. */
            }
        }
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private suspend fun post(path: String, data: String) = coroutineScope {
        val call =
            client.newCall(
                Request.Builder()
                    .url("$base/api/login/browser/$path")
                    .post(data.toRequestBody("application/json".toMediaType()))
                    .build()
            )
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
                    currentCoroutineContext().ensureActive()
                    val result =
                        json.parseToJsonElement(response.body?.string().orEmpty()).jsonObject
                    check(response.isSuccessful) {
                        result["error"]?.jsonPrimitive?.content
                            ?: "Sign-in connection failed (${response.code}). Try again."
                    }
                    result
                }
            }
        } finally {
            watcher.cancel()
        }
    }
}
