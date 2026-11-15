package com.lyricflow.app.playback

import java.util.TreeSet

/** A cached span as the budget sees it. [id] is any stable identity the evictor maps back to a cache span. */
data class SpanInfo(val id: Any, val position: Long, val length: Long, val lastTouch: Long)

/**
 * The stream cache's eviction arithmetic, with no Media3 types so it is JVM-tested.
 *
 * Least recently used first, with one exception: spans that start in a song's first [headBytes] (its opening
 * seconds) are protected up to [headBudgetBytes] in total, because plain LRU always evicts a track's opening first
 * and a replay would then start from the network. Protected heads go only after every ordinary span.
 * [maxBytes] can move at runtime (the listener's setting) without reopening the cache.
 */
class CacheBudget(
    @Volatile var maxBytes: Long,
    private val headBytes: Long = HEAD_BYTES,
    private val headBudgetBytes: Long = HEAD_BUDGET_BYTES,
) {
    private val ordinary = TreeSet(ORDER)
    private val heads = TreeSet(ORDER)
    private var headSize = 0L

    var totalSize = 0L
        private set

    fun added(span: SpanInfo) {
        if (span.position < headBytes && headSize + span.length <= headBudgetBytes) {
            heads.add(span)
            headSize += span.length
        } else {
            ordinary.add(span)
        }
        totalSize += span.length
    }

    fun removed(span: SpanInfo) {
        if (heads.remove(span)) headSize -= span.length else if (!ordinary.remove(span)) return
        totalSize -= span.length
    }

    /** Spans to evict, oldest first, so that totalSize + [requiredBytes] fits under [maxBytes]. Changes nothing. */
    fun victims(requiredBytes: Long): List<SpanInfo> {
        var need = totalSize + requiredBytes - maxBytes
        if (need <= 0) return emptyList()
        val out = ArrayList<SpanInfo>()
        for (span in ordinary) { if (need <= 0) break; out += span; need -= span.length }
        for (span in heads) { if (need <= 0) break; out += span; need -= span.length }
        return out
    }

    companion object {
        /** About 13 s at 320 kbps. */
        const val HEAD_BYTES = 512L * 1024
        const val HEAD_BUDGET_BYTES = 32L * 1024 * 1024
        val ORDER: Comparator<SpanInfo> = compareBy<SpanInfo>({ it.lastTouch }, { it.position }, { System.identityHashCode(it.id) })
    }
}
