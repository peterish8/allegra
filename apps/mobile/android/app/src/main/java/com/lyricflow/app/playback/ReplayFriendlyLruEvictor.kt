package com.lyricflow.app.playback

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheEvictor
import androidx.media3.datasource.cache.CacheSpan

/**
 * Media3's side of [CacheBudget]: an LRU evictor whose ceiling can change while the cache is open (a SimpleCache
 * can only be opened once per folder per process) and which keeps recently played songs' openings.
 *
 * SimpleCache calls these methods while holding its own lock. [trim] takes that lock through `removeSpan`, so it
 * must be called off the main thread.
 */
@OptIn(UnstableApi::class)
class ReplayFriendlyLruEvictor(initialMaxBytes: Long) : CacheEvictor {
    private val budget = CacheBudget(initialMaxBytes)
    private val bySpan = HashMap<CacheSpan, SpanInfo>()

    var maxBytes: Long
        get() = budget.maxBytes
        set(value) { budget.maxBytes = value }

    override fun requiresCacheSpanTouches(): Boolean = true

    override fun onCacheInitialized() = Unit

    override fun onStartFile(cache: Cache, key: String, position: Long, length: Long) {
        if (length != C.LENGTH_UNSET.toLong()) evict(cache, length)
    }

    override fun onSpanAdded(cache: Cache, span: CacheSpan) {
        val info = SpanInfo(span, span.position, span.length, span.lastTouchTimestamp)
        bySpan[span] = info
        budget.added(info)
        evict(cache, 0)
    }

    override fun onSpanRemoved(cache: Cache, span: CacheSpan) {
        bySpan.remove(span)?.let(budget::removed)
    }

    override fun onSpanTouched(cache: Cache, oldSpan: CacheSpan, newSpan: CacheSpan) {
        onSpanRemoved(cache, oldSpan)
        onSpanAdded(cache, newSpan)
    }

    /** Applies a lowered ceiling now. Off the main thread. */
    fun trim(cache: Cache) = evict(cache, 0)

    private fun evict(cache: Cache, required: Long) {
        for (victim in budget.victims(required)) {
            try { cache.removeSpan(victim.id as CacheSpan) } catch (_: Exception) { /* already gone */ }
        }
    }
}
