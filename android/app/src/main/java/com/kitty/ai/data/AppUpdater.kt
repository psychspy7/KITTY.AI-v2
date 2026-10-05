package com.kitty.ai.data

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

data class UpdateDownload(
    val phase: String = "idle",
    val progress: Float? = null,
    val info: UpdateInfo? = null,
    val error: String? = null,
    val permissionRequired: Boolean = false,
)

/** APKs are kept in private storage. Installation always requires Android's user confirmation. */
class AppUpdater(private val context: Context, private val scope: CoroutineScope) {
    private val client =
        OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .callTimeout(8, TimeUnit.MINUTES)
            .build()
    private val folder = File(context.filesDir, "updates").apply { mkdirs() }
    private val apk = File(folder, "kitty-update.apk")
    private val partial = File(folder, "kitty-update.part")
    private val preferences = context.getSharedPreferences("kitty-updates", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    private val mutable = MutableStateFlow(UpdateDownload())
    val state = mutable.asStateFlow()
    private var job: Job? = null
    private var generation = 0
    private val installedVersion
        get() = version(installed())

    init {
        job = scope.launch {
            val info = runCatching {
                json.decodeFromString<UpdateInfo>(preferences.getString("ready", "")!!)
            }.getOrNull()
            if (info != null && apk.isFile) {
                try {
                    withContext(Dispatchers.IO) { verify(info) }
                    mutable.value = UpdateDownload("ready", info = info)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    preferences.edit().remove("ready").apply()
                    apk.delete()
                }
            }
        }
    }

    fun download(info: UpdateInfo) {
        if (!UpdateRules.metadataValid(info, installedVersion)) {
            mutable.value =
                UpdateDownload(
                    "error",
                    error =
                        "This release needs a trusted URL, a newer version and its APK checksum.",
                )
            return
        }
        val previous = job
        val current = ++generation
        mutable.value = UpdateDownload("downloading", info = info)
        job = scope.launch {
            previous?.cancelAndJoin()
            try {
                withContext(Dispatchers.IO) {
                    preferences.edit().remove("ready").apply()
                    apk.delete()
                    partial.delete()
                    var url = info.url
                    var redirects = 0
                    while (true) {
                        ensureActive()
                        val call = client.newCall(Request.Builder().url(url).build())
                        val watcher =
                            launch(Dispatchers.Default, start = CoroutineStart.UNDISPATCHED) {
                                try {
                                    awaitCancellation()
                                } finally {
                                    call.cancel()
                                }
                            }
                        try {
                            call.execute().use { response ->
                                if (response.code in listOf(301, 302, 303, 307, 308)) {
                                    check(++redirects <= 5) { "Too many download redirects." }
                                    val next =
                                        response.request.url
                                            .resolve(response.header("Location") ?: "")
                                            ?.toString() ?: error("Invalid download redirect.")
                                    check(UpdateRules.redirectAllowed(next)) {
                                        "Untrusted update download redirect."
                                    }
                                    url = next
                                } else {
                                    check(response.isSuccessful) {
                                        "Update download failed (${response.code})."
                                    }
                                    val body = response.body ?: error("Empty download.")
                                    val length = body.contentLength()
                                    check(length <= UpdateRules.MAX_BYTES) {
                                        "Update is too large."
                                    }
                                    var received = 0L
                                    var last = 0L
                                    partial.outputStream().buffered().use { output ->
                                        body.byteStream().use { input ->
                                            val buffer = ByteArray(65536)
                                            while (true) {
                                                ensureActive()
                                                val n = input.read(buffer)
                                                if (n < 0) break
                                                received += n
                                                check(received <= UpdateRules.MAX_BYTES) {
                                                    "Update is too large."
                                                }
                                                output.write(buffer, 0, n)
                                                if (
                                                    System.nanoTime() - last > 100_000_000 &&
                                                        current == generation
                                                ) {
                                                    mutable.value =
                                                        UpdateDownload(
                                                            "downloading",
                                                            if (length > 0)
                                                                (received.toFloat() / length)
                                                                    .coerceIn(0f, 1f)
                                                            else null,
                                                            info,
                                                        )
                                                    last = System.nanoTime()
                                                }
                                            }
                                        }
                                    }
                                    check(received > 0 && (length < 0 || received == length)) {
                                        "Update download was interrupted."
                                    }
                                    check(
                                        partial
                                            .inputStream()
                                            .use { UpdateRules.hash(it) }
                                            .equals(info.sha256, true)
                                    ) {
                                        "APK checksum does not match. Ask the owner to verify this release."
                                    }
                                    apk.delete()
                                    check(partial.renameTo(apk)) { "Unable to save update." }
                                    verify(info)
                                    return@withContext
                                }
                            }
                        } finally {
                            watcher.cancel()
                        }
                    }
                }
                if (current == generation) {
                    preferences.edit().putString("ready", json.encodeToString(info)).apply()
                    mutable.value = UpdateDownload("ready", info = info)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (current == generation)
                    mutable.value =
                        UpdateDownload(
                            "error",
                            info = info,
                            error = e.localizedMessage ?: "Update failed.",
                        )
            } finally {
                withContext(NonCancellable + Dispatchers.IO) { partial.delete() }
            }
        }
    }

    fun cancel() {
        generation++
        job?.cancel()
        client.dispatcher.cancelAll()
        mutable.value = UpdateDownload()
    }

    fun dismiss() {
        if (mutable.value.phase != "downloading") mutable.value = UpdateDownload()
    }

    fun install(activity: Activity) {
        val info = mutable.value.info ?: return
        if (mutable.value.phase != "ready" || job?.isActive == true) return
        val current = generation
        job = scope.launch {
            try {
                withContext(Dispatchers.IO) { verify(info) }
                if (current != generation || activity.isFinishing || activity.isDestroyed)
                    return@launch
                if (!context.packageManager.canRequestPackageInstalls()) {
                    mutable.value = mutable.value.copy(permissionRequired = true)
                    activity.startActivity(
                        Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:${context.packageName}"),
                        )
                    )
                } else {
                    val uri =
                        FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
                    activity.startActivity(
                        Intent(Intent.ACTION_VIEW)
                            .setDataAndType(uri, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    )
                    mutable.value = mutable.value.copy(permissionRequired = false)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                mutable.value =
                    UpdateDownload(
                        "error",
                        info = info,
                        error = e.localizedMessage ?: "Unable to open Android installer.",
                    )
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun installed(): PackageInfo =
        context.packageManager.getPackageInfo(context.packageName, flags())

    @Suppress("DEPRECATION")
    private fun flags() =
        if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES
        else PackageManager.GET_SIGNATURES

    @Suppress("DEPRECATION")
    private fun version(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val signatures =
            if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners
            else info.signatures
        return signatures
            .orEmpty()
            .map {
                MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { b
                    ->
                    "%02x".format(b)
                }
            }
            .toSet()
    }

    private fun verify(info: UpdateInfo) {
        check(UpdateRules.metadataValid(info, installedVersion)) {
            "Update metadata is invalid or the version is already installed."
        }
        check(apk.isFile && apk.length() in 1L..UpdateRules.MAX_BYTES) {
            "Download the update again."
        }
        check(apk.inputStream().use { UpdateRules.hash(it) }.equals(info.sha256, true)) {
            "APK checksum verification failed."
        }
        val candidate =
            context.packageManager.getPackageArchiveInfo(apk.absolutePath, flags())
                ?: error("Invalid APK.")
        val own = installed()
        check(
            UpdateRules.identityMatches(
                context.packageName,
                candidate.packageName,
                version(own),
                info.versionCode.toLong(),
                version(candidate),
                signers(own),
                signers(candidate),
            )
        ) {
            "This APK does not match KITTY's package, version or signing key."
        }
    }
}
