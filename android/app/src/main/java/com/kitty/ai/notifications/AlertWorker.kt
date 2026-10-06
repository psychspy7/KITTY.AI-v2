package com.kitty.ai.notifications

import android.content.Context
import androidx.work.*
import com.google.firebase.auth.FirebaseAuth
import com.kitty.ai.data.ApiClient
import com.kitty.ai.data.Notice
import com.kitty.ai.data.UpdateInfo
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

/** Background checks, not server push. Android may defer them for battery/network constraints. */
class AlertWorker(context: Context, parameters: WorkerParameters) :
    CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val uid = inputData.getString("uid") ?: return Result.success()
        val notifications = KittyNotifications(applicationContext)
        if (!notifications.allowed() || !notifications.matches(uid)) return Result.success()
        val api = ApiClient(FirebaseAuth.getInstance())
        if (!api.configured) return Result.success()
        return try {
            withTimeout(45000) {
                val notices = api.get<List<Notice>>(uid, "announcements")
                if (!notifications.matches(uid)) return@withTimeout
                notifications.observeNotices(uid, notices)
                val update = api.get<UpdateInfo>(uid, "update")
                notifications.observeUpdate(uid, update)
            }
            Result.success()
        } catch (_: TimeoutCancellationException) {
            if (runAttemptCount < 2) Result.retry() else Result.failure()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            if (runAttemptCount < 2) Result.retry() else Result.failure()
        } finally {
            api.cancelAll()
        }
    }
}

object AlertScheduler {
    private const val PERIODIC = "kitty-account-alerts"
    private const val NOW = "kitty-account-alerts-now"

    private fun constraints() =
        Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun activate(context: Context, uid: String?, changed: Boolean) {
        val work = WorkManager.getInstance(context)
        if (changed || uid == null || !KittyNotifications(context).allowed()) {
            work.cancelUniqueWork(PERIODIC)
            work.cancelUniqueWork(NOW)
        }
        if (uid == null || !KittyNotifications(context).allowed()) return
        val input = workDataOf("uid" to uid)
        work.enqueueUniquePeriodicWork(
            PERIODIC,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<AlertWorker>(15, TimeUnit.MINUTES)
                .setInputData(input)
                .setConstraints(constraints())
                .setInitialDelay(15, TimeUnit.MINUTES)
                .build(),
        )
    }

    fun checkNow(context: Context, uid: String) {
        if (!KittyNotifications(context).allowed()) return
        WorkManager.getInstance(context)
            .enqueueUniqueWork(
                NOW,
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<AlertWorker>()
                    .setInputData(workDataOf("uid" to uid))
                    .setConstraints(constraints())
                    .build(),
            )
    }
}
