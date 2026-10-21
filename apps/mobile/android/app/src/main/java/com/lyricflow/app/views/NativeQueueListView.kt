package com.lyricflow.app.views

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextPaint
import android.text.TextUtils
import android.util.LruCache
import android.view.Choreographer
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.widget.OverScroller
import androidx.annotation.OptIn
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.customview.widget.ExploreByTouchHelper
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import com.google.common.util.concurrent.MoreExecutors
import com.lyricflow.app.island.IslandFonts
import com.lyricflow.app.island.Spring
import com.lyricflow.app.queue.QueueMath
import com.lyricflow.app.queue.QueueParser
import com.lyricflow.app.queue.QueueRow
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The rows of Now Playing's Up next panel, drawn, scrolled and re-ordered in Kotlin: the same rows, look and
 * gestures as the React Native list in `UpNextPanel.tsx`, which stays as the fallback for iOS and builds without this
 * view. The panel's own chrome (the glass, the header, the chips, the swipe down to close) stays React Native.
 *
 * A tap plays the row (`onPick`, through the existing playback flow). A touch on a row's handle lifts it: the others
 * step aside on springs, and on release it settles into its slot and `onMove` hands the new order to JavaScript,
 * which owns the queue. The list tells JavaScript when it is scrolled away from the top (`onAtTop`) so the panel's
 * swipe down leaves it alone.
 */
