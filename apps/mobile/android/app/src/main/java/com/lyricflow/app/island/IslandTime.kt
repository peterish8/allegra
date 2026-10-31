package com.lyricflow.app.island

/** The island's clock text: "2:35", "1:02:03"; [remaining] puts a minus in front ("-2:02"). */
fun islandClock(ms: Long, remaining: Boolean = false): String {
    val total = (ms.coerceAtLeast(0L) / 1000L)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    val body = if (h > 0) "$h:${pad2(m)}:${pad2(s)}" else "$m:${pad2(s)}"
    return if (remaining) "-$body" else body
}

private fun pad2(v: Long) = if (v < 10) "0$v" else "$v"
