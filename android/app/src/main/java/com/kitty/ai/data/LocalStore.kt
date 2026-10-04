package com.kitty.ai.data

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Private app storage; backups are disabled. Account data is keyed by the verified UID. */
class LocalStore(context: Context) {
    private val root = File(context.filesDir, "accounts").apply { mkdirs() }
    private val json = Json { ignoreUnknownKeys = true }

    private fun file(uid: String): AtomicFile {
        val safe =
            MessageDigest.getInstance("SHA-256").digest(uid.toByteArray()).joinToString("") {
                "%02x".format(it)
            }
        return AtomicFile(File(root, "$safe.json"))
    }

    suspend fun read(uid: String): LocalSnapshot =
        withContext(Dispatchers.IO) {
            runCatching { json.decodeFromString<LocalSnapshot>(String(file(uid).readFully())) }
                .getOrDefault(LocalSnapshot())
        }

    suspend fun write(uid: String, snapshot: LocalSnapshot) =
        withContext(Dispatchers.IO) {
            val target = file(uid)
            val stream = target.startWrite()
            try {
                stream.write(json.encodeToString(snapshot).toByteArray())
                target.finishWrite(stream)
            } catch (e: Exception) {
                target.failWrite(stream)
                throw e
            }
        }

    suspend fun clear(uid: String) = withContext(Dispatchers.IO) { file(uid).delete() }
}