@OptIn(UnstableApi::class)
class NativeQueueListView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onPick by EventDispatcher<Map<String, Any>>()
    private val onMove by EventDispatcher<Map<String, Any>>()
    private val onAtTop by EventDispatcher<Map<String, Any>>()
    private val onLift by EventDispatcher<Map<String, Any>>()

    private val density = resources.displayMetrics.density
    private val main = Handler(Looper.getMainLooper())

    // ── Props, applied in one batch (commit) ────────────────────────────────
    private var rowsJson = ""
    private var appliedRowsJson = ""
    private var currentIndex = -1
    private var movable = false
    private var bottomPad = 0f
    private var startRow = 0
    private var scrollToken = 0
    private var appliedToken = Int.MIN_VALUE
    private var propsDirty = false

    private var rows: List<QueueRow> = emptyList()
    private var titleText: Array<CharSequence> = emptyArray()
    private var subText: Array<CharSequence> = emptyArray()

    // ── Geometry (px) ───────────────────────────────────────────────────────
    private val rowH = ROW_DP * density
    private val sideM = SIDE_DP * density
    private val handleW = HANDLE_DP * density
    private val art = ART_DP * density
    private val radius = ROW_RADIUS_DP * density
    private val artRadius = ART_RADIUS_DP * density

    // ── Scroll state ────────────────────────────────────────────────────────
    private var scrollY = 0f
    private val scroller = OverScroller(context)
    private val configuration = ViewConfiguration.get(context)
    private var velocity: VelocityTracker? = null
    private var downX = 0f
    private var downY = 0f
    private var lastY = 0f
    private var scrolling = false
    private var yielded = false
    private var grabbedFling = false
    private var flinging = false
    private var pressedPos = -1
    private var atTop: Boolean? = null

    // ── Re-order state ──────────────────────────────────────────────────────
    private var handleDownPos = -1
    private var dragPos = -1
    private var dragTo = -1
    private val dragDy = Spring(0f, SPRING_K, SPRING_ZETA)
    private val lifted = Spring(0f, SPRING_K, SPRING_ZETA)
    private val shifts = HashMap<Int, Spring>()
    private var settling = false
    private var awaitingRows = false
    private val giveUp = Runnable { clearDrag() }

    // ── Frame loop ──────────────────────────────────────────────────────────
    private var framePosted = false
    private var lastFrameNanos = 0L
    private val frame = Choreographer.FrameCallback { nanos ->
        framePosted = false
        val dt = if (lastFrameNanos == 0L) 0f else min(0.05f, (nanos - lastFrameNanos) / 1e9f)
        lastFrameNanos = nanos
        val busy = step(dt)
        invalidate()
        if (busy) wake() else lastFrameNanos = 0L
    }

    // ── Drawing ─────────────────────────────────────────────────────────────
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val subPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(153, 255, 255, 255) }
    private val glyphPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val rect = RectF()
    private val clip = Path()
    private val matrix = Matrix()
    private val tiles = HashMap<String, Tile>()
    private val shownAt = HashMap<String, Long>()
    private var fontRemover: (() -> Unit)? = null
    private val access = Access(this)

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setWillNotDraw(false)
        ViewCompat.setAccessibilityDelegate(this, access)
        applyFonts()
    }

    // ── Props ───────────────────────────────────────────────────────────────

    fun setRows(json: String?) { rowsJson = json.orEmpty(); propsDirty = true }
    fun setCurrentIndex(i: Int?) { currentIndex = i ?: -1; propsDirty = true }
    fun setMovable(on: Boolean?) { movable = on ?: false; propsDirty = true }
    fun setBottomPad(dp: Double?) { bottomPad = (dp ?: 0.0).toFloat(); propsDirty = true }
    fun setStartRow(i: Int?) { startRow = i ?: 0; propsDirty = true }
    fun setScrollToken(t: Int?) { scrollToken = t ?: 0; propsDirty = true }

    fun commit() {
        if (!propsDirty) return
        propsDirty = false
        if (rowsJson != appliedRowsJson) {
            appliedRowsJson = rowsJson
            rows = QueueParser.rows(rowsJson)
            // The queue changed under a lift or a settle (the new order arrived, or something else moved it): the
            // rows draw their own places again, with no offsets left over.
            if (dragPos >= 0 || awaitingRows) clearDrag()
            shifts.clear()
            val live = rows.mapTo(HashSet()) { it.id }
            tiles.keys.retainAll(live)
            buildText()
            clampScroll()
            access.invalidateRoot()
        }
        if (scrollToken != appliedToken) {
            appliedToken = scrollToken
            scroller.abortAnimation()
            flinging = false
            scrollY = (startRow * rowH).coerceIn(0f, maxScroll())
            updateEdges()
        }
        invalidate()
        wake()
    }

    private fun contentH() = rows.size * rowH + bottomPad * density

    private fun maxScroll() = QueueMath.maxScroll(contentH(), height.toFloat())

    private fun clampScroll() {
        scrollY = scrollY.coerceIn(0f, maxScroll())
    }

    // ── Text ────────────────────────────────────────────────────────────────

    private fun applyFonts() {
        titlePaint.typeface = IslandFonts.semibold
        subPaint.typeface = IslandFonts.regular
        val scale = resources.configuration.fontScale
        titlePaint.textSize = TITLE_SP * density * scale
        subPaint.textSize = SUB_SP * density * scale
    }

    private fun textRight() = width - sideM - (if (movable) handleW else 0f)

    private fun textLeft() = sideM + 12 * density + art + 14 * density

    private fun buildText() {
        val avail = max(0f, textRight() - textLeft())
        titleText = Array(rows.size) { TextUtils.ellipsize(rows[it].title, titlePaint, avail, TextUtils.TruncateAt.END) }
        subText = Array(rows.size) { TextUtils.ellipsize(rows[it].subtitle, subPaint, avail, TextUtils.TruncateAt.END) }
    }

    // ── Frame loop ──────────────────────────────────────────────────────────

    fun wake() {
        if (framePosted || !isAttachedToWindow) return
        framePosted = true
        Choreographer.getInstance().postFrameCallback(frame)
    }

    /** Advances springs and fades; true while anything is still moving. */
    private fun step(dt: Float): Boolean {
        var busy = false
        if (dragPos >= 0) {
            if (lifted.step(dt)) busy = true
            if (dragDy.step(dt)) busy = true
            val it = shifts.entries.iterator()
            while (it.hasNext()) {
                val spring = it.next().value
                if (spring.step(dt)) busy = true else if (spring.target == 0f) it.remove()
            }
            if (settling) {
                val goal = dragDy.target
                if (abs(dragDy.value - goal) < 0.5f && abs(dragDy.velocity) < 20f) finishSettle() else busy = true
            }
            busy = true
        }
        if (!scroller.isFinished) busy = true
        if (fading()) busy = true
        return busy
    }

    private fun fading(): Boolean {
        val now = SystemClock.uptimeMillis()
        for (t in shownAt.values) if (now - t < FADE_MS) return true
        return false
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (fontRemover == null) {
            fontRemover = IslandFonts.load(context) { main.post { applyFonts(); buildText(); invalidate() } }
        }
        wake()
    }

    override fun onDetachedFromWindow() {
        Choreographer.getInstance().removeFrameCallback(frame)
        framePosted = false
        lastFrameNanos = 0L
        main.removeCallbacks(giveUp)
        scroller.abortAnimation()
        fontRemover?.invoke()
        fontRemover = null
        super.onDetachedFromWindow()
    }

    override fun onConfigurationChanged(newConfig: Configuration?) {
        super.onConfigurationChanged(newConfig)
        applyFonts()
        buildText()
        invalidate()
    }

    // ── Touch ───────────────────────────────────────────────────────────────

    private fun posAt(y: Float): Int {
        val p = ((y + scrollY) / rowH).toInt()
        return if (y + scrollY < 0f || p < 0 || p >= rows.size) -1 else p
    }

    private fun inHandle(x: Float) = movable && rows.size > 1 && x >= width - sideM - handleW

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (rows.isEmpty()) return false
        if (velocity == null) velocity = VelocityTracker.obtain()
        velocity?.addMovement(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x
                downY = event.y
                lastY = event.y
                yielded = false
                grabbedFling = !scroller.isFinished
                if (grabbedFling) {
                    scroller.abortAnimation()
                    flinging = false
                }
                val p = posAt(event.y)
                if (!settling && !awaitingRows && p >= 0 && inHandle(event.x)) {
                    // A touch on a handle moves the row, never the panel or the list.
                    handleDownPos = p
                    parent?.requestDisallowInterceptTouchEvent(true)
                } else if (p >= 0 && !grabbedFling && !inHandle(event.x)) {
                    // The handle column only moves a row: a tap there plays nothing, as in the React Native row.
                    pressedPos = p
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (handleDownPos >= 0) {
                    if (dragPos < 0 && abs(event.y - downY) >= 1f) beginDrag(handleDownPos)
                    if (dragPos >= 0 && !settling) {
                        val dy = event.y - downY
                        dragDy.snap(dy)
                        retarget(QueueMath.dropIndex(dragPos, dy, rowH, rows.size))
                        wake()
                        invalidate()
                    }
                    return true
                }
                if (!scrolling && !yielded && abs(event.y - downY) > configuration.scaledTouchSlop) {
                    pressedPos = -1
                    if (QueueMath.yieldsToPanel(scrollY, event.y - downY, TOP_SLACK_DP * density)) {
                        // The panel's swipe down to close: claiming this touch would cancel the panel's gesture.
                        yielded = true
                        invalidate()
                    } else {
                        scrolling = true
                        lastY = QueueMath.scrollOrigin(downY, event.y, configuration.scaledTouchSlop.toFloat())
                        parent?.requestDisallowInterceptTouchEvent(true)
                    }
                }
                if (scrolling) {
                    scrollY = (scrollY + (lastY - event.y)).coerceIn(0f, maxScroll())
                    lastY = event.y
                    updateEdges()
                    invalidate()
                }
            }
            MotionEvent.ACTION_UP -> {
                if (handleDownPos >= 0) {
                    if (dragPos >= 0) endDrag()
                    handleDownPos = -1
                } else if (scrolling) {
                    fling()
                } else if (!grabbedFling && pressedPos >= 0 && posAt(event.y) == pressedPos) {
                    onPick(mapOf("index" to rows[pressedPos].index))
                }
                pressedPos = -1
                scrolling = false
                yielded = false
                recycleVelocity()
                invalidate()
            }
            MotionEvent.ACTION_CANCEL -> {
                if (handleDownPos >= 0 && dragPos >= 0) endDrag()
                handleDownPos = -1
                pressedPos = -1
                scrolling = false
                yielded = false
                recycleVelocity()
                invalidate()
            }
        }
        return true
    }

    private fun fling() {
        val tracker = velocity ?: return
        tracker.computeCurrentVelocity(1000, configuration.scaledMaximumFlingVelocity.toFloat())
        val v = tracker.yVelocity
        if (abs(v) > configuration.scaledMinimumFlingVelocity) {
            scroller.fling(0, scrollY.roundToInt(), 0, -v.roundToInt(), 0, 0, 0, maxScroll().roundToInt())
            flinging = true
            wake()
            postInvalidateOnAnimation()
        }
    }

    private fun recycleVelocity() {
        velocity?.recycle()
        velocity = null
    }

    override fun computeScroll() {
        if (scroller.computeScrollOffset()) {
            scrollY = scroller.currY.toFloat().coerceIn(0f, maxScroll())
            updateEdges()
            postInvalidateOnAnimation()
        } else if (flinging) {
            flinging = false
        }
    }

    /** Tells JavaScript when the list leaves or returns to the top: the panel's swipe down must leave a scrolled list alone. */
    private fun updateEdges() {
        val top = scrollY <= TOP_SLACK_DP * density
        if (atTop != top) {
            atTop = top
            onAtTop(mapOf("atTop" to top))
        }
        access.invalidateRoot()
    }

    // ── Re-ordering ─────────────────────────────────────────────────────────

    private fun beginDrag(pos: Int) {
        dragPos = pos
        dragTo = pos
        dragDy.snap(0f)
        lifted.snap(0f)
        lifted.target = 1f
        shifts.clear()
        settling = false
        awaitingRows = false
        // JavaScript ticks (utils/haptics honours the Haptics switch in Settings; the system call here would not).
        onLift(mapOf("index" to rows[pos].index))
        wake()
    }

    /** The slot the lifted row now points at: the rows between it and its place step aside. */
    private fun retarget(to: Int) {
        if (to == dragTo && shifts.isNotEmpty()) return
        dragTo = to
        val range = min(dragPos, to) - 1..max(dragPos, to) + 1
        for (i in range) {
            if (i < 0 || i >= rows.size || i == dragPos) continue
            val goal = QueueMath.shiftRows(i, dragPos, to) * rowH
            val spring = shifts.getOrPut(i) { Spring(0f, SPRING_K, SPRING_ZETA) }
            spring.target = goal
        }
        // Rows that were stepped aside for an earlier slot and are not in the range any more return home.
        for ((i, spring) in shifts) if (i !in range) spring.target = 0f
    }

    private fun endDrag() {
        // Land exactly in the gap before the list re-orders under it.
        dragDy.target = (dragTo - dragPos) * rowH
        lifted.target = 0f
        settling = true
        wake()
    }

    private fun finishSettle() {
        settling = false
        val from = dragPos
        val to = dragTo
        if (from == to) {
            clearDrag()
            return
        }
        // JavaScript owns the queue: it re-orders and sends the rows again, which clears the offsets in one frame.
        awaitingRows = true
        main.postDelayed(giveUp, AWAIT_MS)
        onMove(mapOf("from" to rows[from].index, "to" to rows[to].index))
    }

    private fun clearDrag() {
        main.removeCallbacks(giveUp)
        dragPos = -1
        dragTo = -1
        settling = false
        awaitingRows = false
        shifts.clear()
        dragDy.snap(0f)
        lifted.snap(0f)
        invalidate()
    }

    // ── Layout ──────────────────────────────────────────────────────────────

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun dispatchHoverEvent(event: MotionEvent): Boolean = access.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        buildText()
        clampScroll()
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    override fun onDraw(canvas: Canvas) {
        if (rows.isEmpty()) return
        val first = max(0, (scrollY / rowH).toInt())
        val last = min(rows.size - 1, ((scrollY + height) / rowH).toInt())
        for (p in first..last) {
            if (p == dragPos) continue
            drawRow(canvas, p, shifts[p]?.value ?: 0f, 0f, p == pressedPos && dragPos < 0)
        }
        if (dragPos in 0 until rows.size) drawRow(canvas, dragPos, dragDy.value, lifted.value, false)
    }

    private fun drawRow(canvas: Canvas, p: Int, dy: Float, lift: Float, pressed: Boolean) {
        val row = rows[p]
        val top = p * rowH - scrollY + dy
        if (top > height || top + rowH < 0f) return
        val w = width.toFloat()
        val left = sideM
        val right = w - sideM
        val current = row.index == currentIndex
        canvas.save()
        if (lift > 0.001f) {
            val s = 1f + 0.03f * lift
            canvas.scale(s, s, w / 2f, top + rowH / 2f)
            // The lifted row sits on a lit pane.
            fill.color = Color.argb((255 * 0.12f * lift).roundToInt(), 255, 255, 255)
            rect.set(left, top, right, top + rowH)
            canvas.drawRoundRect(rect, radius, radius, fill)
        }
        rect.set(left, top, right, top + rowH)
        if (current) {
            fill.color = Color.argb(20, 255, 255, 255)
            canvas.drawRoundRect(rect, radius, radius, fill)
        }
        if (pressed) {
            canvas.save()
            clip.reset()
            clip.addRoundRect(rect, radius, radius, Path.Direction.CW)
            canvas.clipPath(clip)
            fill.color = Color.argb(26, 255, 255, 255)
            canvas.drawRect(left, top, if (movable && rows.size > 1) right - handleW else right, top + rowH, fill)
            canvas.restore()
        }
        // The cover.
        val artLeft = left + 12 * density
        val artTop = top + (rowH - art) / 2f
        drawCover(canvas, row, artLeft, artTop)
        if (current) drawNowMark(canvas, artLeft, artTop)
        // The text, centred as a block.
        val titleM = titlePaint.fontMetrics
        val subM = subPaint.fontMetrics
        // React Native's Text keeps the font padding (includeFontPadding is on), so a line is top..bottom, not ascent..descent.
        val titleH = titleM.bottom - titleM.top
        val subH = subM.bottom - subM.top
        val gap = 3 * density
        val block = titleH + gap + subH
        val blockTop = top + (rowH - block) / 2f
        val textX = textLeft()
        canvas.drawText(titleText[p], 0, titleText[p].length, textX, blockTop - titleM.top, titlePaint)
        canvas.drawText(subText[p], 0, subText[p].length, textX, blockTop + titleH + gap - subM.top, subPaint)
        if (movable && rows.size > 1) drawHandle(canvas, right - handleW / 2f, top + rowH / 2f)
        canvas.restore()
    }

    /** Ionicons' reorder-two at 24 dp: two round-capped bars (x 118..394, y 208 and 304, stroke 44 on a 512 grid). */
    private fun drawHandle(canvas: Canvas, cx: Float, cy: Float) {
        stroke.color = Color.argb(158, 255, 255, 255)
        stroke.strokeWidth = 44f / 512f * 24f * density
        val half = 138f / 512f * 24f * density
        val gap = 48f / 512f * 24f * density
        canvas.drawLine(cx - half, cy - gap, cx + half, cy - gap, stroke)
        canvas.drawLine(cx - half, cy + gap, cx + half, cy + gap, stroke)
    }

    /** The playing row's mark: three still bars over its cover. */
    private fun drawNowMark(canvas: Canvas, left: Float, top: Float) {
        fill.color = Color.argb(115, 0, 0, 0)
        rect.set(left, top, left + art, top + art)
        canvas.drawRoundRect(rect, artRadius, artRadius, fill)
        fill.color = Color.WHITE
        val barW = 3 * density
        val gap = 3 * density
        val heights = floatArrayOf(10f, 16f, 8f)
        val total = barW * 3 + gap * 2
        val x0 = left + (art - total) / 2f
        val bottom = top + art - 15 * density
        for (k in 0 until 3) {
            val x = x0 + k * (barW + gap)
            rect.set(x, bottom - heights[k] * density, x + barW, bottom)
            canvas.drawRoundRect(rect, barW / 2f, barW / 2f, fill)
        }
    }

    // ── Covers ──────────────────────────────────────────────────────────────

    private fun drawCover(canvas: Canvas, row: QueueRow, left: Float, top: Float) {
        rect.set(left, top, left + art, top + art)
        val uri = row.cover
        val entry = if (uri != null) covers.get(uri) else null
        if (entry == null) {
            if (uri != null && uri !in failed) request(uri)
            if (uri != null && uri !in failed) {
                // The base colour while the picture loads, as the React Native cover does.
                fill.color = row.tile.base
                canvas.drawRoundRect(rect, artRadius, artRadius, fill)
            } else {
                drawGenerated(canvas, row, left, top)
            }
            return
        }
        // The picture fades in over the base colour.
        val now = SystemClock.uptimeMillis()
        val since = shownAt.getOrPut(uri!!) { now }
        val a = ((now - since) / FADE_MS.toFloat()).coerceIn(0f, 1f)
        if (a < 1f) {
            fill.color = row.tile.base
            canvas.drawRoundRect(rect, artRadius, artRadius, fill)
        }
        // contentFit "cover": fill the square, crop the longer side evenly.
        val scale = max(art / entry.bitmap.width, art / entry.bitmap.height)
        matrix.setScale(scale, scale)
        matrix.postTranslate(left + (art - entry.bitmap.width * scale) / 2f, top + (art - entry.bitmap.height * scale) / 2f)
        entry.shader.setLocalMatrix(matrix)
        imagePaint.shader = entry.shader
        imagePaint.alpha = (255 * a).roundToInt()
        canvas.drawRoundRect(rect, artRadius, artRadius, imagePaint)
        imagePaint.shader = null
    }

    private fun request(uri: String) {
        if (!pending.add(uri)) return
        val future = try {
            loader.loadBitmap(Uri.parse(uri))
        } catch (_: Throwable) {
            pending.remove(uri)
            failed.add(uri)
            return
        }
        future.addListener({
            val bitmap = try {
                future.get()
            } catch (_: Throwable) {
                null
            }
            main.post {
                pending.remove(uri)
                if (bitmap != null) {
                    covers.put(uri, Cover(bitmap, BitmapShader(bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)))
                } else {
                    failed.add(uri)
                }
                // Every list showing this cover redraws.
                invalidate()
                wake()
            }
        }, executor)
    }

    /** What GeneratedArtwork draws: a duotone from the song's own title, a spark, grooves and a monogram. */
    private fun drawGenerated(canvas: Canvas, row: QueueRow, left: Float, top: Float) {
        val key = row.id + "|" + row.title
        val tile = tiles.getOrPut(key) { Tile(row.tile, art) }
        canvas.save()
        clip.reset()
        clip.addRoundRect(rect, artRadius, artRadius, Path.Direction.CW)
        canvas.clipPath(clip)
        canvas.translate(left, top)
        tile.draw(canvas, art, glyphPaint, stroke, fill, rect)
        canvas.restore()
    }

    private class Tile(private val t: com.lyricflow.app.queue.QueueTile, size: Float) {
        private val base = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = if (t.variant == 1) {
                LinearGradient(size, 0f, 0f, size, t.base, t.mid, Shader.TileMode.CLAMP)
            } else {
                LinearGradient(0f, 0f, size, size, t.base, t.mid, Shader.TileMode.CLAMP)
            }
        }
        private val spark = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            val cx = if (t.variant == 2) 0.22f else 0.78f
            shader = RadialGradient(cx * size, 0.22f * size, 0.62f * size, withAlpha(t.spark, 0.55f), withAlpha(t.spark, 0f), Shader.TileMode.CLAMP)
        }
        private val dark = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(0.3f * size, size, 0.7f * size, withAlpha(t.base, 0.7f), withAlpha(t.base, 0f), Shader.TileMode.CLAMP)
        }

        fun draw(canvas: Canvas, size: Float, glyph: TextPaint, stroke: Paint, fill: Paint, scratch: RectF) {
            canvas.drawRect(0f, 0f, size, size, base)
            canvas.drawRect(0f, 0f, size, size, spark)
            canvas.drawRect(0f, 0f, size, size, dark)
            stroke.shader = null
            stroke.strokeWidth = 0.008f * size
            val cx = if (t.variant == 2) 0.86f * size else 0.14f * size
            for ((n, r) in floatArrayOf(34f, 46f, 58f).withIndex()) {
                stroke.color = withAlpha(t.spark, 0.14f - n * 0.03f)
                canvas.drawCircle(cx, 0.86f * size, r / 100f * size, stroke)
            }
            glyph.typeface = IslandFonts.bold
            glyph.textSize = size * 0.9f
            glyph.color = withAlpha(t.spark, 0.28f)
            // GeneratedArtwork: letterSpacing -4 on a 48 dp cover with a 0.9 x size glyph, in em.
            glyph.letterSpacing = -4f / (48f * 0.9f)
            val w = glyph.measureText(t.glyph)
            canvas.drawText(t.glyph, size - w + size * 0.08f, size + size * 0.2f - glyph.descent(), glyph)
        }

        private fun withAlpha(color: Int, a: Float) = Color.argb((255 * a).roundToInt().coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))
    }

    private class Cover(val bitmap: Bitmap, val shader: BitmapShader)

    // ── Accessibility ───────────────────────────────────────────────────────

    private inner class Access(host: View) : ExploreByTouchHelper(host) {
        override fun getVirtualViewAt(x: Float, y: Float): Int {
            val p = posAt(y)
            if (p < 0) return INVALID_ID
            return if (inHandle(x)) p * 2 + 1 else p * 2
        }

        override fun getVisibleVirtualViews(ids: MutableList<Int>) {
            if (rows.isEmpty()) return
            val first = max(0, (scrollY / rowH).toInt())
            val last = min(rows.size - 1, ((scrollY + height) / rowH).toInt())
            for (p in first..last) {
                ids += p * 2
                if (movable && rows.size > 1) ids += p * 2 + 1
            }
        }

        override fun onPopulateNodeForVirtualView(id: Int, node: AccessibilityNodeInfoCompat) {
            val p = id / 2
            if (p !in rows.indices) {
                node.contentDescription = ""
                node.setBoundsInParent(Rect(0, 0, 1, 1))
                return
            }
            val row = rows[p]
            val top = (p * rowH - scrollY).roundToInt()
            val handle = id % 2 == 1
            val left = if (handle) (width - sideM - handleW).roundToInt() else sideM.roundToInt()
            val right = if (handle) (width - sideM).roundToInt() else (width - sideM - (if (movable && rows.size > 1) handleW else 0f)).roundToInt()
            node.setBoundsInParent(Rect(left, top, max(left + 1, right), top + rowH.roundToInt()))
            node.className = "android.widget.Button"
            if (handle) {
                node.contentDescription = "Move ${row.title}"
                if (p > 0) node.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat(ACTION_MOVE_UP, "Move up"))
                if (p < rows.size - 1) node.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat(ACTION_MOVE_DOWN, "Move down"))
            } else {
                node.contentDescription = if (row.index == currentIndex) "Now playing: ${row.title}" else "Play ${row.title}"
                node.addAction(AccessibilityNodeInfoCompat.ACTION_CLICK)
                node.isClickable = true
            }
        }

        override fun onPerformActionForVirtualView(id: Int, action: Int, arguments: Bundle?): Boolean {
            val p = id / 2
            if (p !in rows.indices) return false
            return when (action) {
                AccessibilityNodeInfoCompat.ACTION_CLICK -> {
                    onPick(mapOf("index" to rows[p].index))
                    true
                }
                ACTION_MOVE_UP -> if (p > 0) { moveBy(p, p - 1); true } else false
                ACTION_MOVE_DOWN -> if (p < rows.size - 1) { moveBy(p, p + 1); true } else false
                else -> false
            }
        }
    }

    /** A move asked for without a finger (TalkBack): JavaScript re-orders and sends the rows again. */
    private fun moveBy(from: Int, to: Int) {
        if (awaitingRows || dragPos >= 0) return
        onMove(mapOf("from" to rows[from].index, "to" to rows[to].index))
    }

    private companion object {
        const val ROW_DP = 64f
        const val SIDE_DP = 8f
        const val HANDLE_DP = 52f
        const val ART_DP = 48f
        const val ROW_RADIUS_DP = 14f
        const val ART_RADIUS_DP = 8f
        const val TITLE_SP = 15f
        const val SUB_SP = 13f
        const val TOP_SLACK_DP = 2f
        const val FADE_MS = 150L
        const val AWAIT_MS = 900L
        const val COVER_CACHE_BYTES = 10 * 1024 * 1024
        const val MIN_COVER_PX = 96
        // Motion.spring.tactile: stiffness 700, damping 40, mass 0.8.
        const val SPRING_K = 875f
        const val SPRING_ZETA = 0.845f
        const val ACTION_MOVE_UP = 0x7101
        const val ACTION_MOVE_DOWN = 0x7102

        val executor = Executors.newFixedThreadPool(2) { r ->
            Thread(r, "queue-art").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }
        }
        val covers = object : LruCache<String, Cover>(COVER_CACHE_BYTES) {
            override fun sizeOf(key: String, value: Cover) = value.bitmap.byteCount
        }
        val failed = HashSet<String>()
        val pending = HashSet<String>()
    }

    private val loader by lazy {
        DataSourceBitmapLoader(
            MoreExecutors.listeningDecorator(executor),
            DefaultDataSource.Factory(context.applicationContext), null,
            // The slot's own pixels (the React Native cover decodes at view size) with some room for a non-square picture to be cropped.
            max(MIN_COVER_PX, (art * 1.5f).roundToInt()),
        )
    }
}
