package com.lyricflow.app.island

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.RadialGradient
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextPaint
import android.text.TextUtils
import android.util.TypedValue
import android.view.Choreographer
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import androidx.core.graphics.ColorUtils
import androidx.media3.common.C
import androidx.media3.common.Player
import com.lyricflow.app.playback.resumePlayback
import com.lyricflow.app.playback.showsPlaying
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The island: a black pill round the camera that springs open into a now-playing card, drawn by hand on one
 * canvas so the morph never runs a layout pass.
 *
 * Shapes are centred on the view's middle and hang from the top of the screen; IslandWindow keeps the window
 * centred on the camera with a stable horizontal surface. Its height grows ahead of the morph and shrinks
 * at rest; a separate compact input window leaves the surrounding status bar touchable while closed.
 *
 * Three looks, one shape:
 * - idle: the camera and a little black either side (nothing loaded),
 * - compact: the cover on the left, level bars on the right (a song is loaded),
 * - open: the card — cover, title, artist, a scrubber and previous / play-pause / next.
 *
 * Nothing ticks when nothing moves: the springs run on Choreographer only while moving, the level bars draw at
 * 30 fps only while music plays and the pill shows them, and the open card's clock redraws twice a second.
 */
@SuppressLint("ViewConstructor")
class IslandView(context: Context, private val host: Host) : View(context) {

    interface Host {
        /** Fit the shape's input bounds; keep the drawing surface's horizontal frame stable. */
        fun fitWindow(halfWidth: Float, bottom: Float)
        /** Off while there is nothing to show, so the empty window never takes a touch. */
        fun setTouchable(touchable: Boolean)
        /** The drawing window takes touches only while the card opens or closes. */
        fun setExpandedTouch(expanded: Boolean)
        fun openApp()
    }

    var geometry: IslandGeometry? = null
        set(value) {
            field = value
            fitHalf = 0f
            fitBottom = 0f
            gradientFor = null
            layoutContent()
            refit(force = true)
            invalidate()
        }

    /** The listener's choice: the idle pill stays round the camera with nothing loaded. */
    var showWhenIdle = true
        set(value) {
            if (field == value) return
            field = value
            retarget()
        }

    var screenOn = true
        set(value) {
            if (field == value) return
            field = value
            if (!value) collapse() else invalidate()
        }

    // ── What is playing ─────────────────────────────────────────────────────────────────────────────────────

    private var player: Player? = null
    private var stopWatching: (() -> Unit)? = null
    private var hasSong = false
    private var playing = false
    private var songKey: String? = null
    private var title = ""
    private var artist = ""
    private var titleShown = ""
    private var artistShown = ""

    private val art = IslandArt(context)
    private var cover: Bitmap? = null
    private var coverShader: BitmapShader? = null
    private val appIcon: Bitmap = appIconBitmap(context)
    private val appIconShader = BitmapShader(appIcon, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    private var fromColors = IslandColors.NEUTRAL
    private var toColors = IslandColors.NEUTRAL

    private val playerListener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = syncFromPlayer()
    }

    // ── Motion ──────────────────────────────────────────────────────────────────────────────────────────────

    private var wantOpen = false
    private val open = Spring(0f, stiffness = 170f, dampingRatio = 0.86f)
    private val wide = Spring(0f, stiffness = 180f, dampingRatio = 0.92f)
    private val shown = Spring(0f, stiffness = 210f, dampingRatio = 1f)
    private val bump = Spring(0f, stiffness = 600f, dampingRatio = 0.45f)
    private val press = Spring(0f, stiffness = 650f, dampingRatio = 1f)
    private val colorMix = Spring(1f, stiffness = 65f, dampingRatio = 1f)
    private val springs = arrayOf(open, wide, shown, bump, press, colorMix)

    private var looping = false
    private var lastFrameNanos = 0L
    private val frame = Choreographer.FrameCallback { now -> onFrame(now) }

    private val main = Handler(Looper.getMainLooper())
    private val autoClose = Runnable { if (!scrubbing) collapse() }
    private val longPress = Runnable {
        longPressed = true
        press.target = 0f
        performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        openApp()
    }

    // ── Touch ───────────────────────────────────────────────────────────────────────────────────────────────

