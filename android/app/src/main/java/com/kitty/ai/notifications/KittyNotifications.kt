package com.kitty.ai.notifications

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.auth.FirebaseAuth
import com.kitty.ai.BuildConfig
import com.kitty.ai.MainActivity
import com.kitty.ai.R
import com.kitty.ai.data.ChatMessage
import com.kitty.ai.data.Notice
import com.kitty.ai.data.UpdateInfo
import java.security.MessageDigest

/** All foreground/background receipts share a lock, and are scoped to the verified account. */
internal class KittyNotifications(
    context: Context,
    private val accountUid: () -> String? = { FirebaseAuth.getInstance().currentUser?.uid },
) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("kitty-alerts", Context.MODE_PRIVATE)
    private val manager = app.getSystemService(NotificationManager::class.java)

    init {
        val sound = Uri.parse("android.resource://${app.packageName}/raw/kitty_meow")
        val audio =
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        manager.createNotificationChannels(
            listOf(
                channel(
                    REPLIES,
                    "KITTY replies",
                    "A short meow when a reply finishes.",
                    sound,
                    audio,
                ),
                channel(INBOX, "Inbox announcements", "New notes from Kitty Corp.", sound, audio),
                channel(UPDATES, "App updates", "Trusted KITTY releases.", sound, audio),
            )
        )
    }

    private fun channel(
        id: String,
        name: String,
        description: String,
        sound: Uri,
        audio: AudioAttributes,
    ) =
        NotificationChannel(id, name, NotificationManager.IMPORTANCE_DEFAULT).apply {
            this.description = description
            setSound(sound, audio)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            enableVibration(false)
        }

    fun allowed(): Boolean =
        prefs.getBoolean("opt-in", false) &&
            (Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(app).areNotificationsEnabled()

    fun needsPrompt(): Boolean = !prefs.getBoolean("permission-explained", false) && !allowed()

    fun promptHandled() {
        prefs.edit().putBoolean("permission-explained", true).apply()
    }

    fun optIn() {
        prefs.edit().putBoolean("opt-in", true).apply()
    }

    fun settingsIntent() =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, app.packageName)

    fun activate(uid: String?) =
        synchronized(lock) {
            val changed = prefs.getString("active-account", null) != uid
            if (changed) {
                manager.cancelAll()
                prefs.edit().putString("active-account", uid).apply()
            }
            changed
        }

    fun matches(uid: String): Boolean =
        AlertPolicy.accountMatches(
            uid,
            accountUid(),
            prefs.getString("active-account", null),
        )

    fun seedNotices(uid: String, cached: List<Notice>) =
        synchronized(lock) {
            val key = key(uid, "notices")
            if (matches(uid) && !prefs.contains(key) && cached.isNotEmpty())
                prefs.edit().putStringSet(key, cached.map { it.id }.toSet()).apply()
        }

    fun observeNotices(uid: String, notices: List<Notice>) =
        synchronized(lock) {
            if (!matches(uid)) return@synchronized
            val key = key(uid, "notices")
            val seen = prefs.getStringSet(key, null)?.toSet()
            val fresh = AlertPolicy.newNotices(notices, seen)
            val acknowledged =
                if (
                    fresh.isEmpty() ||
                        post(
                            uid,
                            INBOX,
                            "Inbox",
                            null,
                            "A note from Kitty Corp",
                            "${fresh.size} new Inbox announcement${if (fresh.size == 1) "" else "s"}. Tap to read.",
                        )
                )
                    notices.map { it.id }.toSet()
                else notices.filter { it.id !in fresh.map { n -> n.id } }.map { it.id }.toSet()
            prefs
                .edit()
                .putStringSet(key, ((seen ?: emptySet()) + acknowledged).takeLastSet(200))
                .apply()
        }

    fun observeUpdate(uid: String, info: UpdateInfo) =
        synchronized(lock) {
            if (!matches(uid)) return@synchronized
            val key = key(uid, "update")
            if (
                AlertPolicy.updateReady(info, BuildConfig.VERSION_CODE, prefs.getInt(key, 0)) &&
                    post(
                        uid,
                        UPDATES,
                        "Update",
                        null,
                        "KITTY ${info.versionName.take(40)} is available",
                        "A new update is ready. Tap to review and install.",
                    )
            )
                prefs.edit().putInt(key, info.versionCode).apply()
        }

    fun replyFinished(uid: String, message: ChatMessage) =
        synchronized(lock) {
            if (!matches(uid)) return@synchronized
            val key = key(uid, "replies")
            val seen = prefs.getStringSet(key, emptySet())!!.toSet()
            if (
                AlertPolicy.replyReady(message, seen) &&
                    post(
                        uid,
                        REPLIES,
                        "Chat",
                        message.conversation_id,
                        "KITTY replied",
                        "Your reply is ready. Tap to open chat.",
                    )
            )
                prefs.edit().putStringSet(key, (seen + message.id).takeLastSet(100)).apply()
        }

    @SuppressLint(
        "MissingPermission"
    ) // allowed() checks runtime permission; revoke races are caught below.
    private fun post(
        uid: String,
        channel: String,
        page: String,
        conversation: String?,
        title: String,
        body: String,
    ): Boolean {
        if (
            !matches(uid) ||
                !allowed() ||
                manager.getNotificationChannel(channel)?.importance ==
                    NotificationManager.IMPORTANCE_NONE
        )
            return false
        val intent =
            Intent(app, MainActivity::class.java).apply {
                action = OPEN_ALERT
                data =
                    Uri.parse("kitty-alert://open/${key(uid, channel)}/${conversation.orEmpty()}")
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(ACCOUNT, uid)
                putExtra(PAGE, page)
                putExtra(CONVERSATION, conversation)
            }
        val pending =
            PendingIntent.getActivity(
                app,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val notification =
            NotificationCompat.Builder(app, channel)
                .setSmallIcon(R.drawable.ic_kitty_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPublicVersion(
                    NotificationCompat.Builder(app, channel)
                        .setSmallIcon(R.drawable.ic_kitty_notification)
                        .setContentTitle("KITTY AI")
                        .setContentText("You have a new notification.")
                        .build()
                )
                .build()
        return try {
            manager.notify(key(uid, channel), 1, notification)
            true
        } catch (_: SecurityException) {
            false
        }
    }

    private fun key(uid: String, suffix: String) =
        MessageDigest.getInstance("SHA-256").digest(uid.toByteArray()).joinToString("") {
            "%02x".format(it)
        } + ":" + suffix

    private fun Set<String>.takeLastSet(limit: Int) = toList().takeLast(limit).toSet()

    companion object {
        private val lock = Any()
        const val REPLIES = "kitty_replies_meow_v1"
        const val INBOX = "kitty_inbox_meow_v1"
        const val UPDATES = "kitty_updates_meow_v1"
        const val OPEN_ALERT = "com.kitty.ai.OPEN_ALERT"
        const val ACCOUNT = "kitty_account"
        const val PAGE = "kitty_page"
        const val CONVERSATION = "kitty_conversation"
    }
}
