package com.lyricflow.app.views

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.accessibility.AccessibilityNodeInfo
import android.view.animation.PathInterpolator
import android.widget.OverScroller
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.customview.widget.ExploreByTouchHelper
import androidx.media3.common.Player
import com.lyricflow.app.island.IslandFonts
import com.lyricflow.app.island.IslandPlayback
import com.lyricflow.app.lyrics.LyricsConfig
import com.lyricflow.app.lyrics.LyricsLayouts
import com.lyricflow.app.lyrics.LyricsMath
import com.lyricflow.app.lyrics.LyricsParser
import com.lyricflow.app.lyrics.LyricsSheet
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Now Playing's synchronized lyrics, drawn and scrolled in Kotlin: the same lines, motion and timing as the React
 * Native list (`SynchronizedLyrics.tsx`), which stays as the fallback for iOS, plain lyrics, Connect remote playback
 * and builds without this view.
 *
 * One playback authority: the lines follow the Media3 player's own clock, read on the main thread only while the
 * lyrics are on screen and the song plays, and only for the recording the lines were fetched for (media IDs are
 * song IDs). A tap goes back to JavaScript's playback flow (`onLyricPress`), which seeks and resumes.
 */
class NativeLyricsView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onLyricPress by EventDispatcher<Map<String, Any>>()
    private val onScrollState by EventDispatcher<Map<String, Any>>()
    private val onAtTop by EventDispatcher<Map<String, Any>>()
    private val onPill by EventDispatcher<Map<String, Any>>()

    private val density = resources.displayMetrics.density
    private val main = Handler(Looper.getMainLooper())

    // ── Props, applied in one batch (`commit`) ──────────────────────────────
    private var payloadJson = ""
    private var configJson = ""
    private var seedMs = 0L
    private var live = false
    private var resumeSignal = 0
    private var propsDirty = false

    private var appliedPayload = ""
    private var appliedConfig = ""
    private var sheet: LyricsSheet? = null
    private var config: LyricsConfig? = null
    private var layouts: LyricsLayouts? = null
    private var generation = 0

    // ── Scroll and follow state ─────────────────────────────────────────────
    private var scrollY = 0f
    private var contentH = 0f
    private var activeIdx = -1
    private var userScrolling = false
    private var dragging = false
    private var flinging = false
    private var scrollEndAt = 0L
    private var glide = 0f
    private var glideVelocity = 0f
    private var glideRunning = false
    private var lastIndex = -1
    private var seen = false
    private var seenIdx = -1
    private var seenTarget = -1f
    private var seenUser = false
    private var pillDir = 0
    private var atTop: Boolean? = null

    // ── Per-line animation ──────────────────────────────────────────────────
    private var alphas = Tween(0)
    private var sweeps = Tween(0)
    private var eqSince = LongArray(0)
    private var eqDecayAt = LongArray(0)
    private val eqDecayFrom = HashMap<Int, FloatArray>()
    private var sweepOffset = 0f
    private var dirty = true

    // ── Clock ───────────────────────────────────────────────────────────────
    private var player: Player? = null
    private var unwatch: (() -> Unit)? = null
    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = wake()
    }
    private var framePosted = false
    private var lastFrameNanos = 0L
    private val frame = Choreographer.FrameCallback { nanos ->
        framePosted = false
        val busy = tick(nanos)
        if (dirty) {
            dirty = false
            invalidate()
        }
        if (busy) wake() else lastFrameNanos = 0L
    }

    // ── Touch ───────────────────────────────────────────────────────────────
    private val scroller = OverScroller(context)
    private val configuration = ViewConfiguration.get(context)
    private var velocity: VelocityTracker? = null
    private var downX = 0f
    private var downY = 0f
    private var lastY = 0f
    private var grabbedFling = false
    private val resumeRunnable = Runnable { resumeFollowing() }

    // ── Drawing ─────────────────────────────────────────────────────────────
    private val eqPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val eqRect = RectF()
    private val maskPaint = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT) }
    private val maskShader = LinearGradient(0f, 0f, 0f, 1f, Color.BLACK, Color.TRANSPARENT, Shader.TileMode.CLAMP)
    private val maskMatrix = Matrix()
    private val dimEase = PathInterpolator(0.4f, 0f, 0.2f, 1f)
    private var fontListener: (() -> Unit)? = null
    private var removeFontListener: (() -> Unit)? = null
    private val access = Access(this)

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        androidx.core.view.ViewCompat.setAccessibilityDelegate(this, access)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }

    // ── Props ───────────────────────────────────────────────────────────────

    fun setPayload(json: String?) { payloadJson = json.orEmpty(); propsDirty = true }
    fun setConfig(json: String?) { configJson = json.orEmpty(); propsDirty = true }
    fun setSeed(ms: Double?) { seedMs = (ms ?: 0.0).toLong().coerceAtLeast(0); propsDirty = true }
    fun setLive(on: Boolean?) { live = on ?: false; propsDirty = true }
    fun setResumeSignal(value: Int?) {
        val next = value ?: 0
        if (next != resumeSignal) {
            resumeSignal = next
            propsDirty = true
            main.post { resumeFollowing() }
        }
    }

    /** Called once every prop of an update has landed. */
    fun commit() {
        if (!propsDirty) return
        propsDirty = false
        applyLive()
        rebuildIfNeeded()
        wake()
    }

    private fun applyLive() {
        importantForAccessibility = if (live) View.IMPORTANT_FOR_ACCESSIBILITY_YES else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        if (liveApplied == live) return
        liveApplied = live
        // Hidden lyrics are inert: nothing follows the song, and reopening puts everything right in one step.
        stopGlide()
        scroller.abortAnimation()
        flinging = false
        dragging = false
        if (userScrolling) {
            userScrolling = false
            onScrollState(mapOf("scrolling" to false))
        }
        seen = false
        atTop = null
        pillDir = 0
        if (live) snapState(SystemClock.uptimeMillis()) else main.removeCallbacks(resumeRunnable)
        dirty = true
    }

    private var liveApplied = false

    // ── Building the layouts, off the main thread ───────────────────────────

    private fun rebuildIfNeeded() {
        val w = width
        if (w <= 0) return
        val payloadChanged = payloadJson != appliedPayload
        val configChanged = configJson != appliedConfig
        if (!payloadChanged && !configChanged && layouts?.width == w) return
        val payload = payloadJson
        val configText = configJson
        val gen = ++generation
        val previous = layouts
        val previousSheet = sheet
        val previousConfig = config
        val fontScale = resources.configuration.fontScale
        val face = IslandFonts.bold
        val font = System.identityHashCode(face)
        if (fontListener == null) {
            // Release builds copy the app's fonts out once; when they arrive the lines are laid out again in SF Pro.
            fontListener = { main.post { appliedConfig = ""; rebuildIfNeeded() } }
            removeFontListener = IslandFonts.load(context, fontListener!!)
        }
        BUILDER.execute {
            if (gen != generation) return@execute
            val nextSheet = if (payloadChanged || previousSheet == null) LyricsParser.sheet(payload) else previousSheet
            val nextConfig = if (configChanged || previousConfig == null) LyricsParser.config(configText) else previousConfig
            if (nextSheet == null || nextConfig == null) return@execute
            val reuse = previous != null && previous.reusableFor(nextSheet, nextConfig.layoutKey(), w, font)
            val built = if (reuse) previous!!.withSheet(nextSheet, nextConfig)
            else LyricsLayouts.build(nextSheet, nextConfig, w, density, fontScale, face, font) { gen != generation }
            if (built == null) return@execute
            main.post {
                if (gen != generation) return@post
                adopt(payload, configText, nextSheet, nextConfig, built)
            }
        }
    }

    private fun adopt(payload: String, configText: String, nextSheet: LyricsSheet, nextConfig: LyricsConfig, built: LyricsLayouts) {
        val old = sheet
        val sameLines = old != null && old.songId == nextSheet.songId && old.sameText(nextSheet)
        appliedPayload = payload
        appliedConfig = configText
        sheet = nextSheet
        config = nextConfig
        layouts = built
        if (!sameLines) {
            val n = nextSheet.rows.size
            alphas = Tween(n)
            sweeps = Tween(n)
            eqSince = LongArray(n) { -1 }
            eqDecayAt = LongArray(n) { -1 }
            eqDecayFrom.clear()
            scrollY = 0f
            activeIdx = -1
            seen = false
            lastIndex = -1
            stopGlide()
            atTop = null
        }
        measureContent()
        if (live) {
            // New lines start like a fresh show. The same lines with new timings (a delay change) keep the list
            // where it is and glide to wherever the sung line now is.
            if (!sameLines) snapState(SystemClock.uptimeMillis())
            else scrollY = scrollY.coerceIn(0f, max(0f, contentH - height))
        }
        access.invalidateRoot()
        dirty = true
        wake()
    }

    private fun measureContent() {
        val l = layouts ?: return
        val c = config ?: return
        val footer = LyricsMath.anchorFooter(height.toFloat(), c.activePos, c.bottomSpacer * density)
        contentH = c.topSpacer * density + l.total + footer
    }

    private fun rowTop(i: Int): Float = (config?.topSpacer ?: 0f) * density + (layouts?.offsets?.get(i) ?: 0f)

    // ── The clock ───────────────────────────────────────────────────────────

    private fun positionMs(): Long {
        val s = sheet ?: return 0
        val p = player
        // Only the recording these lines belong to moves them; anything else holds at the position JavaScript last knew.
        if (p == null || p.currentMediaItem?.mediaId != s.songId) return seedMs
        return p.currentPosition.coerceAtLeast(0)
    }

    private fun isPlaying(): Boolean {
        val p = player ?: return false
        return p.isPlaying && p.currentMediaItem?.mediaId == sheet?.songId
    }

    fun wake() {
        if (framePosted || !isAttachedToWindow) return
        framePosted = true
        Choreographer.getInstance().postFrameCallback(frame)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        unwatch = IslandPlayback.watch { p ->
            player?.removeListener(listener)
            player = p
            p?.addListener(listener)
            wake()
        }
        wake()
    }

    override fun onDetachedFromWindow() {
        unwatch?.invoke()
        unwatch = null
        player?.removeListener(listener)
        player = null
        Choreographer.getInstance().removeFrameCallback(frame)
        framePosted = false
        main.removeCallbacks(resumeRunnable)
        removeFontListener?.invoke()
        removeFontListener = null
        fontListener = null
        generation++
        scroller.abortAnimation()
        super.onDetachedFromWindow()
    }

    override fun onConfigurationChanged(newConfig: Configuration?) {
        super.onConfigurationChanged(newConfig)
        appliedConfig = ""
        rebuildIfNeeded()
    }

    // ── One frame ───────────────────────────────────────────────────────────

    /** Jump every part of the state to where the song is now: no glide, no fades. */
    private fun snapState(now: Long) {
        if (layouts == null) return
        val s = sheet ?: return
        measureContent()
        val idx = LyricsMath.activeIndex(s.atMs, positionMs())
        activeIdx = idx
        for (i in s.rows.indices) {
            alphas.snap(i, restTarget(i, idx))
            sweeps.snap(i, if (i == idx && sweeping(i)) 1f else 0f)
            eqSince[i] = if (i == idx && s.rows[i].instrumental) now else -1
            eqDecayAt[i] = -1
        }
        eqDecayFrom.clear()
        val target = targetFor(idx)
        seen = true
        seenIdx = idx
        seenTarget = target
        seenUser = userScrolling
        lastIndex = if (idx >= 0) idx else -1
        if (target >= 0f) scrollY = target
        glideRunning = false
        glide = 0f
        glideVelocity = 0f
        dirty = true
    }

    private fun sweeping(i: Int): Boolean {
        val s = sheet ?: return false
        if (i !in s.rows.indices) return false
        val row = s.rows[i]
        return s.letters && row.hasSegments && !row.instrumental
    }

    private fun restTarget(i: Int, idx: Int): Float = LyricsMath.restOpacity(i, idx, userScrolling, sweeping(i))

    private fun targetFor(idx: Int): Float {
        val l = layouts ?: return -1f
        val c = config ?: return -1f
        if (idx < 0 || idx >= l.rows.size || height <= 0 || contentH <= 0f) return -1f
        return LyricsMath.anchorScrollY(rowTop(idx), l.rows[idx].height, height.toFloat(), c.activePos, contentH)
    }

    /** Returns whether another frame is needed. */
    private fun tick(frameNanos: Long): Boolean {
        val s = sheet ?: return false
        val l = layouts ?: return false
        val c = config ?: return false
        if (!live || height <= 0) return false
        val now = SystemClock.uptimeMillis()
        val dt = if (lastFrameNanos == 0L) 1f / 60f else ((frameNanos - lastFrameNanos) / 1e9f).coerceIn(0f, 0.05f)
        lastFrameNanos = frameNanos
        val pos = positionMs()
        val idx = LyricsMath.activeIndex(s.atMs, pos)
        val target = targetFor(idx)
        activeIdx = idx
        follow(idx, target, now)

        // The glide: the lines ease home on a critically damped follow.
        if (glideRunning) {
            if (target < 0f || userScrolling) {
                stopGlide()
            } else {
                val next = LyricsMath.glideStep(glide, glideVelocity, dt)
                val settled = abs(next.offset) < 0.75f * density && abs(next.velocity) < 6f * density
                glide = if (settled) 0f else next.offset
                glideVelocity = if (settled) 0f else next.velocity
                scrollY = (target + glide).coerceIn(0f, max(0f, contentH - height))
                if (settled) glideRunning = false
                dirty = true
            }
        }
        if (alphas.step(now, dimEase)) dirty = true
        if (sweeps.step(now, dimEase)) dirty = true

        // The sung line's sweep follows the player's position; it needs a redraw only when that moves (or a sweep fades).
        if (pos != sweepPos) {
            sweepPos = pos
            if (sweeps.anyShown()) dirty = true
        }
        // The equalizer dances while its line is sung and on screen, and settles when the next line takes over.
        var animating = glideRunning || alphas.busy() || sweeps.busy() || !scroller.isFinished
        if (idx >= 0 && s.rows[idx].instrumental && rowVisible(idx)) {
            dirty = true
            animating = true
        } else if (eqFading(now)) {
            dirty = true
            animating = true
        }
        updateEdges()
        return animating || isPlaying()
    }

    private var sweepPos = -1L

    private fun rowVisible(i: Int): Boolean {
        val l = layouts ?: return false
        val top = rowTop(i) - scrollY
        return top < height && top + l.rows[i].height > 0
    }

    private fun eqFading(now: Long): Boolean {
        if (eqDecayFrom.isEmpty()) return false
        val done = eqDecayFrom.keys.filter { now - eqDecayAt[it] >= EQ_DECAY_MS }
        for (i in done) {
            eqDecayAt[i] = -1
            eqDecayFrom.remove(i)
        }
        return eqDecayFrom.isNotEmpty()
    }

    /** What changed about the sung line or the target this frame (the port of the two reactions). */
    private fun follow(idx: Int, target: Float, now: Long) {
        val c = config ?: return
        val l = layouts ?: return
        val had = seen
        val prevIdx = seenIdx
        val prevTarget = seenTarget
        val prevUser = seenUser
        if (had && idx == prevIdx && target == prevTarget && userScrolling == prevUser) return
        seen = true
        seenIdx = idx
        seenTarget = target
        seenUser = userScrolling

        if (!had || idx != prevIdx || userScrolling != prevUser) retargetLines(if (had) prevIdx else -1, idx, now, animate = had)
        if (target < 0f) return
        if (userScrolling) {
            // Apple's rule: the next line re-attaches the list once it has been still for a moment and the sung line is on screen.
            if (had && idx != prevIdx && !dragging && !flinging && now - scrollEndAt >= LyricsMath.EARLY_RESUME_MS && idx >= 0 &&
                LyricsMath.lineFullyVisible(rowTop(idx), l.rows[idx].height, scrollY, height.toFloat())
            ) {
                main.post { resumeFollowing() }
            }
            return
        }
        if (had && prevTarget == target && prevUser == userScrolling) return
        val toY = target
        val fromY = scrollY
        val first = !had || lastIndex < 0
        lastIndex = idx
        if (first || abs(toY - fromY) < 0.5f || c.reduceMotion) {
            scrollY = toY
            stopGlide()
            dirty = true
            return
        }
        // The list eases from where it is to the new place, at the speed it already had.
        val startY = LyricsMath.glideStart(toY, fromY, height.toFloat())
        if (startY != fromY) scrollY = startY
        glide = startY - toY
        glideRunning = true
        dirty = true
    }

    private fun retargetLines(prevIdx: Int, idx: Int, now: Long, animate: Boolean) {
        val s = sheet ?: return
        for (i in s.rows.indices) {
            val target = restTarget(i, idx)
            val far = idx >= 0 && abs(i - idx) > LyricsMath.TWEEN_REACH
            if (!animate || far) alphas.snap(i, target) else alphas.go(i, target, now, DIM_MS)
        }
        if (prevIdx >= 0 && prevIdx < s.rows.size && prevIdx != idx) {
            if (sweeping(prevIdx)) sweeps.go(prevIdx, 0f, now, DIM_MS)
            if (s.rows[prevIdx].instrumental && eqSince[prevIdx] >= 0) {
                eqDecayFrom[prevIdx] = eqHeightsNow(prevIdx, now)
                eqDecayAt[prevIdx] = now
                eqSince[prevIdx] = -1
            }
        }
        if (idx >= 0 && idx < s.rows.size && idx != prevIdx) {
            if (sweeping(idx)) {
                if (animate) sweeps.go(idx, 1f, now, DIM_MS) else sweeps.snap(idx, 1f)
            }
            if (s.rows[idx].instrumental) {
                eqSince[idx] = now
                eqDecayAt[idx] = -1
                eqDecayFrom.remove(idx)
            }
        }
        dirty = true
    }

    private fun stopGlide() {
        glide = 0f
        glideVelocity = 0f
        glideRunning = false
    }

    // ── Reading on your own ─────────────────────────────────────────────────

    private fun beginUserScroll() {
        stopGlide()
        main.removeCallbacks(resumeRunnable)
        if (userScrolling) return
        userScrolling = true
        onScrollState(mapOf("scrolling" to true))
        dirty = true
        wake()
    }

    fun resumeFollowing() {
        main.removeCallbacks(resumeRunnable)
        if (!userScrolling) return
        userScrolling = false
        onScrollState(mapOf("scrolling" to false))
        dirty = true
        wake()
    }

    private fun scheduleResume() {
        main.removeCallbacks(resumeRunnable)
        main.postDelayed(resumeRunnable, LyricsMath.AUTO_RESUME_MS)
    }

    private fun scrollTo(y: Float) {
        val clamped = y.coerceIn(0f, max(0f, contentH - height))
        if (clamped == scrollY) return
        scrollY = clamped
        dirty = true
        updateEdges()
        invalidate()
    }

    /** Tells JavaScript when the lines leave or return to the top (the dismiss drag must leave them alone), and where the pill points. */
    private fun updateEdges() {
        val top = scrollY <= LyricsMath.TOP_SLACK_DP * density
        if (atTop != top) {
            atTop = top
            onAtTop(mapOf("atTop" to top))
        }
        val dir = if (userScrolling) LyricsMath.pillDirection(targetFor(activeIdx), scrollY, LyricsMath.RESUME_SNAP_DP * density) else 0
        if (dir != pillDir) {
            pillDir = dir
            onPill(mapOf("direction" to dir))
        }
    }

    // ── Touch ───────────────────────────────────────────────────────────────

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!live || layouts == null) return false
        if (velocity == null) velocity = VelocityTracker.obtain()
        velocity?.addMovement(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x
                downY = event.y
                lastY = event.y
                grabbedFling = !scroller.isFinished
                if (grabbedFling) {
                    scroller.abortAnimation()
                    flinging = false
                    scrollEndAt = SystemClock.uptimeMillis()
                    if (userScrolling) scheduleResume()
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (!dragging && abs(event.y - downY) > configuration.scaledTouchSlop) {
                    dragging = true
                    beginUserScroll()
                    parent?.requestDisallowInterceptTouchEvent(true)
                }
                if (dragging) {
                    scrollTo(scrollY + (lastY - event.y))
                    lastY = event.y
                }
            }
            MotionEvent.ACTION_UP -> {
                if (dragging) {
                    endDrag(true)
                } else if (!grabbedFling) {
                    tap(event.x, event.y)
                }
                recycleVelocity()
            }
            MotionEvent.ACTION_CANCEL -> {
                if (dragging) endDrag(false)
                recycleVelocity()
            }
        }
        return true
    }

    private fun endDrag(allowFling: Boolean) {
        dragging = false
        scrollEndAt = SystemClock.uptimeMillis()
        val tracker = velocity
        var flung = false
        if (allowFling && tracker != null) {
            tracker.computeCurrentVelocity(1000, configuration.scaledMaximumFlingVelocity.toFloat())
            val v = tracker.yVelocity
            if (abs(v) > configuration.scaledMinimumFlingVelocity) {
                scroller.fling(0, scrollY.roundToInt(), 0, -v.roundToInt(), 0, 0, 0, max(0, (contentH - height).roundToInt()))
                flinging = true
                flung = true
                main.removeCallbacks(resumeRunnable)
                postInvalidateOnAnimation()
            }
        }
        // A slow release is not a fling and fires no momentum: always arm the resume.
        if (!flung) scheduleResume()
    }

    private fun recycleVelocity() {
        velocity?.recycle()
        velocity = null
    }

    override fun computeScroll() {
        if (scroller.computeScrollOffset()) {
            scrollY = scroller.currY.toFloat().coerceIn(0f, max(0f, contentH - height))
            updateEdges()
            postInvalidateOnAnimation()
        } else if (flinging) {
            flinging = false
            scrollEndAt = SystemClock.uptimeMillis()
            if (userScrolling) scheduleResume()
        }
    }

    private fun tap(x: Float, y: Float) {
        val i = rowAt(y)
        if (i < 0) return
        val s = sheet ?: return
        onLyricPress(mapOf("timestamp" to s.rows[i].timestamp))
    }

    /** The line under a view y, or -1 between the spacer and the footer. */
    private fun rowAt(y: Float): Int {
        val l = layouts ?: return -1
        val doc = y + scrollY - (config?.topSpacer ?: 0f) * density
        if (doc < 0f || doc >= l.total) return -1
        var low = 0
        var high = l.rows.size - 1
        while (low < high) {
            val mid = (low + high + 1) ushr 1
            if (l.offsets[mid] <= doc) low = mid else high = mid - 1
        }
        return low
    }

    // ── Layout ──────────────────────────────────────────────────────────────

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w != oldw) rebuildIfNeeded()
        if (h != oldh && layouts != null) {
            // A new height moves every anchor: put the list right in one step, as on first show.
            measureContent()
            seen = false
            dirty = true
            wake()
        }
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    override fun onDraw(canvas: Canvas) {
        val l = layouts ?: return
        val c = config ?: return
        if (!live) return
        val w = width.toFloat()
        val h = height.toFloat()
        val fade = c.edgeFade * density
        val maxScroll = max(0f, contentH - h)
        val top = if (fade > 0f) min(fade, scrollY).coerceAtLeast(0f) else 0f
        val bottom = if (fade > 0f) min(fade, maxScroll - scrollY).coerceAtLeast(0f) else 0f
        val sy = scrollY.roundToInt()
        canvas.save()
        canvas.clipRect(0f, top, w, h - bottom)
        drawRows(canvas, l, sy)
        canvas.restore()
        if (top > 0.5f) drawFadedBand(canvas, l, sy, 0f, top, w, flip = false)
        if (bottom > 0.5f) drawFadedBand(canvas, l, sy, h - bottom, h, w, flip = true)
    }

    /** One edge band of the lines, dissolving towards the edge like Android's own fading edge. */
    private fun drawFadedBand(canvas: Canvas, l: LyricsLayouts, sy: Int, from: Float, to: Float, w: Float, flip: Boolean) {
        val saved = canvas.saveLayer(0f, from, w, to, null)
        canvas.clipRect(0f, from, w, to)
        drawRows(canvas, l, sy)
        maskMatrix.reset()
        val length = to - from
        if (flip) {
            maskMatrix.setScale(1f, -length)
            maskMatrix.postTranslate(0f, to)
        } else {
            maskMatrix.setScale(1f, length)
        }
        maskShader.setLocalMatrix(maskMatrix)
        maskPaint.shader = maskShader
        canvas.drawRect(0f, from, w, to, maskPaint)
        canvas.restoreToCount(saved)
    }

    private fun drawRows(canvas: Canvas, l: LyricsLayouts, sy: Int) {
        val s = sheet ?: return
        val c = config ?: return
        val pad = c.padH * density
        val gap = c.gap * density
        val now = SystemClock.uptimeMillis()
        val doc = sy - c.topSpacer * density
        // First row that reaches the viewport.
        var low = 0
        var high = l.rows.size - 1
        while (low < high) {
            val mid = (low + high) ushr 1
            if (l.offsets[mid] + l.rows[mid].height > doc) high = mid else low = mid + 1
        }
        var i = low
        while (i < l.rows.size) {
            val top = rowTop(i) - sy
            if (top >= height) break
            val row = s.rows[i]
            val rl = l.rows[i]
            val alpha = alphas.cur[i]
            canvas.save()
            canvas.translate(pad, top + gap)
            val lay = rl.layout
            if (lay != null) {
                lay.paint.color = Color.WHITE
                lay.paint.alpha = (alpha * 255f).roundToInt().coerceIn(0, 255)
                lay.draw(canvas)
                val shown = sweeps.cur[i]
                if (shown > 0.003f && rl.words.isNotEmpty()) drawSweep(canvas, i, shown, sweepPos)
            } else {
                drawEqualizer(canvas, i, alpha, now)
            }
            canvas.restore()
            i++
        }
    }

    /** The sung letters: bright copies of each word, revealed by a sliding clip with a soft edge. */
    private fun drawSweep(canvas: Canvas, i: Int, shown: Float, pos: Long) {
        val s = sheet ?: return
        val c = config ?: return
        val row = s.rows[i]
        val lay = layouts?.rows?.get(i)?.layout ?: return
        val words = layouts?.rows?.get(i)?.words ?: return
        val offset = LyricsMath.highlightOffset(row.from, row.to, row.startMs, row.endMs, pos)
        val count = if (c.reduceMotion) 1 else c.featherCount
        val alphasForCopies = LyricsMath.featherAlphas(count)
        val group = if (shown < 0.999f) canvas.saveLayerAlpha(0f, 0f, lay.width.toFloat(), lay.height.toFloat(), (shown * 255f).roundToInt()) else -1
        // Words already fully sung on a line are lit in one run: one clipped pass instead of a copy per word.
        var runLeft = 0f
        var runRight = 0f
        var runTop = 0f
        var runBottom = 0f
        var inRun = false
        fun flush() {
            if (!inRun) return
            lay.paint.alpha = 255
            canvas.save()
            canvas.clipRect(runLeft, runTop, runRight, runBottom)
            lay.draw(canvas)
            canvas.restore()
            inRun = false
        }
        for (w in words) {
            val p = if (c.reduceMotion) (if (offset > w.start) 1f else 0f) else LyricsMath.wordLit(offset, w.start, w.end)
            if (p <= 0f) {
                flush()
                continue
            }
            val rtl = w.x1 < w.x0
            val left = min(w.x0, w.x1)
            val right = max(w.x0, w.x1)
            if (p >= 1f) {
                if (inRun && (w.top != runTop || w.bottom != runBottom)) flush()
                if (!inRun) {
                    runLeft = left; runRight = right; runTop = w.top; runBottom = w.bottom; inRun = true
                } else {
                    runLeft = min(runLeft, left); runRight = max(runRight, right)
                }
                continue
            }
            flush()
            for (step in 0 until count) {
                val q = LyricsMath.featherAt(p, step, count)
                if (q <= 0f) continue
                val width = (right - left) * q
                canvas.save()
                if (rtl) canvas.clipRect(right - width, w.top, right, w.bottom) else canvas.clipRect(left, w.top, left + width, w.bottom)
                lay.paint.alpha = (alphasForCopies[step] * 255f).roundToInt()
                lay.draw(canvas)
                canvas.restore()
            }
        }
        flush()
        if (group >= 0) canvas.restoreToCount(group)
    }

    private fun eqHeightsNow(i: Int, now: Long): FloatArray {
        val since = eqSince[i]
        return FloatArray(LyricsMath.EQ_SPECS.size) { b ->
            if (since >= 0) LyricsMath.eqActiveHeight(LyricsMath.EQ_SPECS[b], now - since) else LyricsMath.eqRestHeight(LyricsMath.EQ_SPECS[b])
        }
    }

    /** A music break: five bars dancing while the line is sung, resting while it is not. */
    private fun drawEqualizer(canvas: Canvas, i: Int, alpha: Float, now: Long) {
        val specs = LyricsMath.EQ_SPECS
        val active = eqSince[i] >= 0
        val decaying = eqDecayAt[i] >= 0 && now - eqDecayAt[i] < EQ_DECAY_MS
        val from = if (decaying) eqDecayFrom[i] else null
        val t = if (decaying) ((now - eqDecayAt[i]).toFloat() / EQ_DECAY_MS).coerceIn(0f, 1f) else 0f
        val eased = 1f - (1f - t) * (1f - t)
        val barW = LyricsMath.EQ_BAR_DP * density
        val gap = LyricsMath.EQ_GAP_DP * density
        val total = specs.size * barW + (specs.size - 1) * gap
        // A 72dp box at the start of the line, the bars centred in it.
        val startX = (LyricsMath.EQ_MIN_WIDTH_DP * density - total) / 2f
        val cy = LyricsMath.EQ_ROW_DP * density / 2f
        val colorAlpha = if (active) alpha else alpha * 0.28f * 0.35f
        eqPaint.color = Color.WHITE
        eqPaint.alpha = (colorAlpha * 255f).roundToInt().coerceIn(0, 255)
        for (b in specs.indices) {
            val heightDp = when {
                active -> LyricsMath.eqActiveHeight(specs[b], now - eqSince[i])
                from != null -> from[b] + (LyricsMath.eqRestHeight(specs[b]) - from[b]) * eased
                else -> LyricsMath.eqRestHeight(specs[b])
            }
            val h = heightDp * density
            val x = startX + b * (barW + gap)
            eqRect.set(x, cy - h / 2f, x + barW, cy + h / 2f)
            canvas.drawRoundRect(eqRect, min(3f * density, barW / 2f), min(3f * density, barW / 2f), eqPaint)
        }
    }

    // ── Accessibility ───────────────────────────────────────────────────────

    override fun dispatchHoverEvent(event: MotionEvent): Boolean = access.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)

    /** Each visible line is a virtual button, like the pressable text rows of the React Native list. */
    private inner class Access(host: View) : ExploreByTouchHelper(host) {
        override fun getVirtualViewAt(x: Float, y: Float): Int {
            val i = rowAt(y)
            return if (i >= 0) i else INVALID_ID
        }

        override fun getVisibleVirtualViews(ids: MutableList<Int>) {
            val l = layouts ?: return
            for (i in l.rows.indices) {
                val top = rowTop(i) - scrollY
                if (top >= height) break
                if (top + l.rows[i].height > 0) ids += i
            }
        }

        override fun onPopulateNodeForVirtualView(id: Int, node: AccessibilityNodeInfoCompat) {
            val l = layouts
            val s = sheet
            if (l == null || s == null || id !in s.rows.indices) {
                node.contentDescription = ""
                node.setBoundsInParent(Rect(0, 0, 1, 1))
                return
            }
            val row = s.rows[id]
            node.contentDescription = if (row.instrumental) "Instrumental" else row.text
            val top = (rowTop(id) - scrollY).roundToInt()
            node.setBoundsInParent(Rect(0, max(0, top), width, min(height, top + l.rows[id].height.roundToInt()).coerceAtLeast(1)))
            node.addAction(AccessibilityNodeInfoCompat.ACTION_CLICK)
            node.isClickable = true
        }

        override fun onPerformActionForVirtualView(id: Int, action: Int, arguments: Bundle?): Boolean {
            val s = sheet ?: return false
            if (action != AccessibilityNodeInfo.ACTION_CLICK || id !in s.rows.indices) return false
            onLyricPress(mapOf("timestamp" to s.rows[id].timestamp))
            return true
        }
    }

    // ── Animation helper ────────────────────────────────────────────────────

    /** Per-line value that eases to a target; far lines are set without a tween. */
    private class Tween(n: Int) {
        val cur = FloatArray(n)
        private val from = FloatArray(n)
        private val to = FloatArray(n)
        private val start = LongArray(n) { -1 }
        private val ms = LongArray(n)
        private val queued = BooleanArray(n)
        private val running = IntArray(n)
        private var count = 0

        fun snap(i: Int, v: Float) {
            cur[i] = v
            to[i] = v
            start[i] = -1
        }

        fun go(i: Int, v: Float, now: Long, duration: Long) {
            if (to[i] == v) return
            from[i] = cur[i]
            to[i] = v
            start[i] = now
            ms[i] = duration
            if (!queued[i]) {
                queued[i] = true
                running[count++] = i
            }
        }

        fun busy(): Boolean = count > 0

        /** Whether any line is partly or fully shown. */
        fun anyShown(): Boolean {
            for (v in cur) if (v > 0.003f) return true
            return false
        }

        /** Advances every running tween; returns whether any value moved. */
        fun step(now: Long, ease: PathInterpolator): Boolean {
            var moved = false
            var w = 0
            for (r in 0 until count) {
                val i = running[r]
                if (start[i] < 0) {
                    queued[i] = false
                    continue
                }
                val t = ((now - start[i]).toFloat() / ms[i]).coerceIn(0f, 1f)
                cur[i] = from[i] + (to[i] - from[i]) * ease.getInterpolation(t)
                moved = true
                if (t >= 1f) {
                    cur[i] = to[i]
                    start[i] = -1
                    queued[i] = false
                } else {
                    running[w++] = i
                }
            }
            count = w
            return moved
        }
    }

    private companion object {
        const val DIM_MS = LyricsMath.DIM_MS
        const val EQ_DECAY_MS = 280L
        val BUILDER = Executors.newSingleThreadExecutor { r -> Thread(r, "lyrics-layout").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 } }
    }
}