    private enum class Target { PILL, PREVIOUS, PLAY, NEXT, PROGRESS, OPEN, CARD, NONE }

    private var downX = 0f
    private var downY = 0f
    private var moved = false
    private var longPressed = false
    private var touchTarget = Target.NONE
    private var pressedButton = Target.NONE
    private var scrubbing = false
    private var scrubMs = 0L
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()

    // ── Drawing ─────────────────────────────────────────────────────────────────────────────────────────────

    private val shapeRect = RectF()
    private val scratch = RectF()
    private val shapePath = Path()
    private val clipPath = Path()
    private val matrix = Matrix()
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val gradientPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var gradientFor: String? = null
    private val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val artistPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val timePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        fontFeatureSettings = "tnum"
    }

    // The open card's parts, relative to the anchor (x = 0 is the island's middle), in screen y.
    private val coverBox = RectF()
    private val badgeBox = RectF()
    private val openBox = RectF()
    private val openButton = RectF()
    private var textX = 0f
    private var textWidth = 0f
    private var titleY = 0f
    private var artistY = 0f
    private var progressY = 0f
    private var barLeft = 0f
    private var barRight = 0f
    private var controlsY = 0f
    private var sideButtonX = 0f
    private var sideRadius = 0f
    private var playRadius = 0f

    init {
        isClickable = true
        isFocusable = true
        applyFonts()
        contentDescription = "LuvLyrics island"
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────────────────────────────────────

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        stopWatching = IslandPlayback.watch { next -> bindPlayer(next) }
        IslandFonts.load(context) {
            main.post {
                applyFonts()
                layoutContent()
                invalidate()
            }
        }
        retarget()
    }

    override fun onDetachedFromWindow() {
        stopWatching?.invoke()
        stopWatching = null
        bindPlayer(null)
        art.cancel()
        main.removeCallbacksAndMessages(null)
        Choreographer.getInstance().removeFrameCallback(frame)
        looping = false
        super.onDetachedFromWindow()
    }

    private fun bindPlayer(next: Player?) {
        if (player === next) return
        player?.removeListener(playerListener)
        player = next
        next?.addListener(playerListener)
        syncFromPlayer()
    }

    private fun syncFromPlayer() {
        val p = player
        val item = p?.currentMediaItem
        val meta = p?.mediaMetadata
        val nowHasSong = item != null
        title = meta?.title?.toString().orEmpty()
        artist = (meta?.artist ?: meta?.albumArtist)?.toString().orEmpty()
        playing = p != null && showsPlaying(p)
        val key = if (item == null) null else "${item.mediaId}|$title|${meta?.artworkUri}"
        if (key != songKey) {
            val hadSong = songKey != null
            songKey = key
            setCover(null)
            if (meta != null && nowHasSong) {
                art.load(meta) { bitmap, colors ->
                    setCover(bitmap)
                    setColors(colors ?: IslandColors.NEUTRAL)
                }
            } else {
                art.cancel()
                setColors(IslandColors.NEUTRAL)
            }
            // A new song while the pill shows: a little bump, as the island does when something new arrives.
            if (hadSong && nowHasSong && !wantOpen) {
                bump.kick(4f)
                kickLoop()
            }
        }
        hasSong = nowHasSong
        contentDescription = if (hasSong) "Now playing $title by $artist" else "LuvLyrics island"
        layoutText()
        retarget()
        invalidate()
    }

    private fun setCover(bitmap: Bitmap?) {
        cover = bitmap
        coverShader = bitmap?.let { BitmapShader(it, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        invalidate()
    }

    private fun setColors(next: IslandColors) {
        fromColors = blendedColors()
        toColors = next
        colorMix.snap(0f)
        colorMix.target = 1f
        kickLoop()
    }

    private fun blendedColors(): IslandColors {
        val m = colorMix.value.coerceIn(0f, 1f)
        return IslandColors(
            top = ColorUtils.blendARGB(fromColors.top, toColors.top, m),
            bottom = ColorUtils.blendARGB(fromColors.bottom, toColors.bottom, m),
            accent = ColorUtils.blendARGB(fromColors.accent, toColors.accent, m),
        )
    }

    // ── States ──────────────────────────────────────────────────────────────────────────────────────────────

    private fun expand() {
        if (wantOpen) return
        wantOpen = true
        performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        holdOpen()
        retarget()
    }

    fun collapse() {
        main.removeCallbacks(autoClose)
        scrubbing = false
        pressedButton = Target.NONE
        if (!wantOpen) return
        wantOpen = false
        retarget()
    }

    /** The card stays open while it is used, and closes by itself 8 s after the last touch. */
    private fun holdOpen() {
        main.removeCallbacks(autoClose)
        main.postDelayed(autoClose, AUTO_CLOSE_MS)
    }

    private fun retarget() {
        open.target = if (wantOpen) 1f else 0f
        wide.target = if (hasSong) 1f else 0f
        shown.target = if (hasSong || showWhenIdle || wantOpen) 1f else 0f
        host.setTouchable(shown.target > 0f)
        host.setExpandedTouch(wantOpen || open.value > 0.001f)
        // Start moving first: a moving island only grows its window, so a closing card is never cut off.
        kickLoop()
        refit()
    }

    private fun openApp() {
        host.openApp()
        collapse()
    }

    // ── Frame loop ──────────────────────────────────────────────────────────────────────────────────────────

    private fun kickLoop() {
        if (looping || !isAttachedToWindow) return
        looping = true
        lastFrameNanos = 0L
        Choreographer.getInstance().postFrameCallback(frame)
    }

    private fun onFrame(now: Long) {
        val animationsEnabled = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            android.animation.ValueAnimator.areAnimatorsEnabled()
        } else android.provider.Settings.Global.getFloat(context.contentResolver,
            android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
        if (!animationsEnabled) for (spring in springs) spring.snap(spring.target)
        val dt = if (lastFrameNanos == 0L) 1f / 60f else (now - lastFrameNanos) / 1_000_000_000f
        lastFrameNanos = now
        var moving = false
        for (spring in springs) if (spring.step(dt)) moving = true
        invalidate()
        if (moving) {
            refit()
            Choreographer.getInstance().postFrameCallback(frame)
        } else {
            looping = false
            refit()
            host.setExpandedTouch(wantOpen)
        }
    }

    // ── Window size ─────────────────────────────────────────────────────────────────────────────────────────

    private var fitHalf = 0f
    private var fitBottom = 0f

    /** Grows the window ahead of the shape while it moves (with room for the spring's overshoot); fits it at rest. */
    private fun refit(force: Boolean = false) {
        val g = geometry ?: return
        val pad = g.dp(6f)
        shape(scratch, open.target, wide.target, shown.target, 1f)
        var half = scratch.width() / 2f + pad
        var bottom = scratch.bottom + pad
        if (looping) {
            val overshoot = if (open.target > 0.5f) 1.05f else 1.08f
            half = max(fitHalf, max(half * overshoot, currentHalf() + pad))
            shape(scratch, open.value, wide.value, shown.value, currentScale())
            bottom = max(fitBottom, max(bottom * 1.04f, scratch.bottom + pad))
        }
        if (force || abs(half - fitHalf) > 0.5f || abs(bottom - fitBottom) > 0.5f) {
            fitHalf = half
            fitBottom = bottom
            host.fitWindow(half, bottom)
        }
    }

    private fun currentHalf(): Float {
        shape(scratch, open.value, wide.value, shown.value, currentScale())
        return scratch.width() / 2f
    }

    private fun currentScale() = 1f + 0.05f * bump.value - 0.05f * press.value

    /**
     * The island's outline for open [o], width [w] (idle → compact) and presence [s], centred on x = 0.
     * [o] may overshoot 1 a little: the card grows a touch past its size and settles back, as a spring does.
     */
    private fun shape(out: RectF, o: Float, w: Float, s: Float, scale: Float) {
        val g = geometry ?: return out.setEmpty()
        val presence = s.coerceIn(0f, 1f)
        val pillW = lerp(g.idleWidth, g.compactWidth, w) * lerp(0.55f, 1f, presence)
        val pillH = g.pillHeight * lerp(0.7f, 1f, presence)
        val pillTop = if (g.attached) 0f else g.pillTop + (g.pillHeight - pillH) / 2f
        val half = lerp(pillW / 2f, g.cardWidth / 2f, o)
        val top = lerp(pillTop, g.cardTop, o)
        val bottom = lerp(pillTop + pillH, g.cardTop + g.cardHeight, o)
        out.set(-half * scale, top, half * scale, bottom)
        if (scale != 1f) {
            // Grows and shrinks about its middle (a hanging island keeps its top on the edge).
            val grow = (bottom - top) * (scale - 1f)
            if (g.attached) out.bottom += grow else out.inset(0f, -grow / 2f)
        }
    }

    // ── Layout of the open card ─────────────────────────────────────────────────────────────────────────────

    private fun sp(value: Float): Float {
        val fontScale = min(resources.configuration.fontScale, 1.15f)
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value * fontScale, resources.displayMetrics)
    }

    private fun applyFonts() {
        titlePaint.typeface = IslandFonts.semibold
        artistPaint.typeface = IslandFonts.regular
        timePaint.typeface = IslandFonts.regular
        titlePaint.textSize = sp(17f)
        artistPaint.textSize = sp(15f)
        timePaint.textSize = sp(12f)
    }

    private fun layoutContent() {
        val g = geometry ?: return
        val pad = g.dp(IslandGeometry.CARD_PADDING_DP)
        val cardLeft = -g.cardWidth / 2f
        val cardRight = g.cardWidth / 2f
        coverBox.set(cardLeft + pad, g.contentTop, cardLeft + pad + g.dp(56f), g.contentTop + g.dp(56f))
        badgeBox.set(cardRight - pad - g.dp(22f), g.contentTop, cardRight - pad, g.contentTop + g.dp(22f))
        textX = coverBox.right + g.dp(14f)
        textWidth = max(0f, badgeBox.left - g.dp(10f) - textX)
        titleY = g.contentTop + g.dp(25f)
        artistY = g.contentTop + g.dp(47f)
        openBox.set(coverBox.left, coverBox.top, badgeBox.right, coverBox.bottom)
        progressY = coverBox.bottom + g.dp(16f) + g.dp(10f)
        barLeft = cardLeft + pad + g.dp(44f)
        barRight = cardRight - pad - g.dp(48f)
        controlsY = progressY + g.dp(20f) + g.dp(26f)
        sideButtonX = g.dp(78f)
        sideRadius = g.dp(22f)
        playRadius = g.dp(27f)
        val label = OPEN_LABEL
        val labelWidth = titlePaint.measureText(label) * 0.9f
        openButton.set(-labelWidth / 2f - g.dp(22f), controlsY - g.dp(22f), labelWidth / 2f + g.dp(22f), controlsY + g.dp(22f))
        layoutText()
    }

    private fun layoutText() {
        val primary = if (hasSong) title.ifEmpty { "Unknown song" } else "LuvLyrics"
        val secondary = if (hasSong) artist else "Nothing playing"
        titleShown = TextUtils.ellipsize(primary, titlePaint, textWidth, TextUtils.TruncateAt.END).toString()
        artistShown = TextUtils.ellipsize(secondary, artistPaint, textWidth, TextUtils.TruncateAt.END).toString()
    }

    // ── Drawing ─────────────────────────────────────────────────────────────────────────────────────────────

    override fun onDraw(canvas: Canvas) {
        val g = geometry ?: return
        val presence = shown.value.coerceIn(0f, 1f)
        if (presence <= 0.003f) return
        val cx = width / 2f
        val o = open.value
        val oc = o.coerceIn(0f, 1f)

        shape(shapeRect, o, wide.value, presence, currentScale())
        shapeRect.offset(cx, 0f)
        val radius = min(lerp(shapeRect.height() / 2f, g.cardRadius, oc), shapeRect.height() / 2f)
        shapePath.reset()
        // A hanging island runs its top corners off the edge of the screen.
        val top = if (g.attached) shapeRect.top - radius else shapeRect.top
        shapePath.addRoundRect(shapeRect.left, top, shapeRect.right, shapeRect.bottom, radius, radius, Path.Direction.CW)

        fill.shader = null
        fill.color = Color.BLACK
        fill.alpha = (255 * presence).toInt()
        canvas.drawPath(shapePath, fill)
        if (oc > 0.01f) {
            updateGradient(g)
            gradientPaint.alpha = (255 * oc * presence).toInt()
            canvas.drawPath(shapePath, gradientPaint)
            glowPaint.alpha = (255 * oc * presence).toInt()
            canvas.drawPath(shapePath, glowPaint)
        }

        canvas.save()
        clipPath.set(shapePath)
        canvas.clipPath(clipPath)
        val compactAlpha = (1f - oc / 0.35f).coerceIn(0f, 1f) * wide.value.coerceIn(0f, 1f) * presence
        if (compactAlpha > 0.01f) drawCompact(canvas, g, shapeRect, compactAlpha)
        val cardAlpha = ((oc - 0.45f) / 0.55f).coerceIn(0f, 1f) * presence
        if (cardAlpha > 0.01f) drawCard(canvas, g, cx, cardAlpha)
        canvas.restore()

        scheduleTicks(compactAlpha, cardAlpha)
    }

    private fun updateGradient(g: IslandGeometry) {
        val c = blendedColors()
        val key = "${c.top}|${c.bottom}|${g.cardTop}|${g.cardHeight}|$width"
        if (key == gradientFor) return
        gradientFor = key
        gradientPaint.shader = LinearGradient(
            0f, g.cardTop, 0f, g.cardTop + g.cardHeight,
            intArrayOf(Color.BLACK, c.top, Color.rgb(4, 4, 9)),
            floatArrayOf(0f, 0.40f, 1f),
            Shader.TileMode.CLAMP,
        )
        // Light blooms up from below the controls; the camera and title stay in a black room.
        glowPaint.shader = RadialGradient(
            width / 2f, g.cardTop + g.cardHeight * 1.12f,
            max(g.cardWidth * 0.68f, g.cardHeight * 1.03f),
            intArrayOf(c.bottom, ColorUtils.setAlphaComponent(c.bottom, 125), Color.TRANSPARENT),
            floatArrayOf(0f, 0.40f, 1f), Shader.TileMode.CLAMP,
        )
    }

    /** The pill with a song: the cover on the left, level bars on the right, the camera between them. */
    private fun drawCompact(canvas: Canvas, g: IslandGeometry, pill: RectF, alpha: Float) {
        val size = max(g.dp(16f), g.pillHeight - g.dp(10f))
        val inset = (g.pillHeight - size) / 2f
        val cy = if (g.attached) pill.bottom - g.pillHeight / 2f else pill.centerY()
        scratch.set(pill.left + inset + g.dp(2f), cy - size / 2f, pill.left + inset + g.dp(2f) + size, cy + size / 2f)
        drawImage(canvas, scratch, size / 2f, alpha)

        val bars = 4
        val barWidth = g.dp(3f)
        val gap = g.dp(2.6f)
        val maxH = size * 0.78f
        val right = pill.right - inset - g.dp(4f)
        val left = right - bars * barWidth - (bars - 1) * gap
        val t = SystemClock.uptimeMillis() / 1000f
        fill.shader = null
        fill.color = blendedColors().accent
        fill.alpha = (255 * alpha).toInt()
        for (i in 0 until bars) {
            val level = if (playing && screenOn) {
                0.32f + 0.68f * abs(sin(t * BAR_SPEED[i] + BAR_PHASE[i]) * 0.65f + sin(t * BAR_SPEED[i] * 0.53f + i) * 0.35f)
            } else {
                0.22f
            }
            val h = max(barWidth, maxH * level)
            val x = left + i * (barWidth + gap)
            canvas.drawRoundRect(x, cy - h / 2f, x + barWidth, cy + h / 2f, barWidth / 2f, barWidth / 2f, fill)
        }
    }

    /** The open card, drawn where it rests and revealed by the growing outline (the canvas is clipped to it). */
    private fun drawCard(canvas: Canvas, g: IslandGeometry, cx: Float, alpha: Float) {
        canvas.save()
        val settle = 1f - alpha
        canvas.translate(cx, -g.dp(8f) * settle)
        val s = lerp(0.94f, 1f, alpha)
        canvas.scale(s, s, 0f, g.cardTop)

        drawImage(canvas, coverBox, g.dp(12f), alpha, useAppIcon = !hasSong)
        // LuvLyrics' mark where Spotify puts its own.
        if (hasSong) {
            imagePaint.shader = appIconShader
            fitShader(appIcon, badgeBox)
            imagePaint.alpha = (255 * alpha * 0.92f).toInt()
            canvas.drawRoundRect(badgeBox, badgeBox.width() / 2f, badgeBox.width() / 2f, imagePaint)
        }

        titlePaint.alpha = (255 * alpha).toInt()
        canvas.drawText(titleShown, textX, titleY, titlePaint)
        artistPaint.alpha = (255 * alpha * 0.62f).toInt()
        canvas.drawText(artistShown, textX, artistY, artistPaint)

        if (hasSong) {
            drawProgress(canvas, g, alpha)
            drawButton(canvas, -sideButtonX, sideRadius, IslandIcons.previous, g.dp(22f), alpha, Target.PREVIOUS)
            drawButton(canvas, 0f, playRadius, if (playing) IslandIcons.pause else IslandIcons.play, g.dp(26f), alpha, Target.PLAY)
            drawButton(canvas, sideButtonX, sideRadius, IslandIcons.next, g.dp(22f), alpha, Target.NEXT)
        } else {
            val pressed = pressedButton == Target.OPEN
            fill.shader = null
            fill.color = Color.WHITE
            fill.alpha = (255 * alpha * if (pressed) 0.26f else 0.16f).toInt()
            canvas.drawRoundRect(openButton, openButton.height() / 2f, openButton.height() / 2f, fill)
            titlePaint.alpha = (255 * alpha).toInt()
            val labelSize = titlePaint.textSize
            titlePaint.textSize = labelSize * 0.9f
            val w = titlePaint.measureText(OPEN_LABEL)
            canvas.drawText(OPEN_LABEL, -w / 2f, controlsY + titlePaint.textSize * 0.35f, titlePaint)
            titlePaint.textSize = labelSize
        }
        canvas.restore()
    }

    private fun drawProgress(canvas: Canvas, g: IslandGeometry, alpha: Float) {
        val p = player
        val duration = p?.duration?.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0L
        val position = if (scrubbing) scrubMs else (p?.currentPosition ?: 0L).coerceIn(0L, max(duration, 0L))
        val fraction = if (duration > 0) position.toFloat() / duration else 0f

        timePaint.alpha = (255 * alpha * 0.7f).toInt()
        val baseline = progressY + timePaint.textSize * 0.36f
        val pad = g.dp(IslandGeometry.CARD_PADDING_DP)
        canvas.drawText(islandClock(position), -g.cardWidth / 2f + pad, baseline, timePaint)
        val remaining = if (duration > 0) islandClock(duration - position, remaining = true) else "--:--"
        canvas.drawText(remaining, g.cardWidth / 2f - pad - timePaint.measureText(remaining), baseline, timePaint)

        val track = g.dp(if (scrubbing) 6f else 4f)
        fill.shader = null
        fill.color = Color.WHITE
        fill.alpha = (255 * alpha * 0.22f).toInt()
        canvas.drawRoundRect(barLeft, progressY - track / 2f, barRight, progressY + track / 2f, track / 2f, track / 2f, fill)
        val x = barLeft + (barRight - barLeft) * fraction
        fill.alpha = (255 * alpha).toInt()
        canvas.drawRoundRect(barLeft, progressY - track / 2f, max(barLeft + track, x), progressY + track / 2f, track / 2f, track / 2f, fill)
        canvas.drawCircle(x, progressY, g.dp(if (scrubbing) 8f else 6f), fill)
    }

    private fun drawButton(canvas: Canvas, x: Float, radius: Float, icon: Path, iconSize: Float, alpha: Float, which: Target) {
        val pressed = pressedButton == which
        val r = if (pressed) radius * 0.9f else radius
        fill.shader = null
        fill.color = Color.WHITE
        fill.alpha = (255 * alpha * (if (pressed) 0.28f else if (which == Target.PLAY) 0.18f else 0.13f)).toInt()
        canvas.drawCircle(x, controlsY, r, fill)
        iconPaint.alpha = (255 * alpha).toInt()
        IslandIcons.draw(canvas, icon, x, controlsY, if (pressed) iconSize * 0.9f else iconSize, iconPaint)
    }

    /** The song's cover (or, with none yet, a soft tile; with no song, the app's icon) in a rounded square. */
    private fun drawImage(canvas: Canvas, box: RectF, radius: Float, alpha: Float, useAppIcon: Boolean = false) {
        val bitmap = if (useAppIcon) appIcon else cover
        val shader = if (useAppIcon) appIconShader else coverShader
        if (bitmap == null || shader == null) {
            fill.shader = null
            fill.color = Color.WHITE
            fill.alpha = (255 * alpha * 0.12f).toInt()
            canvas.drawRoundRect(box, radius, radius, fill)
            return
        }
        imagePaint.shader = shader
        fitShader(bitmap, box)
        imagePaint.alpha = (255 * alpha).toInt()
        canvas.drawRoundRect(box, radius, radius, imagePaint)
    }

    /** Centre-crops [bitmap] into [box] through the image paint's shader. */
    private fun fitShader(bitmap: Bitmap, box: RectF) {
        val scale = max(box.width() / bitmap.width, box.height() / bitmap.height)
        matrix.setScale(scale, scale)
        matrix.postTranslate(
            box.left + (box.width() - bitmap.width * scale) / 2f,
            box.top + (box.height() - bitmap.height * scale) / 2f,
        )
        imagePaint.shader?.setLocalMatrix(matrix)
    }

    /** Level bars at 30 fps while they show and music plays; the open card's clock twice a second. */
    private fun scheduleTicks(compactAlpha: Float, cardAlpha: Float) {
        if (looping || !screenOn || !playing) return
        when {
            compactAlpha > 0.01f -> postInvalidateDelayed(BAR_FRAME_MS)
            cardAlpha > 0.5f -> postInvalidateDelayed(CLOCK_TICK_MS)
        }
    }

    // ── Touch ───────────────────────────────────────────────────────────────────────────────────────────────

    override fun performClick(): Boolean {
        super.performClick()
        if (wantOpen) collapse() else expand()
        return true
    }

    override fun onInitializeAccessibilityNodeInfo(info: android.view.accessibility.AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.className = "android.widget.Button"
        info.addAction(android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction(
            android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK, if (wantOpen) "Collapse island" else "Expand island"))
        val actions = listOf(
            com.lyricflow.app.R.id.island_open_app to "Open LuvLyrics",
        ) + if (hasSong) listOf(
            com.lyricflow.app.R.id.island_previous to "Previous song",
            com.lyricflow.app.R.id.island_play_pause to if (playing) "Pause" else "Play",
            com.lyricflow.app.R.id.island_next to "Next song",
        ) else emptyList()
        for ((id, label) in actions) info.addAction(android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction(id, label))
    }

    override fun performAccessibilityAction(action: Int, arguments: android.os.Bundle?): Boolean {
        when (action) {
            com.lyricflow.app.R.id.island_previous -> act(Target.PREVIOUS)
            com.lyricflow.app.R.id.island_play_pause -> act(Target.PLAY)
            com.lyricflow.app.R.id.island_next -> act(Target.NEXT)
            com.lyricflow.app.R.id.island_open_app -> openApp()
            else -> return super.performAccessibilityAction(action, arguments)
        }
        return true
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val g = geometry ?: return false
        val x = event.x - width / 2f
        val y = event.y
        when (event.actionMasked) {
            MotionEvent.ACTION_OUTSIDE -> {
                collapse()
                return false
            }
            MotionEvent.ACTION_DOWN -> {
                downX = x
                downY = y
                moved = false
                longPressed = false
                touchTarget = hitTest(x, y)
                if (touchTarget == Target.NONE) return false
                if (!wantOpen) {
                    press.target = 1f
                    kickLoop()
                    main.postDelayed(longPress, LONG_PRESS_MS)
                } else {
                    holdOpen()
                    when (touchTarget) {
                        Target.PROGRESS -> startScrub(x)
                        Target.PREVIOUS, Target.PLAY, Target.NEXT, Target.OPEN -> pressedButton = touchTarget
                        else -> Unit
                    }
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = x - downX
                val dy = y - downY
                if (!moved && abs(dx) + abs(dy) > touchSlop) {
                    moved = true
                    main.removeCallbacks(longPress)
                    if (!scrubbing && pressedButton != Target.NONE) {
                        pressedButton = Target.NONE
                        invalidate()
                    }
                }
                if (!wantOpen) {
                    // Pull the pill down to open it.
                    if (!longPressed && dy > g.dp(14f)) {
                        main.removeCallbacks(longPress)
                        press.target = 0f
                        expand()
                    }
                } else if (scrubbing) {
                    moveScrub(x)
                } else if (dy < -g.dp(24f)) {
                    // Push the card up to put it away.
                    collapse()
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                main.removeCallbacks(longPress)
                press.target = 0f
                kickLoop()
                if (longPressed) return true
                if (!wantOpen) {
                    if (!moved && touchTarget == Target.PILL) performClick()
                } else if (scrubbing) {
                    endScrub()
                } else if (!moved) {
                    act(touchTarget)
                }
                pressedButton = Target.NONE
                invalidate()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                main.removeCallbacks(longPress)
                press.target = 0f
                scrubbing = false
                pressedButton = Target.NONE
                kickLoop()
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    private fun hitTest(x: Float, y: Float): Target {
        val g = geometry ?: return Target.NONE
        if (shown.target <= 0f) return Target.NONE
        if (!wantOpen) {
            // The whole window round the pill counts: a tap near the camera is a tap on the island.
            return Target.PILL
        }
        val slop = g.dp(8f)
        fun inCircle(cx: Float, r: Float) = (x - cx) * (x - cx) + (y - controlsY) * (y - controlsY) <= (r + slop) * (r + slop)
        if (hasSong) {
            if (inCircle(0f, playRadius)) return Target.PLAY
            if (inCircle(-sideButtonX, sideRadius)) return Target.PREVIOUS
            if (inCircle(sideButtonX, sideRadius)) return Target.NEXT
            if (x in (barLeft - slop)..(barRight + slop) && abs(y - progressY) <= g.dp(16f)) return Target.PROGRESS
        } else if (x in (openButton.left - slop)..(openButton.right + slop) && abs(y - controlsY) <= openButton.height() / 2f + slop) {
            return Target.OPEN
        }
        if (openBox.contains(x, y)) return Target.OPEN
        return Target.CARD
    }

    private fun act(target: Target) {
        val p = player
        when (target) {
            Target.PLAY -> p?.let { if (showsPlaying(it)) it.pause() else resumePlayback(it) }
            Target.PREVIOUS -> p?.seekToPrevious()
            Target.NEXT -> p?.seekToNext()
            Target.OPEN -> {
                openApp()
                return
            }
            else -> return
        }
        performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    }

    private fun startScrub(x: Float) {
        val duration = player?.duration?.takeIf { it != C.TIME_UNSET && it > 0 } ?: return
        scrubbing = true
        scrubMs = msAt(x, duration)
        parent?.requestDisallowInterceptTouchEvent(true)
        invalidate()
    }

    private fun moveScrub(x: Float) {
        val duration = player?.duration?.takeIf { it != C.TIME_UNSET && it > 0 } ?: return
        scrubMs = msAt(x, duration)
        holdOpen()
        invalidate()
    }

    private fun endScrub() {
        // Media3 keeps playWhenReady across a seek, so music that was playing carries on from there.
        player?.seekTo(scrubMs)
        scrubbing = false
        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        holdOpen()
    }

    private fun msAt(x: Float, duration: Long): Long {
        val f = ((x - barLeft) / (barRight - barLeft)).coerceIn(0f, 1f)
        return (duration * f).toLong()
    }

    private companion object {
        const val AUTO_CLOSE_MS = 8_000L
        const val LONG_PRESS_MS = 450L
        const val BAR_FRAME_MS = 33L
        const val CLOCK_TICK_MS = 500L
        const val OPEN_LABEL = "Open LuvLyrics"
        val BAR_SPEED = floatArrayOf(3.2f, 4.1f, 2.8f, 3.7f)
        val BAR_PHASE = floatArrayOf(0f, 1.7f, 3.1f, 4.6f)

        fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t

        fun appIconBitmap(context: Context): Bitmap {
            val size = 128
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            try {
                val icon = context.packageManager.getApplicationIcon(context.packageName)
                val canvas = Canvas(bitmap)
                icon.setBounds(0, 0, size, size)
                icon.draw(canvas)
            } catch (_: Throwable) {
                bitmap.eraseColor(Color.DKGRAY)
            }
            return bitmap
        }
    }
}
