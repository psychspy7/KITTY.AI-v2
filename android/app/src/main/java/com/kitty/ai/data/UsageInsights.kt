package com.kitty.ai.data

import android.content.Context
import android.os.Bundle
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.perf.FirebasePerformance

/** Fixed aggregate labels only. Never accepts account IDs, free text, URLs or errors. */
class UsageInsights(context: Context) {
    private val analytics = FirebaseAnalytics.getInstance(context)
    private val performance = FirebasePerformance.getInstance()
    private var enabled = false
    fun configure(value: Boolean, reset: Boolean = false) {
        analytics.setAnalyticsCollectionEnabled(false)
        performance.isPerformanceCollectionEnabled = false
        if (reset) analytics.resetAnalyticsData()
        analytics.setUserId(null)
        analytics.setConsent(mapOf(
            FirebaseAnalytics.ConsentType.ANALYTICS_STORAGE to if (value) FirebaseAnalytics.ConsentStatus.GRANTED else FirebaseAnalytics.ConsentStatus.DENIED,
            FirebaseAnalytics.ConsentType.AD_STORAGE to FirebaseAnalytics.ConsentStatus.DENIED,
            FirebaseAnalytics.ConsentType.AD_USER_DATA to FirebaseAnalytics.ConsentStatus.DENIED,
            FirebaseAnalytics.ConsentType.AD_PERSONALIZATION to FirebaseAnalytics.ConsentStatus.DENIED,
        ))
        enabled = value
        analytics.setAnalyticsCollectionEnabled(value)
        performance.isPerformanceCollectionEnabled = value
    }
    fun screen(screen: String) {
        if (!enabled || screen !in listOf("Chat", "History", "Memory", "Inbox", "Settings")) return
        analytics.logEvent("kitty_screen", Bundle().apply { putString("screen", screen.lowercase()) })
    }
    enum class Operation { STARTUP, REPLY, SYNC }
    enum class Outcome { COMPLETE, FAILED, CANCELLED }
    fun measured(operation: Operation, elapsed: Long, outcome: Outcome) {
        if (!enabled) return
        analytics.logEvent("kitty_${operation.name.lowercase()}", Bundle().apply { putString("result", outcome.name.lowercase()) })
        val trace = performance.newTrace("kitty_${operation.name.lowercase()}")
        trace.start()
        trace.putMetric("elapsed_ms", elapsed.coerceAtLeast(0))
        trace.putAttribute("result", outcome.name.lowercase())
        trace.stop()
    }
}
