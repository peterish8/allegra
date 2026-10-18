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
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.TypedValue
import android.view.Choreographer
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.widget.OverScroller
import androidx.core.graphics.ColorUtils
import androidx.media3.common.C
import androidx.media3.common.Player
import com.lyricflow.app.playback.resumePlayback
import com.lyricflow.app.playback.showsPlaying
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * The island: a floating black pill round the camera that springs open into a now-playing card, drawn by hand on
 * one canvas so the morph never runs a layout pass.
 *
 * Shapes are centred on the view's middle and grow down from the pill's top; IslandWindow keeps the window
 * centred on the camera with a stable horizontal surface. Its height grows ahead of the morph and shrinks at
 * rest; a separate compact input window leaves the surrounding status bar touchable while closed.
 *
 * One shape, five looks:
 * - idle: the camera and a little black either side (nothing loaded),
 * - compact: the cover on the left, level bars on the right (a song is loaded),
 * - open: the card — cover, title, artist, a scrubber and previous / play-pause / next, over the cover's colours
 *   drifting as the website's now-playing room does (only while music plays),
 * - lyrics: pull the open card down again and it grows into every line of the song, following the singer,
 * - playlists: swipe the open card left for the listener's playlists, tap one for its songs, tap a song and the
 *   island folds back into the card while it starts playing; swipe it right for the downloaded songs (offline),
 * - search: pull the card down from its top part and a search drawer opens with the keyboard; the best answer is
 *   shown large, the rest under it, and a tap plays one with similar songs after it.
 *
 * Nothing ticks when nothing moves: the springs run on Choreographer only while moving, the level bars draw at
 * 30 fps only while music plays and the pill shows them, and the open card redraws only while its light drifts
 * (music playing), a title slides or a line glides.
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
        /**
         * Opens LuvLyrics at [link] (a `lyricflow://` link). [from] is the island's outline in this view's
         * coordinates: the app's window grows out of it.
         */
        fun openApp(link: String = PLAYER_LINK, from: RectF? = null)
        /**
         * The search drawer's text field, in this view's coordinates, or null to put it away: the host lays a real
         * text field over it, so the keyboard comes up, and hands each change to [setSearchText].
         */
        fun showSearchInput(field: RectF?)
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

    /** The listener's choice: the open card shows two lines of lyrics under its controls. */
    var showLyricStrip = true
        set(value) {
            if (field == value) return
            field = value
            lyricsRoom.target = if (lyricLines.isEmpty() || !value) 0f else 1f
            if (wantOpen) holdOpen()
            kickLoop()
            refit()
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
    private var titleWidth = 0f
    private var artistWidth = 0f

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

    // ── Pages ───────────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Where the open island rests, at its place along the row of pages: the downloads left of the now-playing card
     * (or its lyrics), the playlists right of it, and then one playlist's songs.
     */
    private enum class Page(val at: Float) { DOWNLOADS(-1f), NOW(0f), PLAYLISTS(1f), SONGS(2f) }

    private var page = Page.NOW
    /** On the now-playing page: the lyrics fill the island. */
    private var lyricsFull = false
    private var songsOf: IslandLibrary.Playlist? = null
    private var playlists: List<IslandLibrary.Playlist> = emptyList()
    /** A page leaving without sliding (a picked song folds the songs away into the card). */
    private var ghostPage: Page? = null
    private var resetPagesWhenClosed = false
    private val thumbs = IslandThumbs(context) { invalidate() }
    private var downloads: List<IslandLibrary.Song> = emptyList()

    // ── Search ──────────────────────────────────────────────────────────────────────────────────────────────

    /** The search drawer is open (the keyboard is up); [searchText] is what has been typed. */
    private var searchOpen = false
    private var searchText = ""
    private var searchResults: List<IslandLibrary.Song> = emptyList()
    /** JavaScript is not there to search (the app is not running): the drawer says to open it. */
    private var searchUnavailable = false
    private val runSearch = Runnable { searchUnavailable = !IslandLibrary.search(searchText.trim()); invalidate() }
    private val fieldBox = RectF()
    private val bestBox = RectF()
    private val bestPlay = RectF()
    private var resultsTop = 0f
    private var searchScroll = 0f
    // ── Continuity ──────────────────────────────────────────────────────────────────────────────────────────
    // Whatever is there before and after a change moves there; it is never faded out here and in over there.

    /**
     * A picked song on its way into the card: the tapped row's cover, title and artist, lifted out of the list
     * ([from], in card coordinates) and flown into the card's own places. Until the player has started that song
     * (and its cover has loaded) the card keeps showing these, so it shows the pick from the first frame.
     */
    private class Flyer(
        val songId: String, val thumb: IslandThumbs.Thumb?, val from: RectF, val fromCorner: Float,
        val title: String, val artist: String, val titleX: Float, val titleY: Float, val artistY: Float,
        val titleSize: Float, val artistSize: Float, val startedMs: Long,
    )
    private var flyer: Flyer? = null
    private val fly = Spring(1f, stiffness = 170f, dampingRatio = 0.86f)
    /** The row the flyer left, which the folding list no longer draws (search answers: page null). */
    private var flyRowPage: Page? = null
    private var flyRowIndex = -1
    private var drawingGhost = false
    private val flyRect = RectF()
    /** This frame, the cover is drawn once, moving between the pill and the card (see onDraw). */
    private var coverMorphing = false
    private val morphRect = RectF()

    /** No cover arrived in time for a new song: its colours fade to neutral rather than keep the last song's. */
    private val neutralColors = Runnable {
        if (cover == null) {
            setGlow(null)
            setColors(IslandColors.NEUTRAL)
        }
    }

    // ── Motion ──────────────────────────────────────────────────────────────────────────────────────────────

    private var wantOpen = false
    private val open = Spring(0f, stiffness = 170f, dampingRatio = 0.86f)
    private val wide = Spring(0f, stiffness = 180f, dampingRatio = 0.92f)
    private val shown = Spring(0f, stiffness = 210f, dampingRatio = 1f)
    private val bump = Spring(0f, stiffness = 600f, dampingRatio = 0.45f)
    private val press = Spring(0f, stiffness = 650f, dampingRatio = 1f)
    private val colorMix = Spring(1f, stiffness = 65f, dampingRatio = 1f)
    // Lyrics: the card grows a strip for them (lyricsRoom), and each new line glides up into place (lineMove, 1 → 0).
    private val lyricsRoom = Spring(0f, stiffness = 170f, dampingRatio = 1f)
    private val lineMove = Spring(0f, stiffness = 220f, dampingRatio = 1f)
    // The island's height between the card (0) and full mode (1), and the now-playing page's own morph into its
    // lyrics (lyricsP): separate, so sliding to the playlists grows the island without turning the card into lyrics.
    private val full = Spring(0f, stiffness = 170f, dampingRatio = 0.86f)
    private val lyricsP = Spring(0f, stiffness = 170f, dampingRatio = 0.9f)
    /** Which page shows: 0 now playing, 1 playlists, 2 songs; between them while sliding. */
    private val pageX = Spring(0f, stiffness = 190f, dampingRatio = 0.9f)
    private val ghost = Spring(0f, stiffness = 260f, dampingRatio = 1f)
    /** The search drawer: 0 the card, 1 the drawer at its height with the keyboard under it. */
    private val searchP = Spring(0f, stiffness = 170f, dampingRatio = 0.86f)
    /** The scrubber swells under the finger (1) and settles back to a line (0), as the app's slider does. */
    private val scrubGrow = Spring(0f, stiffness = 420f, dampingRatio = 1f)
    /** Full lyrics: how far the list has scrolled, gliding to the sung line on one decelerating spring. */
    private val lyricScroll = Spring(0f, stiffness = 110f, dampingRatio = 1f)
    /** How fast the light drifts: 1 while music plays, easing to a stop on pause (0) and back. */
    private val blobSpeed = Spring(0f, stiffness = 40f, dampingRatio = 1f)
    /** Paused mid-loop: the title and artist glide home to their start, from where they were (1 → 0). */
    private val marqueeHome = Spring(0f, stiffness = 120f, dampingRatio = 1f)
    private val springs = arrayOf(open, wide, shown, bump, press, colorMix, lyricsRoom, lineMove, full, lyricsP, pageX,
        ghost, scrubGrow, lyricScroll, blobSpeed, searchP, fly, marqueeHome)
    private var lyricLines: List<IslandLyrics.Line> = emptyList()
    private var lyricIndex = -1
    private var lyricFrom = -1
    /** Each line fitted to the card once (size, trimmed text, width), so a frame never measures or allocates. */
    private class LyricFit(val text: String, val size: Float, val width: Float)
    private val lyricFits = HashMap<Int, LyricFit>()
    /** Full lyrics, each line laid out once (wrapped to the card), with its top in the list. */
    private var lyricLayouts: List<StaticLayout> = emptyList()
    private var lyricTops = FloatArray(0)
    private var lyricScrollPlaced = false

    private var looping = false
    private var lastFrameNanos = 0L
    private val frame = Choreographer.FrameCallback { now -> onFrame(now) }
    /** The light's own clock, in seconds: it advances only while music plays, so a pause holds the room still. */
    private var blobClock = 0f
    private var blobLastMs = 0L
    /** The marquee's own clock, in seconds: it runs only while music plays (see drawNowPlaying). */
    private var marqueeClock = 0f
    private var marqueeLastMs = 0L
    private var titleFrom = 0f
    private var titleTo = 0f
    private var artistFrom = 0f
    private var artistTo = 0f

    private val main = Handler(Looper.getMainLooper())
    private val autoClose = Runnable { if (!scrubbing && !dragging) collapse() }
    private val longPress = Runnable {
        longPressed = true
        press.target = 0f
        performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        openApp()
    }

    // ── Touch ───────────────────────────────────────────────────────────────────────────────────────────────

    private enum class Target { PILL, PREVIOUS, PLAY, NEXT, PROGRESS, OPEN, CARD, BACK, ROW, LYRICS, FIELD, BEST, NONE }
    private enum class Axis { NONE, HORIZONTAL, VERTICAL, SEARCH }

    private var downX = 0f
    private var downY = 0f
    private var downTime = 0L
    private var moved = false
    private var longPressed = false
    private var touchTarget = Target.NONE
    private var pressedButton = Target.NONE
    private var scrubbing = false
    private var scrubMs = 0L
    private var dragging = false
    private var axis = Axis.NONE
    private var dragBase = 0f
    private var velocity: VelocityTracker? = null
    private val listScroller = OverScroller(context)
    private var playlistScroll = 0f
    private var songScroll = 0f
    private var downloadScroll = 0f
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    private val maxFlingVelocity = ViewConfiguration.get(context).scaledMaximumFlingVelocity.toFloat()

    // ── Drawing ─────────────────────────────────────────────────────────────────────────────────────────────

    private val shapeRect = RectF()
    private val scratch = RectF()
    private val shapePath = Path()
    private val clipPath = Path()
    private val trackPath = Path()
    private val chevron = Path()
    private val matrix = Matrix()
    private val point = FloatArray(2)
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val gradientPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val veilPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    /** What the card's wash and veil were built for (colour, height, width): rebuilt only when one changes. */
    private var gradientFor: Long? = null
    private val layerState = FloatArray(2)
    /** The light: this song's (and, while they cross-fade, the last song's) blurred cover, one paint per layer. */
    private val glowPaints = Array(IslandMotion.LAYERS.size) { i ->
        Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG).apply {
            if (IslandMotion.LAYERS[i].screen) xfermode = PorterDuffXfermode(PorterDuff.Mode.SCREEN)
        }
    }
    private val oldGlowPaints = Array(IslandMotion.LAYERS.size) { i ->
        Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG).apply {
            if (IslandMotion.LAYERS[i].screen) xfermode = PorterDuffXfermode(PorterDuff.Mode.SCREEN)
        }
    }
    /** One shader per layer (each is moved by its own matrix within a frame). */
    private var glow: Array<BitmapShader>? = null
    private var oldGlow: Array<BitmapShader>? = null
    private var neutralGlow: Array<BitmapShader>? = null
    private val fadePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT) }
    private var textFadeLeft: Shader? = null
    private var textFadeRight: Shader? = null
    private var lyricFadeTop: Shader? = null
    private var lyricFadeBottom: Shader? = null
    private var listFadeTop: Shader? = null
    private var listFadeBottom: Shader? = null
    private val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val artistPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val lyricPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val fullLyricPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val rowTitlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val rowSubPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val timePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        fontFeatureSettings = "tnum"
    }
    /**
     * Row text trimmed to its room once (title and subtitle per row, per list), and the headers' names, so
     * scrolling never measures or builds a string.
     */
    private var playlistTexts = arrayOfNulls<String>(0)
    private var songTexts = arrayOfNulls<String>(0)
    private var songTextsFor: String? = null
    private var downloadTexts = arrayOfNulls<String>(0)
    private var resultTexts = arrayOfNulls<String>(0)
    private var downloadsCount = ""
    private var songsCount = ""
    private var playlistsCount = ""
    private val headerNames = arrayOfNulls<String>(Page.entries.size)

    // The open card's parts, relative to the anchor (x = 0 is the island's middle), in screen y.
    private val coverBox = RectF()
    private val badgeBox = RectF()
    private val openBox = RectF()
    private val openButton = RectF()
    private val backBox = RectF()
    /** The downloads sit left of the card, so their way back is on the right. */
    private val backRightBox = RectF()
    private var textX = 0f
    private var textWidth = 0f
    private var titleY = 0f
    private var artistY = 0f
    private var progressY = 0f
    private var fullProgressY = 0f
    private var barLeft = 0f
    private var barRight = 0f
    private var controlsY = 0f
    private var sideButtonX = 0f
    private var sideRadius = 0f
    private var playRadius = 0f
    private var lyricsTop = 0f
    private var lyricsBottom = 0f
    private var listTop = 0f
    private var listBottom = 0f

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
        IslandLyrics.onChange = { refreshLyrics() }
        IslandLibrary.onChange = { refreshLibrary() }
        refreshLibrary()
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
        IslandLyrics.onChange = null
        IslandLibrary.onChange = null
        bindPlayer(null)
        art.cancel()
        thumbs.clear()
        if (searchOpen) host.showSearchInput(null)
        main.removeCallbacksAndMessages(null)
        Choreographer.getInstance().removeFrameCallback(frame)
        looping = false
        velocity?.recycle()
        velocity = null
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
        val wasPlaying = playing
        playing = p != null && showsPlaying(p)
        blobSpeed.target = if (playing) 1f else 0f
        if (wasPlaying && !playing) sendMarqueeHome()
        // A song with no cover address is keyed on its embedded picture too, which the player reads a moment later.
        val embedded = if (meta?.artworkUri == null) meta?.artworkData?.size ?: 0 else 0
        val key = if (item == null) null else "${item.mediaId}|$title|${meta?.artworkUri}|$embedded"
        if (key != songKey) {
            val previousId = songKey?.substringBefore('|')
            val sameSong = previousId != null && previousId == item?.mediaId
            songKey = key
            if (!sameSong) resetMarquee()
            main.removeCallbacks(neutralColors)
            val ready = meta?.let { art.cached(it) }
            if (ready != null) {
                // Decoded before (played earlier, or prefetched as the next song): it changes with the title.
                art.cancel()
                setCover(ready.bitmap)
                setGlow(ready.glow)
                setColors(ready.colors ?: IslandColors.NEUTRAL)
            } else if (meta != null && nowHasSong) {
                // The same song's cover being replaced keeps the old one until the new one is ready.
                if (!sameSong) {
                    setCover(null)
                    main.postDelayed(neutralColors, NEUTRAL_AFTER_MS)
                }
                art.load(meta) { bitmap, colors, light ->
                    main.removeCallbacks(neutralColors)
                    if (bitmap != null || !sameSong) {
                        setCover(bitmap)
                        setGlow(light)
                    }
                    setColors(colors ?: IslandColors.NEUTRAL)
                }
            } else {
                art.cancel()
                setCover(null)
                setGlow(null)
                setColors(IslandColors.NEUTRAL)
            }
            // A new song while the pill shows: a little bump, as the island does when something new arrives.
            if (previousId != null && !sameSong && nowHasSong && !wantOpen) {
                bump.kick(4f)
            }
            prefetchNext(p)
        }
        hasSong = nowHasSong
        contentDescription = if (hasSong) "Now playing $title by $artist" else "LuvLyrics island"
        layoutText()
        refreshLyrics()
        retarget()
        invalidate()
    }

    /**
     * Picks up the lines for the playing song; the card grows room for them, or gives it back, on a spring.
     * Player events call this often, so it does nothing unless the lines actually changed.
     */
    private fun refreshLyrics() {
        val next = if (hasSong) IslandLyrics.linesFor(player?.currentMediaItem?.mediaId) else emptyList()
        if (next === lyricLines) return
        lyricLines = next
        lyricIndex = -1
        lyricFrom = -1
        lyricFits.clear()
        lyricLayouts = emptyList()
        lyricScrollPlaced = false
        lineMove.snap(0f)
        lyricsRoom.target = if (lyricLines.isEmpty() || !showLyricStrip) 0f else 1f
        // A song without lyrics folds full lyrics back into the card.
        if (lyricLines.isEmpty() && lyricsFull) setLyricsFull(false)
        if (wantOpen) holdOpen()
        kickLoop()
        refit()
        invalidate()
    }

    /** New playlists from the app: the open list keeps its place, and an open playlist follows its new copy. */
    private fun refreshLibrary() {
        playlists = IslandLibrary.playlists
        downloads = IslandLibrary.downloads
        if (searchResults !== IslandLibrary.searchResults) {
            searchResults = IslandLibrary.searchResults
            resultTexts = arrayOfNulls(searchResults.size * 2)
            searchScroll = 0f
        }
        clearRowTexts()
        playlistsCount = if (playlists.isEmpty()) "" else "${playlists.size}"
        downloadsCount = if (downloads.isEmpty()) "" else songsLabel(downloads.size)
        songsOf = songsOf?.let { open -> playlists.firstOrNull { it.id == open.id } }
        if (songsOf == null && page == Page.SONGS) showPage(Page.PLAYLISTS)
        playlistScroll = playlistScroll.coerceIn(0f, maxScroll(Page.PLAYLISTS))
        songScroll = songScroll.coerceIn(0f, maxScroll(Page.SONGS))
        downloadScroll = downloadScroll.coerceIn(0f, maxScroll(Page.DOWNLOADS))
        invalidate()
    }

    /** A new title, or the card opening: the marquee starts over from its first beat. */
    private fun resetMarquee() {
        marqueeClock = 0f
        marqueeHome.snap(0f)
    }

    /**
     * The music paused: a title or artist caught mid-loop glides to its start (back, or on to the next copy, which
     * shows the same start), and the marquee clock starts over, so playing again rests on the start, then loops.
     */
    private fun sendMarqueeHome() {
        val g = geometry ?: return
        titleFrom = shownMarquee(marqueeClock, titleWidth, g, titleFrom, titleTo)
        artistFrom = shownMarquee(marqueeClock, artistWidth, g, artistFrom, artistTo)
        titleTo = IslandMotion.marqueeHome(titleFrom, IslandMotion.marqueeDistance(titleWidth, g.density))
        artistTo = IslandMotion.marqueeHome(artistFrom, IslandMotion.marqueeDistance(artistWidth, g.density))
        marqueeClock = 0f
        if (titleFrom != titleTo || artistFrom != artistTo) {
            marqueeHome.snap(1f)
            marqueeHome.target = 0f
            kickLoop()
        }
    }

    /** Where text [textW] wide is drawn now: gliding home after a pause, else on its clock. */
    private fun shownMarquee(clock: Float, textW: Float, g: IslandGeometry, from: Float, to: Float): Float {
        val home = marqueeHome.value
        if (home > 0.0005f) return to + (from - to) * home
        return IslandMotion.marqueeOffset(clock, textW, textWidth, g.density)
    }

    /** The next song's cover is decoded ahead, so a skip (or the queue moving on) shows it on the first frame. */
    private fun prefetchNext(p: Player?) {
        val next = p?.nextMediaItemIndex ?: return
        if (next == C.INDEX_UNSET) return
        val meta = try { p.getMediaItemAt(next).mediaMetadata } catch (_: Exception) { return }
        art.prefetch(meta)
    }

    private fun setCover(bitmap: Bitmap?) {
        cover = bitmap
        coverShader = bitmap?.let { BitmapShader(it, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        invalidate()
    }

    /** The new song's light; the last one's stays under it while the colours cross over (colorMix). */
    private fun setGlow(light: Bitmap?) {
        val next = light?.let { shadersFor(it) }
        if (next == null && glow == null) return
        oldGlow = glow
        glow = next
    }

    private fun shadersFor(light: Bitmap) =
        Array(IslandMotion.LAYERS.size) { BitmapShader(light, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }

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
            second = ColorUtils.blendARGB(fromColors.second, toColors.second, m),
        )
    }

    // ── States ──────────────────────────────────────────────────────────────────────────────────────────────

    private fun expand() {
        if (wantOpen) return
        wantOpen = true
        if (resetPagesWhenClosed) resetPages()
        resetMarquee()
        performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        holdOpen()
        retarget()
    }

    fun collapse() {
        main.removeCallbacks(autoClose)
        scrubbing = false
        scrubGrow.target = 0f
        dragging = false
        listScroller.forceFinished(true)
        pressedButton = Target.NONE
        if (!wantOpen) return
        wantOpen = false
        // The shape shrinks straight to the pill from wherever it is; the pages go home once it is closed.
        lyricsFull = false
        closeSearch()
        resetPagesWhenClosed = true
        retarget()
    }

    /** The open island goes back to the now-playing card, with nothing left over from browsing. */
    private fun resetPages() {
        resetPagesWhenClosed = false
        page = Page.NOW
        lyricsFull = false
        ghostPage = null
        ghost.snap(0f)
        pageX.snap(0f)
        lyricsP.snap(0f)
        full.snap(0f)
        playlistScroll = 0f
        downloadScroll = 0f
        lyricScrollPlaced = false
    }

    /**
     * The card stays open while it is used, and closes by itself 8 s after the last touch (20 s while browsing).
     * With lyrics it stays until it is pushed up or tapped outside: lyrics are there to be read along.
     */
    private fun holdOpen() {
        main.removeCallbacks(autoClose)
        if (searchOpen || page == Page.NOW && (lyricsFull || lyricLines.isNotEmpty() && showLyricStrip)) return
        main.postDelayed(autoClose, if (page == Page.NOW) AUTO_CLOSE_MS else BROWSE_CLOSE_MS)
    }

    private fun retarget() {
        open.target = if (wantOpen) 1f else 0f
        wide.target = if (hasSong) 1f else 0f
        shown.target = if (hasSong || showWhenIdle || wantOpen) 1f else 0f
        if (wantOpen) {
            full.target = if (!searchOpen && (lyricsFull || page != Page.NOW)) 1f else 0f
            lyricsP.target = if (lyricsFull) 1f else 0f
            searchP.target = if (searchOpen) 1f else 0f
        } else {
            full.target = 0f
            lyricsP.target = 0f
            searchP.target = 0f
        }
        host.setTouchable(shown.target > 0f)
        host.setExpandedTouch(wantOpen || open.value > 0.001f)
        // Start moving first: a moving island only grows its window, so a closing card is never cut off.
        kickLoop()
        refit()
    }

    private fun setLyricsFull(on: Boolean) {
        lyricsFull = on
        if (on) lyricScrollPlaced = false
        holdOpen()
        retarget()
    }

    /** Slides to [next] (pages next to each other slide; the island grows to full mode away from the card). */
    private fun showPage(next: Page) {
        listScroller.forceFinished(true)
        page = next
        pageX.target = next.at
        holdOpen()
        retarget()
    }

    /** LuvLyrics opens growing out of the island's outline as it is now, while the island folds to its pill. */
    private fun openApp(link: String = PLAYER_LINK) {
        val g = geometry
        val from = if (g == null) null else RectF().also {
            shape(it, open.value, wide.value, shown.value, 1f, lyricsRoom.value, full.value, searchP.value)
            it.offset(width / 2f, 0f)
        }
        host.openApp(link, from)
        collapse()
    }

    // ── Search ──────────────────────────────────────────────────────────────────────────────────────────────

    private fun openSearch() {
        if (searchOpen) return
        searchOpen = true
        lyricsFull = false
        searchUnavailable = IslandLibrary.onSearch == null
        searchResults = if (IslandLibrary.searchQuery == searchText.trim()) IslandLibrary.searchResults else emptyList()
        resultTexts = arrayOfNulls(searchResults.size * 2)
        host.showSearchInput(RectF(fieldBox).apply { offset(width / 2f, 0f) })
        holdOpen()
        retarget()
    }

    private fun closeSearch() {
        if (!searchOpen) return
        searchOpen = false
        main.removeCallbacks(runSearch)
        host.showSearchInput(null)
        holdOpen()
        retarget()
    }

    /** What is typed in the drawer (from the host's text field); looked up a moment after typing stops. */
    fun setSearchText(text: String) {
        if (text == searchText) return
        searchText = text
        main.removeCallbacks(runSearch)
        main.postDelayed(runSearch, SEARCH_DEBOUNCE_MS)
        invalidate()
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
        if (listScroller.computeScrollOffset()) {
            setListScroll(listScroller.currY.toFloat())
            moving = true
        }
        if (resetPagesWhenClosed && !wantOpen && open.atRest) resetPages()
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
        shape(scratch, open.target, wide.target, shown.target, 1f, lyricsRoom.target, full.target, searchP.target)
        var half = scratch.width() / 2f + pad
        var bottom = scratch.bottom + pad
        if (dragging && wantOpen) {
            // A finger on the open card may pull it to full mode: grow once, now, rather than on every move.
            bottom = max(bottom, g.cardTop + g.fullHeight * 1.04f + pad)
        }
        if (looping || dragging) {
            val overshoot = if (open.target > 0.5f) 1.05f else 1.08f
            half = max(fitHalf, max(half * overshoot, currentHalf() + pad))
            shape(scratch, open.value, wide.value, shown.value, currentScale(), lyricsRoom.value, full.value, searchP.value)
            bottom = max(fitBottom, max(bottom * 1.04f, scratch.bottom + pad))
        }
        if (force || abs(half - fitHalf) > 0.5f || abs(bottom - fitBottom) > 0.5f) {
            fitHalf = half
            fitBottom = bottom
            host.fitWindow(half, bottom)
        }
    }

    private fun currentHalf(): Float {
        shape(scratch, open.value, wide.value, shown.value, currentScale(), lyricsRoom.value, full.value, searchP.value)
        return scratch.width() / 2f
    }

    private fun currentScale() = 1f + 0.05f * bump.value - 0.05f * press.value

    /**
     * The island's outline for open [o], width [w] (idle → compact), presence [s], lyrics room [l] and full mode
     * [f] or search drawer [sd], centred on x = 0. [o] may overshoot 1 a little: the card grows a touch past its size
     * and settles back, as a spring does. Every look floats: the pill and the card both start below the top edge.
     */
    private fun shape(out: RectF, o: Float, w: Float, s: Float, scale: Float, l: Float, f: Float, sd: Float) {
        val g = geometry ?: return out.setEmpty()
        val presence = s.coerceIn(0f, 1f)
        val pillW = lerp(g.idleWidth, g.compactWidth, w) * lerp(0.55f, 1f, presence)
        val pillH = g.pillHeight * lerp(0.7f, 1f, presence)
        val pillTop = g.pillTop + (g.pillHeight - pillH) / 2f
        val half = lerp(pillW / 2f, g.cardWidth / 2f, o)
        val top = lerp(pillTop, g.cardTop, o)
        val cardBottom = g.cardTop + g.cardHeight + g.dp(LYRICS_ROOM_DP) * l
        val openBottom = lerp(lerp(cardBottom, g.cardTop + g.fullHeight, f), g.cardTop + g.searchHeight, sd)
        val bottom = lerp(pillTop + pillH, openBottom, o)
        out.set(-half * scale, top, half * scale, bottom)
        if (scale != 1f) out.inset(0f, -(bottom - top) * (scale - 1f) / 2f)
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
        lyricPaint.typeface = IslandFonts.semibold
        fullLyricPaint.typeface = IslandFonts.semibold
        rowTitlePaint.typeface = IslandFonts.semibold
        rowSubPaint.typeface = IslandFonts.regular
        titlePaint.textSize = sp(16f)
        artistPaint.textSize = sp(14f)
        timePaint.textSize = sp(11.5f)
        fullLyricPaint.textSize = sp(FULL_LYRIC_SP)
        rowTitlePaint.textSize = sp(15f)
        rowSubPaint.textSize = sp(12.5f)
    }

    private fun layoutContent() {
        val g = geometry ?: return
        val pad = g.dp(IslandGeometry.CARD_PADDING_DP)
        val cardLeft = -g.cardWidth / 2f
        val cardRight = g.cardWidth / 2f
        val cardBottom = g.cardTop + g.fullHeight
        coverBox.set(cardLeft + pad, g.contentTop, cardLeft + pad + g.dp(56f), g.contentTop + g.dp(56f))
        badgeBox.set(cardRight - pad - g.dp(20f), g.contentTop + g.dp(2f), cardRight - pad, g.contentTop + g.dp(22f))
        textX = coverBox.right + g.dp(12f)
        textWidth = max(0f, badgeBox.left - g.dp(8f) - textX)
        titleY = g.contentTop + g.dp(24f)
        artistY = g.contentTop + g.dp(45f)
        openBox.set(coverBox.left, coverBox.top, badgeBox.right, coverBox.bottom)
        progressY = coverBox.bottom + g.dp(16f) + g.dp(10f)
        fullProgressY = cardBottom - pad - g.dp(8f)
        barLeft = cardLeft + pad + g.dp(38f)
        barRight = cardRight - pad - g.dp(42f)
        controlsY = progressY + g.dp(20f) + g.dp(26f)
        sideButtonX = min(g.dp(72f), g.cardWidth / 2f - pad - g.dp(22f))
        sideRadius = g.dp(21f)
        playRadius = g.dp(26f)
        val label = OPEN_LABEL
        val labelWidth = titlePaint.measureText(label) * 0.9f
        openButton.set(-labelWidth / 2f - g.dp(22f), controlsY - g.dp(22f), labelWidth / 2f + g.dp(22f), controlsY + g.dp(22f))
        lyricsTop = coverBox.bottom + g.dp(10f)
        lyricsBottom = fullProgressY - g.dp(22f)
        backBox.set(cardLeft + pad, g.contentTop, cardLeft + pad + g.dp(30f), g.contentTop + g.dp(30f))
        backRightBox.set(cardRight - pad - g.dp(30f), g.contentTop, cardRight - pad, g.contentTop + g.dp(30f))
        listTop = g.contentTop + g.dp(HEADER_DP)
        listBottom = cardBottom - g.dp(6f)
        fieldBox.set(cardLeft + pad, g.contentTop, cardRight - pad, g.contentTop + g.dp(40f))
        bestBox.set(cardLeft + pad, fieldBox.bottom + g.dp(14f), cardRight - pad, fieldBox.bottom + g.dp(14f + 72f))
        bestPlay.set(bestBox.right - g.dp(66f), bestBox.centerY() - g.dp(17f), bestBox.right, bestBox.centerY() + g.dp(17f))
        resultsTop = bestBox.bottom + g.dp(10f)

        // Fades, built once for where things rest: titles melt into the card at their edges, lists and lyrics at
        // the top and bottom of their area.
        val fadeW = g.dp(14f)
        textFadeLeft = LinearGradient(textX, 0f, textX + fadeW, 0f, Color.BLACK, Color.TRANSPARENT, Shader.TileMode.CLAMP)
        textFadeRight = LinearGradient(textX + textWidth - fadeW, 0f, textX + textWidth, 0f, Color.TRANSPARENT, Color.BLACK, Shader.TileMode.CLAMP)
        val fadeH = g.dp(28f)
        lyricFadeTop = LinearGradient(0f, lyricsTop, 0f, lyricsTop + fadeH, Color.BLACK, Color.TRANSPARENT, Shader.TileMode.CLAMP)
        lyricFadeBottom = LinearGradient(0f, lyricsBottom - fadeH, 0f, lyricsBottom, Color.TRANSPARENT, Color.BLACK, Shader.TileMode.CLAMP)
        val listFade = g.dp(16f)
        listFadeTop = LinearGradient(0f, listTop, 0f, listTop + listFade, Color.BLACK, Color.TRANSPARENT, Shader.TileMode.CLAMP)
        listFadeBottom = LinearGradient(0f, listBottom - listFade, 0f, listBottom, Color.TRANSPARENT, Color.BLACK, Shader.TileMode.CLAMP)
        lyricFits.clear()
        lyricLayouts = emptyList()
        clearRowTexts()
        layoutText()
    }

    private fun layoutText() {
        titleShown = if (hasSong) title.ifEmpty { "Unknown song" } else "LuvLyrics"
        artistShown = if (hasSong) artist else "Nothing playing"
        titleWidth = titlePaint.measureText(titleShown)
        artistWidth = artistPaint.measureText(artistShown)
    }

    // ── Drawing ─────────────────────────────────────────────────────────────────────────────────────────────

    override fun onDraw(canvas: Canvas) {
        val g = geometry ?: return
        val presence = shown.value.coerceIn(0f, 1f)
        if (presence <= 0.003f) return
        val cx = width / 2f
        val o = open.value
        val oc = o.coerceIn(0f, 1f)

        shape(shapeRect, o, wide.value, presence, currentScale(), lyricsRoom.value, full.value, searchP.value)
        shapeRect.offset(cx, 0f)
        val radius = min(lerp(shapeRect.height() / 2f, g.cardRadius, oc), shapeRect.height() / 2f)
        shapePath.reset()
        shapePath.addRoundRect(shapeRect, radius, radius, Path.Direction.CW)

        fill.shader = null
        fill.color = Color.BLACK
        fill.alpha = (255 * presence).toInt()
        canvas.drawPath(shapePath, fill)
        val cardVisible = oc > 0.01f
        if (cardVisible) {
            updateGradient(g)
            gradientPaint.alpha = (255 * oc * presence).toInt()
            canvas.drawPath(shapePath, gradientPaint)
            drawGlow(canvas, oc * presence)
            veilPaint.alpha = (255 * oc * presence).toInt()
            canvas.drawPath(shapePath, veilPaint)
        }

        canvas.save()
        clipPath.set(shapePath)
        canvas.clipPath(clipPath)
        val compactAlpha = (1f - oc / 0.35f).coerceIn(0f, 1f) * wide.value.coerceIn(0f, 1f) * presence
        // Opening or closing on the card: the pill's cover and the card's cover are one picture that grows and
        // shrinks between the two places, rather than one fading out while the other fades in.
        coverMorphing = hasSong && oc > 0.001f && oc < 0.999f && abs(pageX.value) < 0.01f && ghostPage == null &&
            searchP.value < 0.01f && wide.value > 0.99f
        if (compactAlpha > 0.01f) drawCompact(canvas, g, shapeRect, compactAlpha)
        val cardAlpha = ((oc - 0.45f) / 0.55f).coerceIn(0f, 1f) * presence
        if (cardAlpha > 0.01f) drawCard(canvas, g, cx, cardAlpha)
        if (coverMorphing) {
            compactCover(g, shapeRect, scratch)
            morphRect.set(coverBox)
            morphRect.offset(cx, 0f)
            val e = o.coerceIn(0f, 1.05f)
            flyRect.set(lerp(scratch.left, morphRect.left, e), lerp(scratch.top, morphRect.top, e),
                lerp(scratch.right, morphRect.right, e), lerp(scratch.bottom, morphRect.bottom, e))
            drawImage(canvas, flyRect, lerp(scratch.width() / 2f, g.dp(12f), oc), presence)
        }
        canvas.restore()

        scheduleTicks(compactAlpha, cardAlpha)
    }

    private fun updateGradient(g: IslandGeometry) {
        val c = blendedColors()
        // Built for the tallest the island gets (full mode), so no shader is allocated on a frame of the motion.
        val key = (c.top.toLong() shl 32) xor (g.fullHeight.toBits().toLong() shl 12) xor width.toLong()
        if (key == gradientFor) return
        gradientFor = key
        gradientPaint.shader = LinearGradient(
            0f, g.cardTop, 0f, g.cardTop + g.cardHeight,
            intArrayOf(Color.BLACK, c.top, Color.rgb(4, 4, 9)),
            floatArrayOf(0f, 0.40f, 1f),
            Shader.TileMode.CLAMP,
        )
        // The camera, the title and the controls stay in a dark room; the light pools along the bottom and melts
        // upward into it. Built one unit tall and stretched to the island's height each frame (drawGlow), so the
        // pool stays at the bottom edge however tall the island is, without a shader per frame.
        veilPaint.shader = LinearGradient(
            0f, 0f, 0f, 1f,
            intArrayOf(Color.argb(240, 0, 0, 0), Color.argb(200, 0, 0, 0), Color.argb(90, 0, 0, 0), Color.TRANSPARENT),
            floatArrayOf(0f, 0.38f, 0.66f, 0.9f),
            Shader.TileMode.CLAMP,
        )
    }

    /**
     * The light behind the open island: the song's cover, blurred into pure colour (IslandGlow), drawn in a few
     * large layers that turn slowly against each other along the bottom, as Apple Music's backdrop flows. Shaders
     * are built once per song and moved by their local matrix, so a frame allocates nothing. The clock runs only
     * while music plays and eases to a stop on pause (blobSpeed), so a paused song's light holds still.
     */
    private fun drawGlow(canvas: Canvas, alpha: Float) {
        val now = SystemClock.uptimeMillis()
        if (blobLastMs != 0L && screenOn) blobClock += ((now - blobLastMs) / 1000f).coerceAtMost(0.1f) * blobSpeed.value
        blobLastMs = now
        val current = glow ?: neutralGlow ?: shadersFor(IslandGlow.fromColors(IslandColors.NEUTRAL)).also { neutralGlow = it }
        val m = colorMix.value.coerceIn(0f, 1f)
        val previous = oldGlow
        if (previous != null && m < 0.999f) drawGlowLayers(canvas, oldGlowPaints, previous, alpha * (1f - m))
        drawGlowLayers(canvas, glowPaints, current, if (previous != null) alpha * m else alpha)
        if (m >= 0.999f) oldGlow = null
        // The dark room over it, stretched to the island's height: the light pools at the bottom and melts upward.
        matrix.setScale(1f, shapeRect.height())
        matrix.postTranslate(0f, shapeRect.top)
        veilPaint.shader?.setLocalMatrix(matrix)
    }

    private fun drawGlowLayers(canvas: Canvas, paints: Array<Paint>, shaders: Array<BitmapShader>, alpha: Float) {
        if (alpha <= 0.004f) return
        val w = shapeRect.width()
        val h = shapeRect.height()
        val depth = max(w * 0.7f, h * 0.4f)
        val poolTop = shapeRect.top + h - depth
        val half = IslandGlow.SIZE / 2f
        for (i in paints.indices) {
            val layer = IslandMotion.LAYERS[i]
            IslandMotion.layerAt(layer, blobClock, layerState)
            val scale = layerState[1] * w / IslandGlow.SIZE
            matrix.setTranslate(-half, -half)
            matrix.postScale(scale, scale)
            matrix.postRotate(layerState[0])
            matrix.postTranslate(shapeRect.left + layer.x * w, poolTop + layer.y * depth)
            val shader = shaders[i]
            if (paints[i].shader !== shader) paints[i].shader = shader
            shader.setLocalMatrix(matrix)
            paints[i].alpha = (255 * alpha * layer.alpha * GLOW_STRENGTH).toInt()
            canvas.drawPath(shapePath, paints[i])
        }
    }

    /** Where the pill's round cover sits, for an outline [pill]. */
    private fun compactCover(g: IslandGeometry, pill: RectF, out: RectF) {
        val size = max(g.dp(16f), g.pillHeight - g.dp(10f))
        val inset = (g.pillHeight - size) / 2f
        val cy = if (pill.height() > g.pillHeight * 1.5f) pill.top + g.pillHeight / 2f else pill.centerY()
        out.set(pill.left + inset + g.dp(2f), cy - size / 2f, pill.left + inset + g.dp(2f) + size, cy + size / 2f)
    }

    /** The pill with a song: the cover on the left, level bars on the right, the camera between them. */
    private fun drawCompact(canvas: Canvas, g: IslandGeometry, pill: RectF, alpha: Float) {
        val size = max(g.dp(16f), g.pillHeight - g.dp(10f))
        val inset = (g.pillHeight - size) / 2f
        val cy = pill.centerY()
        if (!coverMorphing) {
            compactCover(g, pill, scratch)
            drawImage(canvas, scratch, size / 2f, alpha)
        }

        val right = pill.right - inset - g.dp(4f)
        drawBars(canvas, right, cy, size * 0.78f, g.dp(3f), g.dp(2.6f), blendedColors().accent, alpha, playing && screenOn)
    }

    /** Four level bars ending at [right], dancing while [live]. */
    private fun drawBars(canvas: Canvas, right: Float, cy: Float, maxH: Float, barWidth: Float, gap: Float, color: Int,
                         alpha: Float, live: Boolean) {
        val bars = 4
        val left = right - bars * barWidth - (bars - 1) * gap
        val t = SystemClock.uptimeMillis() / 1000f
        fill.shader = null
        fill.color = color
        fill.alpha = (255 * alpha).toInt()
        for (i in 0 until bars) {
            val level = if (live) {
                0.32f + 0.68f * abs(sin(t * BAR_SPEED[i] + BAR_PHASE[i]) * 0.65f + sin(t * BAR_SPEED[i] * 0.53f + i) * 0.35f)
            } else {
                0.22f
            }
            val h = max(barWidth, maxH * level)
            val x = left + i * (barWidth + gap)
            canvas.drawRoundRect(x, cy - h / 2f, x + barWidth, cy + h / 2f, barWidth / 2f, barWidth / 2f, fill)
        }
    }

    /**
     * The open island, drawn where it rests and revealed by the growing outline (the canvas is clipped to it).
     * Each page slides in from the side by how far [pageX] is from it; a page folded away (a picked song) fades
     * and settles as the card it becomes fades in.
     */
    private fun drawCard(canvas: Canvas, g: IslandGeometry, cx: Float, alpha: Float) {
        canvas.save()
        val settle = 1f - alpha
        canvas.translate(cx, -g.dp(8f) * settle)
        val s = lerp(0.94f, 1f, alpha)
        canvas.scale(s, s, 0f, g.cardTop)

        val ghostAlpha = if (ghostPage != null) ghost.value.coerceIn(0f, 1f) else 0f
        // A picked song: the list it came from goes first, then the card comes in, so the two never sit on each other.
        val arriving = (1f - ghostAlpha / 0.55f).coerceIn(0f, 1f)
        val sp = searchP.value.coerceIn(0f, 1f)
        val pagesAlpha = alpha * (1f - sp / 0.4f).coerceIn(0f, 1f)
        for (p in Page.entries) {
            val d = pageX.value - p.at
            if (abs(d) >= 1f) continue
            val a = pagesAlpha * (1f - abs(d)) * arriving
            if (a <= 0.01f) continue
            canvas.save()
            canvas.translate(-d * g.cardWidth, 0f)
            drawPage(canvas, g, p, a)
            canvas.restore()
        }
        val leaving = ghostPage
        val leavingAlpha = ((ghostAlpha - 0.35f) / 0.65f).coerceIn(0f, 1f)
        if (leaving != null && leavingAlpha > 0.01f) {
            canvas.save()
            val gs = lerp(0.92f, 1f, leavingAlpha)
            canvas.scale(gs, gs, 0f, g.contentTop)
            drawingGhost = true
            drawPage(canvas, g, leaving, alpha * leavingAlpha)
            drawingGhost = false
            canvas.restore()
        } else if (leaving != null && ghost.atRest) {
            ghostPage = null
        }
        if (sp > 0.01f) drawSearch(canvas, g, alpha, sp)
        val f = flyer
        if (f != null && fly.value < 0.999f) drawFlyer(canvas, g, f, alpha)
        canvas.restore()
    }

    /** The picked row's cover, title and artist on their way into the card's places. */
    private fun drawFlyer(canvas: Canvas, g: IslandGeometry, f: Flyer, alpha: Float) {
        val e = fly.value.coerceIn(0f, 1.05f)
        flyRect.set(lerp(f.from.left, coverBox.left, e), lerp(f.from.top, coverBox.top, e),
            lerp(f.from.right, coverBox.right, e), lerp(f.from.bottom, coverBox.bottom, e))
        drawThumb(canvas, f.thumb, flyRect, lerp(f.fromCorner, g.dp(12f), e.coerceAtMost(1f)), alpha, f.title)
        val x = lerp(f.titleX, textX, e)
        val titleSize = titlePaint.textSize
        val artistSize = artistPaint.textSize
        titlePaint.textSize = lerp(f.titleSize, titleSize, e.coerceAtMost(1f))
        titlePaint.alpha = (255 * alpha).toInt()
        canvas.drawText(f.title, x, lerp(f.titleY, titleY, e), titlePaint)
        artistPaint.textSize = lerp(f.artistSize, artistSize, e.coerceAtMost(1f))
        artistPaint.alpha = (255 * alpha * lerp(0.55f, 0.62f, e.coerceAtMost(1f))).toInt()
        canvas.drawText(f.artist, x, lerp(f.artistY, artistY, e), artistPaint)
        titlePaint.textSize = titleSize
        artistPaint.textSize = artistSize
    }

    /** True while the card should still show the picked song itself: the player has not started it, or its cover is not in. */
    private fun flyerPending(f: Flyer): Boolean =
        SystemClock.uptimeMillis() - f.startedMs < FLY_HOLD_MS &&
            (player?.currentMediaItem?.mediaId != f.songId || (cover == null && f.thumb != null))

    /**
     * Lifts a picked row out of its list: its cover, title and artist (at [from], its texts' places) will fly into
     * the card while the list folds away.
     */
    private fun startFlyer(g: IslandGeometry, song: IslandLibrary.Song, from: RectF, corner: Float, titleX: Float,
                           titleY: Float, artistY: Float, titleSize: Float, artistSize: Float, rowPage: Page?, rowIndex: Int) {
        flyer = Flyer(song.id, thumbs.get(song.cover), RectF(from), corner,
            fitText(song.title, titlePaint, textWidth), fitText(song.artist, artistPaint, textWidth),
            titleX, titleY, artistY, titleSize, artistSize, SystemClock.uptimeMillis())
        flyRowPage = rowPage
        flyRowIndex = rowIndex
        fly.snap(0f)
        fly.target = 1f
        marqueeClock = -FLY_HOLD_MS / 1000f
        kickLoop()
    }

    private fun drawPage(canvas: Canvas, g: IslandGeometry, p: Page, alpha: Float) {
        when (p) {
            Page.DOWNLOADS -> drawDownloads(canvas, g, alpha)
            Page.NOW -> drawNowPlaying(canvas, g, alpha)
            Page.PLAYLISTS -> drawPlaylists(canvas, g, alpha)
            Page.SONGS -> drawSongs(canvas, g, alpha)
        }
    }

    /** The now-playing card; pulled down, it turns into the song's lyrics with the scrubber along the bottom. */
    private fun drawNowPlaying(canvas: Canvas, g: IslandGeometry, alpha: Float) {
        val f = flyer
        if (f != null && fly.atRest && !flyerPending(f)) {
            flyer = null
            flyRowIndex = -1
            resetMarquee()
        }
        val picked = flyer
        if (picked != null) {
            // The picked song, in flight or landed and waiting for the player: drawn here by drawFlyer, or in place.
            if (fly.value >= 0.999f) {
                drawThumb(canvas, picked.thumb, coverBox, g.dp(12f), alpha, picked.title)
                titlePaint.alpha = (255 * alpha).toInt()
                canvas.drawText(picked.title, textX, titleY, titlePaint)
                artistPaint.alpha = (255 * alpha * 0.62f).toInt()
                canvas.drawText(picked.artist, textX, artistY, artistPaint)
            }
        } else if (!coverMorphing) {
            drawImage(canvas, coverBox, g.dp(12f), alpha, useAppIcon = !hasSong)
        }
        // LuvLyrics' mark where Spotify puts its own.
        if (hasSong) {
            imagePaint.shader = appIconShader
            fitShader(appIcon, badgeBox)
            imagePaint.alpha = (255 * alpha * 0.92f).toInt()
            canvas.drawRoundRect(badgeBox, badgeBox.width() / 2f, badgeBox.width() / 2f, imagePaint)
        }

        val now = SystemClock.uptimeMillis()
        if (playing && screenOn && marqueeLastMs != 0L) marqueeClock += ((now - marqueeLastMs) / 1000f).coerceAtMost(0.1f)
        marqueeLastMs = now
        if (picked == null) {
            drawMarquee(canvas, g, titleShown, titleWidth, titlePaint, titleY,
                shownMarquee(marqueeClock, titleWidth, g, titleFrom, titleTo), alpha)
            drawMarquee(canvas, g, artistShown, artistWidth, artistPaint, artistY,
                shownMarquee(marqueeClock, artistWidth, g, artistFrom, artistTo), alpha * 0.62f)
        }

        if (!hasSong) {
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
            return
        }

        syncLyricIndex()
        val lp = lyricsP.value.coerceIn(0f, 1f)
        drawProgress(canvas, g, alpha, lerp(progressY, fullProgressY, lp))
        // The controls sink away under the lyrics; the scrubber travels to the bottom edge (above).
        val controlsAlpha = alpha * (1f - lp / 0.42f).coerceIn(0f, 1f)
        if (controlsAlpha > 0.01f) {
            canvas.save()
            canvas.translate(0f, g.dp(56f) * lp)
            val s = lerp(1f, 0.86f, lp)
            canvas.scale(s, s, 0f, controlsY)
            drawButton(canvas, -sideButtonX, sideRadius, IslandIcons.previous, g.dp(21f), controlsAlpha, Target.PREVIOUS)
            drawButton(canvas, 0f, playRadius, if (playing) IslandIcons.pause else IslandIcons.play, g.dp(25f), controlsAlpha, Target.PLAY)
            drawButton(canvas, sideButtonX, sideRadius, IslandIcons.next, g.dp(21f), controlsAlpha, Target.NEXT)
            canvas.restore()
        }
        val room = lyricsRoom.value.coerceIn(0f, 1f)
        when {
            lyricLines.isEmpty() -> lyricScrollPlaced = false
            lp <= 0.001f -> {
                // Hidden lyrics forget their place, so they open on the sung line instead of gliding from an old one.
                lyricScrollPlaced = false
                if (room > 0.01f) drawLyricStrip(canvas, g, alpha * room)
            }
            else -> drawFullLyrics(canvas, g, alpha, lp)
        }
    }

    /**
     * A title (or artist) in its room: drawn whole when it fits; otherwise it rests with its start showing, slides
     * right to left by one loop at the app's marquee pace and rests again, its edges melting into the card.
     */
    private fun drawMarquee(canvas: Canvas, g: IslandGeometry, text: String, textW: Float, paint: TextPaint, baseline: Float,
                            offset: Float, alpha: Float) {
        paint.alpha = (255 * alpha).toInt()
        if (textW <= textWidth + 1f) {
            canvas.drawText(text, textX, baseline, paint)
            return
        }
        val top = baseline - paint.textSize * 1.1f
        val bottom = baseline + paint.textSize * 0.4f
        canvas.saveLayer(textX, top, textX + textWidth, bottom, null)
        canvas.drawText(text, textX - offset, baseline, paint)
        canvas.drawText(text, textX - offset + textW + g.dp(IslandMotion.MARQUEE_GAP_DP), baseline, paint)
        // The left edge melts only while the text is away from its start (a copy landed home shows its start plainly).
        if (offset > 0.5f && offset < IslandMotion.marqueeDistance(textW, g.density) - 0.5f) {
            fadePaint.shader = textFadeLeft
            canvas.drawRect(textX, top, textX + g.dp(14f), bottom, fadePaint)
        }
        fadePaint.shader = textFadeRight
        canvas.drawRect(textX + textWidth - g.dp(14f), top, textX + textWidth, bottom, fadePaint)
        canvas.restore()
    }

    /**
     * Elapsed time, a thick round line and the time left. No knob: the line swells under the finger and the fill
     * brightens (the app's slider), then settles back to a line when the finger lifts.
     */
    private fun drawProgress(canvas: Canvas, g: IslandGeometry, alpha: Float, y: Float) {
        val p = player
        val duration = p?.duration?.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0L
        val position = if (scrubbing) scrubMs else (p?.currentPosition ?: 0L).coerceIn(0L, max(duration, 0L))
        val fraction = if (duration > 0) position.toFloat() / duration else 0f
        val grow = scrubGrow.value.coerceIn(0f, 1.2f)

        timePaint.alpha = (255 * alpha * lerp(0.62f, 0.95f, grow.coerceAtMost(1f))).toInt()
        val baseline = y + timePaint.textSize * 0.36f
        val pad = g.dp(IslandGeometry.CARD_PADDING_DP)
        canvas.drawText(islandClock(position), -g.cardWidth / 2f + pad, baseline, timePaint)
        val remaining = if (duration > 0) islandClock(duration - position, remaining = true) else "--:--"
        canvas.drawText(remaining, g.cardWidth / 2f - pad - timePaint.measureText(remaining), baseline, timePaint)

        val track = g.dp(TRACK_DP) * lerp(1f, TRACK_GROW, grow)
        fill.shader = null
        fill.color = Color.WHITE
        fill.alpha = (255 * alpha * 0.22f).toInt()
        canvas.drawRoundRect(barLeft, y - track / 2f, barRight, y + track / 2f, track / 2f, track / 2f, fill)
        val x = barLeft + (barRight - barLeft) * fraction
        if (x > barLeft) {
            canvas.save()
            trackPath.reset()
            trackPath.addRoundRect(barLeft, y - track / 2f, barRight, y + track / 2f, track / 2f, track / 2f, Path.Direction.CW)
            canvas.clipPath(trackPath)
            fill.alpha = (255 * alpha * lerp(0.78f, 1f, grow.coerceAtMost(1f))).toInt()
            canvas.drawRect(barLeft, y - track / 2f, x, y + track / 2f, fill)
            canvas.restore()
        }
    }

    private fun syncLyricIndex() {
        val lines = lyricLines
        if (lines.isEmpty()) return
        val position = if (scrubbing) scrubMs else player?.currentPosition ?: 0L
        val index = IslandLyrics.lineAt(lines, position)
        if (index == lyricIndex) return
        lyricFrom = lyricIndex
        lyricIndex = index
        if (index == lyricFrom + 1) {
            lineMove.snap(1f)
            lineMove.target = 0f
        } else {
            lineMove.snap(0f)
        }
        kickLoop()
    }

    /**
     * The sung line and the next one, under the controls. Every line has the same weight; the sung one is
     * only brighter. When the next line starts, both glide up together on one spring (lineMove 1 → 0) and
     * the line before fades out above them; a seek elsewhere just shows the new lines.
     */
    private fun drawLyricStrip(canvas: Canvas, g: IslandGeometry, alpha: Float) {
        if (lyricLines.isEmpty()) return
        val index = lyricIndex
        val pad = g.dp(IslandGeometry.CARD_PADDING_DP)
        val maxWidth = g.cardWidth - pad * 2f
        val top = controlsY + playRadius + g.dp(LYRICS_GAP_DP)
        val gap = g.dp(LYRICS_LINE_DP)
        val baseline = top + gap * 0.66f
        val k = lineMove.value.coerceIn(0f, 1f)
        canvas.save()
        canvas.clipRect(-g.cardWidth / 2f, top, g.cardWidth / 2f, g.cardTop + g.cardHeight + g.dp(LYRICS_ROOM_DP))
        if (k > 0.01f) drawLyricLine(canvas, lyricFrom, baseline - gap * (1f - k), alpha * k, maxWidth)
        drawLyricLine(canvas, index, baseline + gap * k, alpha * lerp(1f, NEXT_LINE_ALPHA, k), maxWidth)
        drawLyricLine(canvas, index + 1, baseline + gap * (1f + k), alpha * NEXT_LINE_ALPHA, maxWidth)
        canvas.restore()
    }

    /** Line [at], centred: a long one shrinks a little to fit, then trails off. Fitted once, then reused. */
    private fun drawLyricLine(canvas: Canvas, at: Int, baseline: Float, alpha: Float, maxWidth: Float) {
        if (alpha <= 0.01f) return
        val line = lyricLines.getOrNull(at) ?: return
        val fit = lyricFits.getOrPut(at) {
            val size = sp(LYRIC_SP)
            lyricPaint.textSize = size
            val width = lyricPaint.measureText(line.text)
            val fitted = if (width > maxWidth) max(size * 0.82f, size * maxWidth / width) else size
            lyricPaint.textSize = fitted
            val shown = fitText(line.text, lyricPaint, maxWidth)
            LyricFit(shown, fitted, lyricPaint.measureText(shown))
        }
        lyricPaint.textSize = fit.size
        lyricPaint.alpha = (255 * alpha).toInt()
        canvas.drawText(fit.text, -fit.width / 2f, baseline, lyricPaint)
    }

    /** Lays every line out once for the card's width: the full lyrics list never measures on a frame. */
    private fun ensureLyricLayouts(g: IslandGeometry) {
        if (lyricLayouts.isNotEmpty() || lyricLines.isEmpty()) return
        val pad = g.dp(IslandGeometry.CARD_PADDING_DP)
        val width = (g.cardWidth - pad * 2f).toInt().coerceAtLeast(1)
        val gap = g.dp(FULL_LYRIC_GAP_DP)
        val tops = FloatArray(lyricLines.size)
        var y = 0f
        lyricLayouts = lyricLines.mapIndexed { i, line ->
            val layout = StaticLayout.Builder.obtain(line.text, 0, line.text.length, fullLyricPaint, width)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                .setIncludePad(false)
                .setLineSpacing(0f, 1.04f)
                .build()
            tops[i] = y
            y += layout.height + gap
            layout
        }
        lyricTops = tops
    }

    /**
     * Every line of the song, as the app's lyrics: the same bold weight for all, the sung one bright and the rest
     * dim, the list gliding so the sung line sits a third of the way down. A tap on a line plays from it.
     *
     * [lp] below 1 is the way there from the card: the sung line and the next one are the strip's two lines, so
     * each one moves and grows from its place in the strip (centred, smaller) to its place in the list, and only the
     * lines the strip did not show come in around them.
     */
    private fun drawFullLyrics(canvas: Canvas, g: IslandGeometry, alpha: Float, lp: Float) {
        val left = -g.cardWidth / 2f + g.dp(IslandGeometry.CARD_PADDING_DP)
        if (lyricLines.isEmpty()) return
        ensureLyricLayouts(g)
        val area = lyricsBottom - lyricsTop
        val target = if (lyricIndex >= 0) lyricTops[lyricIndex] - area * SUNG_LINE_AT else 0f
        if (!lyricScrollPlaced) {
            lyricScroll.snap(target)
            lyricScrollPlaced = true
        } else if (lyricScroll.target != target) {
            lyricScroll.target = target
            kickLoop()
        }
        val scroll = lyricScroll.value
        val k = lineMove.value.coerceIn(0f, 1f)
        val e = lp.coerceIn(0f, 1f)
        val morphing = e < 0.999f
        // Lines never cross the cover and title; while it morphs, the strip's two lines come up from under the controls.
        val areaTop = lyricsTop
        val areaBottom = if (morphing) max(lyricsBottom, g.cardTop + g.cardHeight + g.dp(LYRICS_ROOM_DP)) else lyricsBottom
        // The strip's places: the sung line's baseline under the controls, the next one a line below.
        val stripBaseline = controlsY + playRadius + g.dp(LYRICS_GAP_DP) + g.dp(LYRICS_LINE_DP) * (0.66f + k)
        val stripScale = sp(LYRIC_SP) / fullLyricPaint.textSize
        canvas.saveLayer(-g.cardWidth / 2f, areaTop, g.cardWidth / 2f, areaBottom, null)
        for (i in lyricLayouts.indices) {
            val layout = lyricLayouts[i]
            val listY = lyricsTop + lyricTops[i] - scroll
            val inStrip = morphing && lyricIndex >= 0 && lyricsRoom.value > 0.5f && (i == lyricIndex || i == lyricIndex + 1)
            var y = listY
            var x = left
            var scale = 1f
            if (inStrip) {
                val fromBaseline = stripBaseline + (i - lyricIndex) * g.dp(LYRICS_LINE_DP)
                val fromScale = stripScale
                val lineW = min(layout.getLineWidth(0), layout.width.toFloat()) * fromScale
                val fromX = -lineW / 2f
                val fromY = fromBaseline - layout.getLineBaseline(0) * fromScale
                y = lerp(fromY, listY, e)
                x = lerp(fromX, left, e)
                scale = lerp(fromScale, 1f, e)
            }
            if (y + layout.height < areaTop || y > areaBottom) continue
            val bright = when (i) {
                lyricIndex -> lerp(1f, FULL_DIM_ALPHA, k)
                lyricFrom -> lerp(FULL_DIM_ALPHA, 1f, k)
                lyricIndex + 1 -> if (inStrip) lerp(NEXT_LINE_ALPHA, FULL_DIM_ALPHA, e) else FULL_DIM_ALPHA
                else -> FULL_DIM_ALPHA
            }
            // Lines the strip did not show arrive with the list; the strip's own two never blink.
            val arrive = if (inStrip) 1f else ((e - 0.42f) / 0.58f).coerceIn(0f, 1f)
            fullLyricPaint.alpha = (255 * alpha * bright * arrive).toInt()
            if (fullLyricPaint.alpha == 0) continue
            canvas.save()
            canvas.translate(x, y)
            if (scale != 1f) canvas.scale(scale, scale)
            layout.draw(canvas)
            canvas.restore()
        }
        val fadeH = g.dp(28f)
        fadePaint.alpha = (255 * e).toInt()
        fadePaint.shader = lyricFadeTop
        canvas.drawRect(-g.cardWidth / 2f, lyricsTop, g.cardWidth / 2f, lyricsTop + fadeH, fadePaint)
        fadePaint.shader = lyricFadeBottom
        canvas.drawRect(-g.cardWidth / 2f, lyricsBottom - fadeH, g.cardWidth / 2f, lyricsBottom, fadePaint)
        fadePaint.alpha = 255
        canvas.restore()
    }

    // ── Playlists ───────────────────────────────────────────────────────────────────────────────────────────

    private fun rowHeight(p: Page, g: IslandGeometry) = g.dp(if (p == Page.PLAYLISTS) PLAYLIST_ROW_DP else SONG_ROW_DP)

    private fun rowCount(p: Page) = when (p) {
        Page.PLAYLISTS -> playlists.size
        Page.SONGS -> songsOf?.songs?.size ?: 0
        Page.DOWNLOADS -> downloads.size
        Page.NOW -> 0
    }

    private fun maxScroll(p: Page): Float {
        val g = geometry ?: return 0f
        return max(0f, rowCount(p) * rowHeight(p, g) + g.dp(8f) - (listBottom - listTop))
    }

    private fun setListScroll(value: Float) {
        when {
            searchOpen -> searchScroll = value
            page == Page.SONGS -> songScroll = value
            page == Page.DOWNLOADS -> downloadScroll = value
            else -> playlistScroll = value
        }
    }

    private fun listScroll() = when {
        searchOpen -> searchScroll
        page == Page.SONGS -> songScroll
        page == Page.DOWNLOADS -> downloadScroll
        else -> playlistScroll
    }

    private fun maxListScroll(): Float {
        val g = geometry ?: return 0f
        if (!searchOpen) return maxScroll(page)
        val rows = max(0, searchResults.size - 1)
        return max(0f, rows * g.dp(SONG_ROW_DP) + g.dp(8f) - (g.cardTop + g.searchHeight - g.dp(6f) - resultsTop))
    }

    private fun clearRowTexts() {
        playlistTexts = arrayOfNulls(playlists.size * 2)
        downloadTexts = arrayOfNulls(downloads.size * 2)
        resultTexts = arrayOfNulls(searchResults.size * 2)
        songTexts = arrayOfNulls(0)
        songTextsFor = null
        headerNames.fill(null)
    }

    private fun songsLabel(count: Int) = if (count == 1) "1 song" else "$count songs"

    /** A header: a round back button, the page's name and a quiet count on the right. */
    /**
     * A header: a round back button toward the card (on the left, or on the right for the downloads, which sit left
     * of the card), the page's name and a quiet count.
     */
    private fun drawHeader(canvas: Canvas, g: IslandGeometry, p: Page, name: String, count: String, alpha: Float) {
        val onRight = p == Page.DOWNLOADS
        val box = if (onRight) backRightBox else backBox
        val pressed = pressedButton == Target.BACK
        fill.shader = null
        fill.color = Color.WHITE
        fill.alpha = (255 * alpha * if (pressed) 0.26f else 0.13f).toInt()
        canvas.drawCircle(box.centerX(), box.centerY(), box.width() / 2f, fill)
        chevron.reset()
        val dir = if (onRight) -1f else 1f
        val cxb = box.centerX() - g.dp(1.5f) * dir
        val cyb = box.centerY()
        chevron.moveTo(cxb + g.dp(3f) * dir, cyb - g.dp(6f))
        chevron.lineTo(cxb - g.dp(3f) * dir, cyb)
        chevron.lineTo(cxb + g.dp(3f) * dir, cyb + g.dp(6f))
        strokePaint.strokeWidth = g.dp(2.2f)
        strokePaint.alpha = (255 * alpha).toInt()
        canvas.drawPath(chevron, strokePaint)

        val pad = g.dp(IslandGeometry.CARD_PADDING_DP)
        val left = if (onRight) -g.cardWidth / 2f + pad else box.right + g.dp(10f)
        val right = if (onRight) box.left - g.dp(10f) else g.cardWidth / 2f - pad
        rowSubPaint.alpha = (255 * alpha * 0.55f).toInt()
        val countW = rowSubPaint.measureText(count)
        val baseline = box.centerY() + titlePaint.textSize * 0.35f
        canvas.drawText(count, right - countW, baseline, rowSubPaint)
        val room = right - countW - g.dp(10f) - left
        val shown = headerNames[p.ordinal] ?: fitText(name, titlePaint, room).also { headerNames[p.ordinal] = it }
        titlePaint.alpha = (255 * alpha).toInt()
        canvas.drawText(shown, left, baseline, titlePaint)
    }

    /** [text] cut to [room] with an ellipsis, measured with [paint]; the whole text when it fits. */
    private fun fitText(text: String, paint: TextPaint, room: Float): String {
        if (room <= 0f) return ""
        if (paint.measureText(text) <= room) return text
        val n = paint.breakText(text, true, room - paint.measureText(ELLIPSIS), null)
        return text.substring(0, n.coerceIn(0, text.length)).trimEnd() + ELLIPSIS
    }

    private fun drawPlaylists(canvas: Canvas, g: IslandGeometry, alpha: Float) {
        val list = playlists
        drawHeader(canvas, g, Page.PLAYLISTS, "Playlists", playlistsCount, alpha)
        if (list.isEmpty()) {
            drawEmpty(canvas, g, "No playlists yet", "Make one in LuvLyrics", alpha)
            return
        }
        val texts = playlistTexts
        drawRows(canvas, g, Page.PLAYLISTS, playlistScroll, alpha) { i, top, h, a ->
            val p = list[i]
            val cover = if (p.cover.isNotEmpty()) p.cover else p.songs.firstOrNull()?.cover.orEmpty()
            drawRow(canvas, g, texts, i, top, h, g.dp(46f), g.dp(10f), cover, p.name, null, p.count, a, highlight = false)
        }
    }

    /** Every downloaded song, for listening offline; a tap plays it from the downloads, lyrics and all. */
    private fun drawDownloads(canvas: Canvas, g: IslandGeometry, alpha: Float) {
        val list = downloads
        drawHeader(canvas, g, Page.DOWNLOADS, "Downloads", downloadsCount, alpha)
        if (list.isEmpty()) {
            drawEmpty(canvas, g, "No downloads yet", "Save songs in LuvLyrics to play offline", alpha)
            return
        }
        val playingId = player?.currentMediaItem?.mediaId
        val texts = downloadTexts
        drawRows(canvas, g, Page.DOWNLOADS, downloadScroll, alpha) { i, top, h, a ->
            val s = list[i]
            drawRow(canvas, g, texts, i, top, h, g.dp(40f), g.dp(8f), s.cover, s.title, s.artist, -1, a,
                highlight = s.id == playingId)
        }
    }

    private fun drawSongs(canvas: Canvas, g: IslandGeometry, alpha: Float) {
        val p = songsOf ?: return
        if (songTextsFor != p.id || songTexts.size != p.songs.size * 2) {
            songTextsFor = p.id
            songTexts = arrayOfNulls(p.songs.size * 2)
            songsCount = songsLabel(p.count)
            headerNames[Page.SONGS.ordinal] = null
        }
        drawHeader(canvas, g, Page.SONGS, p.name, songsCount, alpha)
        if (p.songs.isEmpty()) {
            drawEmpty(canvas, g, "No songs here yet", "Add some in LuvLyrics", alpha)
            return
        }
        val playingId = player?.currentMediaItem?.mediaId
        val texts = songTexts
        drawRows(canvas, g, Page.SONGS, songScroll, alpha) { i, top, h, a ->
            val s = p.songs[i]
            drawRow(canvas, g, texts, i, top, h, g.dp(40f), g.dp(8f), s.cover, s.title, s.artist, -1, a,
                highlight = s.id == playingId)
        }
    }

    /** The visible rows of a list between the header and the island's bottom edge, faded at both ends. */
    private inline fun drawRows(canvas: Canvas, g: IslandGeometry, p: Page, scroll: Float, alpha: Float,
                                drawOne: (index: Int, top: Float, height: Float, alpha: Float) -> Unit) {
        val h = rowHeight(p, g)
        val count = rowCount(p)
        canvas.saveLayer(-g.cardWidth / 2f, listTop, g.cardWidth / 2f, listBottom, null)
        val first = max(0, ((scroll) / h).toInt())
        var i = first
        while (i < count) {
            val top = listTop + i * h - scroll
            if (top > listBottom) break
            drawOne(i, top, h, alpha)
            i++
        }
        val fade = g.dp(16f)
        fadePaint.shader = listFadeTop
        canvas.drawRect(-g.cardWidth / 2f, listTop, g.cardWidth / 2f, listTop + fade, fadePaint)
        fadePaint.shader = listFadeBottom
        canvas.drawRect(-g.cardWidth / 2f, listBottom - fade, g.cardWidth / 2f, listBottom, fadePaint)
        canvas.restore()
    }

    /** A list cover in [box]; with none (yet), a soft tile with the first letter, never an empty grey box. */
    private fun drawThumb(canvas: Canvas, t: IslandThumbs.Thumb?, box: RectF, corner: Float, alpha: Float, name: String) {
        if (t != null) {
            imagePaint.shader = t.shader
            fitShader(t.bitmap, box)
            imagePaint.alpha = (255 * alpha).toInt()
            canvas.drawRoundRect(box, corner, corner, imagePaint)
            return
        }
        fill.shader = null
        fill.color = blendedColors().bottom
        fill.alpha = (255 * alpha * 0.55f).toInt()
        canvas.drawRoundRect(box, corner, corner, fill)
        val letter = name.trim().take(1).uppercase()
        val size = rowTitlePaint.textSize
        rowTitlePaint.textSize = box.height() * 0.42f
        rowTitlePaint.alpha = (255 * alpha * 0.9f).toInt()
        val lw = rowTitlePaint.measureText(letter)
        canvas.drawText(letter, box.centerX() - lw / 2f, box.centerY() + rowTitlePaint.textSize * 0.35f, rowTitlePaint)
        rowTitlePaint.textSize = size
    }

    /** One row: its cover, its name and a quiet line under it ([sub], or "N songs" from [count]). */
    private fun drawRow(canvas: Canvas, g: IslandGeometry, texts: Array<String?>, i: Int, top: Float, h: Float, thumb: Float,
                        corner: Float, cover: String, name: String, sub: String?, count: Int, alpha: Float, highlight: Boolean) {
        // The row a picked song flew out of stays empty while its list folds away.
        if (drawingGhost && i == flyRowIndex) return
        val pad = g.dp(IslandGeometry.CARD_PADDING_DP)
        val left = -g.cardWidth / 2f + pad
        val right = g.cardWidth / 2f - pad
        val cy = top + h / 2f
        scratch.set(left, cy - thumb / 2f, left + thumb, cy + thumb / 2f)
        drawThumb(canvas, thumbs.get(cover), scratch, corner, alpha, name)
        val x = scratch.right + g.dp(12f)
        // Song rows keep room for the playing song's bars, so a row's trimmed title fits whichever song plays.
        val barsRoom = if (sub != null) g.dp(26f) else 0f
        val room = right - x - barsRoom
        val shownName = texts.getOrNull(2 * i) ?: fitText(name, rowTitlePaint, room).also { if (2 * i < texts.size) texts[2 * i] = it }
        val shownSub = texts.getOrNull(2 * i + 1)
            ?: fitText(sub ?: songsLabel(count), rowSubPaint, room).also { if (2 * i + 1 < texts.size) texts[2 * i + 1] = it }
        val accent = blendedColors().accent
        rowTitlePaint.color = if (highlight) accent else Color.WHITE
        rowTitlePaint.alpha = (255 * alpha).toInt()
        canvas.drawText(shownName, x, cy - g.dp(2f), rowTitlePaint)
        rowTitlePaint.color = Color.WHITE
        rowSubPaint.alpha = (255 * alpha * 0.55f).toInt()
        canvas.drawText(shownSub, x, cy + g.dp(15f), rowSubPaint)
        if (highlight) drawBars(canvas, right, cy, g.dp(14f), g.dp(2.5f), g.dp(2f), accent, alpha, playing && screenOn)
    }

    private fun drawEmpty(canvas: Canvas, g: IslandGeometry, line: String, hint: String, alpha: Float,
                          mid: Float = (listTop + listBottom) / 2f - g.dp(30f)) {
        titlePaint.alpha = (255 * alpha).toInt()
        canvas.drawText(line, -titlePaint.measureText(line) / 2f, mid, titlePaint)
        rowSubPaint.alpha = (255 * alpha * 0.55f).toInt()
        canvas.drawText(hint, -rowSubPaint.measureText(hint) / 2f, mid + g.dp(22f), rowSubPaint)
    }

    /**
     * The search drawer: a field (the host's real text field lies over it and holds the keyboard), the best answer
     * large with a play button, and the other answers listed under it.
     */
    private fun drawSearch(canvas: Canvas, g: IslandGeometry, cardAlpha: Float, sp: Float) {
        // The card's cover-and-title row stretches into the field (one shape changing, not two crossing), and the
        // field's own contents and the answers come in once it is nearly there.
        val e = sp.coerceIn(0f, 1.05f)
        morphRect.set(lerp(openBox.left, fieldBox.left, e), lerp(openBox.top, fieldBox.top, e),
            lerp(openBox.right, fieldBox.right, e), lerp(openBox.bottom, fieldBox.bottom, e))
        val corner = lerp(g.dp(12f), fieldBox.height() / 2f, e.coerceAtMost(1f))
        fill.shader = null
        fill.color = Color.WHITE
        fill.alpha = (255 * cardAlpha * 0.14f * (sp / 0.2f).coerceIn(0f, 1f)).toInt()
        canvas.drawRoundRect(morphRect, corner, corner, fill)
        val alpha = cardAlpha * ((sp - 0.45f) / 0.55f).coerceIn(0f, 1f)
        if (alpha <= 0.01f) return
        canvas.save()
        // The answers rise into place under the field.
        canvas.translate(0f, g.dp(28f) * (1f - e.coerceAtMost(1f)))
        val mx = fieldBox.left + g.dp(19f)
        val my = fieldBox.centerY()
        strokePaint.strokeWidth = g.dp(2f)
        strokePaint.alpha = (255 * alpha * 0.7f).toInt()
        canvas.drawCircle(mx - g.dp(1.5f), my - g.dp(1.5f), g.dp(5.5f), strokePaint)
        canvas.drawLine(mx + g.dp(2.5f), my + g.dp(2.5f), mx + g.dp(6.5f), my + g.dp(6.5f), strokePaint)
        val tx = fieldBox.left + g.dp(34f)
        val room = fieldBox.right - g.dp(16f) - tx
        val baseline = my + artistPaint.textSize * 0.35f
        var caretX = tx
        if (searchText.isEmpty()) {
            artistPaint.alpha = (255 * alpha * 0.45f).toInt()
            canvas.drawText(SEARCH_HINT, tx, baseline, artistPaint)
        } else {
            artistPaint.alpha = (255 * alpha).toInt()
            val w = artistPaint.measureText(searchText)
            // A long query shows its end, where the typing is.
            val shift = max(0f, w - room)
            canvas.save()
            canvas.clipRect(tx, fieldBox.top, tx + room, fieldBox.bottom)
            canvas.drawText(searchText, tx - shift, baseline, artistPaint)
            canvas.restore()
            caretX = tx + w - shift
        }
        if (searchOpen && (SystemClock.uptimeMillis() / CARET_BLINK_MS) % 2L == 0L) {
            fill.color = blendedColors().accent
            fill.alpha = (255 * alpha).toInt()
            canvas.drawRect(caretX + g.dp(1f), my - g.dp(9f), caretX + g.dp(3f), my + g.dp(9f), fill)
        }

        val mid = bestBox.top + g.dp(40f)
        val query = searchText.trim()
        when {
            searchUnavailable -> drawEmpty(canvas, g, "Open LuvLyrics to search", "Search runs while the app is open", alpha, mid)
            query.isEmpty() -> drawEmpty(canvas, g, "Search for a song", "The best match plays, similar songs follow", alpha, mid)
            searchResults.isEmpty() || IslandLibrary.searchQuery != query ->
                drawEmpty(canvas, g, if (IslandLibrary.searching || IslandLibrary.searchQuery != query) "Searching…" else "No songs found", "", alpha, mid)
            else -> drawResults(canvas, g, alpha)
        }
        canvas.restore()
    }

    private fun drawResults(canvas: Canvas, g: IslandGeometry, alpha: Float) {
        val best = searchResults[0]
        val coverBox = scratch
        val size = g.dp(64f)
        coverBox.set(bestBox.left, bestBox.centerY() - size / 2f, bestBox.left + size, bestBox.centerY() + size / 2f)
        val flying = flyer != null && flyRowPage == null
        if (!(flying && flyRowIndex == 0)) drawThumb(canvas, thumbs.get(best.cover), coverBox, g.dp(12f), alpha, best.title)
        val x = coverBox.right + g.dp(12f)
        val room = bestPlay.left - g.dp(10f) - x
        val texts = resultTexts
        val name = texts.getOrNull(0) ?: fitText(best.title, titlePaint, room).also { if (texts.isNotEmpty()) texts[0] = it }
        val who = texts.getOrNull(1) ?: fitText(best.artist, artistPaint, room).also { if (texts.size > 1) texts[1] = it }
        if (!(flying && flyRowIndex == 0)) {
            titlePaint.alpha = (255 * alpha).toInt()
            canvas.drawText(name, x, bestBox.centerY() - g.dp(3f), titlePaint)
            artistPaint.alpha = (255 * alpha * 0.62f).toInt()
            canvas.drawText(who, x, bestBox.centerY() + g.dp(17f), artistPaint)
        }
        // The play pill: white, as the app's main play buttons are.
        val pressed = pressedButton == Target.BEST
        fill.shader = null
        fill.color = Color.WHITE
        fill.alpha = (255 * alpha * if (pressed) 0.8f else 1f).toInt()
        canvas.drawRoundRect(bestPlay, bestPlay.height() / 2f, bestPlay.height() / 2f, fill)
        iconPaint.color = Color.BLACK
        iconPaint.alpha = (255 * alpha).toInt()
        IslandIcons.draw(canvas, IslandIcons.play, bestPlay.left + g.dp(19f), bestPlay.centerY(), g.dp(18f), iconPaint)
        iconPaint.color = Color.WHITE
        rowTitlePaint.color = Color.BLACK
        rowTitlePaint.alpha = (255 * alpha).toInt()
        canvas.drawText(PLAY_LABEL, bestPlay.left + g.dp(30f), bestPlay.centerY() + rowTitlePaint.textSize * 0.35f, rowTitlePaint)
        rowTitlePaint.color = Color.WHITE

        val bottom = g.cardTop + g.searchHeight - g.dp(6f)
        val h = g.dp(SONG_ROW_DP)
        val playingId = player?.currentMediaItem?.mediaId
        canvas.save()
        canvas.clipRect(-g.cardWidth / 2f, resultsTop, g.cardWidth / 2f, bottom)
        var i = 1
        while (i < searchResults.size) {
            val top = resultsTop + (i - 1) * h - searchScroll
            if (top > bottom) break
            if (top + h >= resultsTop && !(flying && flyRowIndex == i)) {
                val s = searchResults[i]
                drawRow(canvas, g, texts, i, top, h, g.dp(40f), g.dp(8f), s.cover, s.title, s.artist, -1, alpha,
                    highlight = s.id == playingId)
            }
            i++
        }
        canvas.restore()
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

    /**
     * Level bars at 30 fps while they show and music plays. The open card redraws every frame while a title
     * slides, at 30 fps while its light drifts (music playing), and otherwise only when a resting title is due to
     * move again or, paused, twice a second for the clock.
     */
    private fun scheduleTicks(compactAlpha: Float, cardAlpha: Float) {
        if (looping || !screenOn) return
        if (compactAlpha > 0.01f && cardAlpha <= 0.01f) {
            if (playing) postInvalidateDelayed(BAR_FRAME_MS)
            return
        }
        if (cardAlpha <= 0.5f) return
        val g = geometry ?: return
        if (searchOpen) {
            postInvalidateDelayed(if (playing) BAR_FRAME_MS else CARET_BLINK_MS)
            return
        }
        var wait = -1f
        if (page == Page.NOW && ghostPage == null && playing) {
            val a = IslandMotion.marqueeWait(marqueeClock, titleWidth, textWidth, g.density)
            val b = IslandMotion.marqueeWait(marqueeClock, artistWidth, textWidth, g.density)
            wait = if (a < 0f) b else if (b < 0f) a else min(a, b)
        }
        when {
            wait == 0f -> postInvalidateOnAnimation()
            playing -> postInvalidateDelayed(BAR_FRAME_MS)
            wait > 0f -> postInvalidateDelayed((wait * 1000f).toLong().coerceAtLeast(16L))
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
            com.lyricflow.app.R.id.island_playlists to "Show playlists",
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
            com.lyricflow.app.R.id.island_playlists -> {
                expand()
                showPage(Page.PLAYLISTS)
            }
            else -> return super.performAccessibilityAction(action, arguments)
        }
        return true
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val g = geometry ?: return false
        val x = event.x - width / 2f
        val y = event.y
        if (wantOpen && event.actionMasked != MotionEvent.ACTION_OUTSIDE) {
            if (event.actionMasked == MotionEvent.ACTION_DOWN) {
                velocity?.recycle()
                velocity = VelocityTracker.obtain()
            }
            velocity?.addMovement(event)
        }
        when (event.actionMasked) {
            MotionEvent.ACTION_OUTSIDE -> {
                collapse()
                return false
            }
            MotionEvent.ACTION_DOWN -> {
                downX = x
                downY = y
                downTime = event.eventTime
                moved = false
                longPressed = false
                axis = Axis.NONE
                touchTarget = hitTest(x, y)
                if (touchTarget == Target.NONE) return false
                if (!wantOpen) {
                    press.target = 1f
                    kickLoop()
                    main.postDelayed(longPress, LONG_PRESS_MS)
                } else {
                    holdOpen()
                    // A list in flight stops under the finger, as any list does.
                    if (!listScroller.isFinished) listScroller.forceFinished(true)
                    when (touchTarget) {
                        Target.PROGRESS -> startScrub(x)
                        Target.PREVIOUS, Target.PLAY, Target.NEXT, Target.OPEN, Target.BACK, Target.BEST -> pressedButton = touchTarget
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
                    if (wantOpen && !scrubbing) startDrag(dx, dy)
                }
                if (!wantOpen) {
                    // Pull the pill down to open it. The finger's speed so far, in card heights a second, carries on
                    // into the spring (as Apple's springs keep a gesture's velocity): a flick opens faster, never with a jump.
                    if (!longPressed && dy > g.dp(14f)) {
                        main.removeCallbacks(longPress)
                        press.target = 0f
                        expand()
                        val seconds = max(MIN_GESTURE_S, (event.eventTime - downTime) / 1000f)
                        open.kick(((dy / g.cardHeight) / seconds).coerceIn(0f, MAX_FLING))
                    }
                } else if (scrubbing) {
                    moveScrub(x)
                } else if (dragging) {
                    drag(g, dx, dy, event)
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
                } else if (dragging) {
                    endDrag(g)
                } else if (!moved) {
                    tap(touchTarget, x, y)
                }
                pressedButton = Target.NONE
                velocity?.recycle()
                velocity = null
                invalidate()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                main.removeCallbacks(longPress)
                press.target = 0f
                scrubbing = false
                scrubGrow.target = 0f
                if (dragging) endDrag(g)
                pressedButton = Target.NONE
                velocity?.recycle()
                velocity = null
                kickLoop()
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    // ── Drags on the open island ────────────────────────────────────────────────────────────────────────────

    /** The first move past the slop picks the drag's axis: sideways slides the pages, up and down the rest. */
    private fun startDrag(dx: Float, dy: Float) {
        val g = geometry ?: return
        dragging = true
        val sideways = abs(dx) > abs(dy) * 1.15f
        axis = when {
            searchOpen -> if (downY < resultsTop) Axis.SEARCH else Axis.VERTICAL
            sideways -> Axis.HORIZONTAL
            // A pull down from the top of the card opens search; from its middle or bottom, the lyrics.
            page == Page.NOW && !lyricsFull && pageX.value.let { abs(it) < 0.5f } && dy > 0f &&
                downY < g.cardTop + (g.cardHeight + g.dp(LYRICS_ROOM_DP) * lyricsRoom.value) * SEARCH_ZONE -> Axis.SEARCH
            else -> Axis.VERTICAL
        }
        dragBase = when {
            axis == Axis.HORIZONTAL -> pageX.value
            axis == Axis.SEARCH -> searchP.value
            !searchOpen && page == Page.NOW -> full.value
            else -> listScroll()
        }
        // The window takes the island's full height once, now, so following the finger never resizes it per frame.
        refit()
    }

    /** The finger moves the island directly: pages follow it sideways, the card stretches into lyrics and back. */
    private fun drag(g: IslandGeometry, dx: Float, dy: Float, event: MotionEvent) {
        if (axis == Axis.SEARCH) {
            val travel = max(1f, g.searchHeight - g.cardHeight)
            var f = dragBase + dy / travel
            if (f < 0f) f *= RUBBER
            if (f > 1f) f = 1f + (f - 1f) * RUBBER
            searchP.snap(f)
        } else if (axis == Axis.HORIZONTAL) {
            val first = Page.DOWNLOADS.at
            val last = if (songsOf != null) Page.SONGS.at else Page.PLAYLISTS.at
            var x = dragBase - dx / g.cardWidth
            // Past either end the page resists, like a rubber band.
            if (x < first) x = first + (x - first) * RUBBER
            if (x > last) x = last + (x - last) * RUBBER
            pageX.snap(x)
            // Leaving the card for either side grows the island with the finger; the card's own lyrics stay put.
            if (!lyricsFull) full.snap(min(1f, abs(x)))
        } else if (!searchOpen && page == Page.NOW && abs(pageX.value) < 0.5f) {
            val travel = max(1f, g.fullHeight - g.cardHeight)
            var f = dragBase + dy / travel
            when {
                // Pushed up from the card: put the island away, carrying the push into the closing spring.
                !lyricsFull && dy < -g.dp(24f) && dragBase < 0.05f -> {
                    val seconds = max(MIN_GESTURE_S, (event.eventTime - downTime) / 1000f)
                    dragging = false
                    collapse()
                    open.kick(((dy / g.cardHeight) / seconds).coerceIn(-MAX_FLING, 0f))
                    return
                }
                f < 0f -> f *= RUBBER
                f > 1f -> f = 1f + (f - 1f) * RUBBER
            }
            // No lyrics for this song: the card gives a little and springs back.
            if (lyricLines.isEmpty()) f = f.coerceAtMost(0f) + f.coerceAtLeast(0f) * RUBBER * 0.5f
            full.snap(f)
            lyricsP.snap(f.coerceIn(0f, 1f))
        } else if (searchOpen || page != Page.NOW) {
            val maxS = maxListScroll()
            var s = dragBase - dy
            if (s < 0f) s *= RUBBER
            if (s > maxS) s = maxS + (s - maxS) * RUBBER
            setListScroll(s)
            invalidate()
        }
        kickLoop()
    }

    private fun endDrag(g: IslandGeometry) {
        dragging = false
        val v = velocity
        v?.computeCurrentVelocity(1000, maxFlingVelocity)
        val vx = v?.xVelocity ?: 0f
        val vy = v?.yVelocity ?: 0f
        if (axis == Axis.SEARCH) {
            val travel = max(1f, g.searchHeight - g.cardHeight)
            val speed = vy / travel
            val f = searchP.value
            val keep = if (searchOpen) f > 0.7f && speed > -2f else f > 0.3f || speed > 2f
            if (keep) openSearch() else closeSearch()
            searchP.kick(speed.coerceIn(-MAX_FLING, MAX_FLING))
        } else if (axis == Axis.HORIZONTAL) {
            val last = if (songsOf != null) Page.SONGS.at else Page.PLAYLISTS.at
            val speed = -vx / g.cardWidth
            val projected = pageX.value + speed * 0.18f
            val next = projected.roundToInt().toFloat().coerceIn(Page.DOWNLOADS.at, last)
            page = Page.entries.first { it.at == next }
            pageX.target = next
            pageX.kick(speed.coerceIn(-MAX_FLING, MAX_FLING))
        } else if (!searchOpen && page == Page.NOW && abs(pageX.value) < 0.5f) {
            val travel = max(1f, g.fullHeight - g.cardHeight)
            val speed = vy / travel
            val f = full.value
            lyricsFull = lyricLines.isNotEmpty() && (if (lyricsFull) f > 0.72f && speed > -2f else f > 0.3f || speed > 2f)
            full.kick(speed.coerceIn(-MAX_FLING, MAX_FLING))
            lyricsP.kick(speed.coerceIn(-MAX_FLING, MAX_FLING))
        } else if (searchOpen || page != Page.NOW) {
            val maxS = maxListScroll()
            val s = listScroll()
            if (s < 0f || s > maxS) {
                listScroller.springBack(0, s.roundToInt(), 0, 0, 0, maxS.roundToInt())
            } else {
                listScroller.fling(0, s.roundToInt(), 0, (-vy).roundToInt(), 0, 0, 0, maxS.roundToInt())
            }
        }
        holdOpen()
        retarget()
        kickLoop()
    }

    // ── Taps on the open island ─────────────────────────────────────────────────────────────────────────────

    private fun tap(target: Target, x: Float, y: Float) {
        when (target) {
            Target.BACK -> {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                showPage(if (page == Page.SONGS) Page.PLAYLISTS else Page.NOW)
            }
            Target.ROW -> if (searchOpen) tapResult(y) else tapRow(y)
            Target.LYRICS -> tapLyric(y)
            Target.BEST -> pickResult(0)
            Target.FIELD -> host.showSearchInput(RectF(fieldBox).apply { offset(width / 2f, 0f) })
            else -> act(target)
        }
    }

    private fun tapRow(y: Float) {
        val g = geometry ?: return
        val i = ((y - listTop + listScroll()) / rowHeight(page, g)).toInt()
        if (i < 0 || i >= rowCount(page)) return
        performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        if (page == Page.DOWNLOADS) {
            val song = downloads[i]
            liftRow(g, song, i, Page.DOWNLOADS)
            if (!IslandLibrary.pick(IslandLibrary.DOWNLOADS, song.id)) openApp(LIBRARY_LINK)
            foldInto(Page.DOWNLOADS)
            return
        }
        if (page == Page.PLAYLISTS) {
            val chosen = playlists[i]
            if (songsOf?.id != chosen.id) songScroll = 0f
            songsOf = chosen
            showPage(Page.SONGS)
            return
        }
        val list = songsOf ?: return
        val song = list.songs[i]
        liftRow(g, song, i, Page.SONGS)
        // The app plays it as a tap on the playlist page would; with the app asleep, its link does the same.
        if (!IslandLibrary.pick(list.id, song.id)) openApp(IslandLibrary.link(list.id, song.id))
        foldInto(Page.SONGS)
    }

    /** The list a song was picked from folds away into the card, which becomes small again while the song starts. */
    private fun foldInto(from: Page) {
        ghostPage = from
        ghost.snap(1f)
        ghost.target = 0f
        page = Page.NOW
        pageX.snap(0f)
        lyricsFull = false
        holdOpen()
        retarget()
    }

    /** Starts the flyer from row [i] of a song list (songs or downloads), where drawRow draws it. */
    private fun liftRow(g: IslandGeometry, song: IslandLibrary.Song, i: Int, from: Page) {
        val h = g.dp(SONG_ROW_DP)
        val top = listTop + i * h - listScroll()
        rowFlyer(g, song, top, h, from, i)
    }

    private fun rowFlyer(g: IslandGeometry, song: IslandLibrary.Song, top: Float, h: Float, from: Page?, i: Int) {
        val left = -g.cardWidth / 2f + g.dp(IslandGeometry.CARD_PADDING_DP)
        val cy = top + h / 2f
        val size = g.dp(40f)
        flyRect.set(left, cy - size / 2f, left + size, cy + size / 2f)
        startFlyer(g, song, flyRect, g.dp(8f), flyRect.right + g.dp(12f), cy - g.dp(2f), cy + g.dp(15f),
            rowTitlePaint.textSize, rowSubPaint.textSize, from, i)
    }

    private fun tapResult(y: Float) {
        val g = geometry ?: return
        val i = 1 + ((y - resultsTop + searchScroll) / g.dp(SONG_ROW_DP)).toInt()
        if (y >= resultsTop && i in 1 until searchResults.size) pickResult(i)
    }

    /** A search answer plays (similar songs queue after it in the app), and the drawer folds back into the card. */
    private fun pickResult(i: Int) {
        val song = searchResults.getOrNull(i) ?: return
        val g = geometry ?: return
        performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        if (i == 0) {
            val size = g.dp(64f)
            flyRect.set(bestBox.left, bestBox.centerY() - size / 2f, bestBox.left + size, bestBox.centerY() + size / 2f)
            startFlyer(g, song, flyRect, g.dp(12f), flyRect.right + g.dp(12f), bestBox.centerY() - g.dp(3f),
                bestBox.centerY() + g.dp(17f), titlePaint.textSize, artistPaint.textSize, null, 0)
        } else {
            rowFlyer(g, song, resultsTop + (i - 1) * g.dp(SONG_ROW_DP) - searchScroll, g.dp(SONG_ROW_DP), null, i)
        }
        if (!IslandLibrary.pick(IslandLibrary.SEARCH, song.id)) openApp()
        closeSearch()
    }

    /** A tap on a line of the full lyrics plays from that line. */
    private fun tapLyric(y: Float) {
        val p = player ?: return
        if (lyricLayouts.isEmpty()) return
        val listY = y - lyricsTop + lyricScroll.value
        for (i in lyricLayouts.indices) {
            if (listY >= lyricTops[i] && listY <= lyricTops[i] + lyricLayouts[i].height) {
                p.seekTo(lyricLines[i].atMs)
                performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                invalidate()
                return
            }
        }
    }

    private fun hitTest(x: Float, y: Float): Target {
        val g = geometry ?: return Target.NONE
        if (shown.target <= 0f) return Target.NONE
        if (!wantOpen) {
            // The whole window round the pill counts: a tap near the camera is a tap on the island.
            return Target.PILL
        }
        val slop = g.dp(8f)
        if (searchOpen) {
            if (bestPlay.contains(x, y) || (searchResults.isNotEmpty() && bestBox.contains(x, y))) return Target.BEST
            if (y >= fieldBox.top - slop && y <= fieldBox.bottom + slop) return Target.FIELD
            if (y >= resultsTop) return Target.ROW
            return Target.CARD
        }
        if (page != Page.NOW) {
            val box = if (page == Page.DOWNLOADS) backRightBox else backBox
            if (abs(x - box.centerX()) <= box.width() / 2f + slop && abs(y - box.centerY()) <= box.height() / 2f + slop) {
                return Target.BACK
            }
            if (y in listTop..listBottom) return Target.ROW
            return Target.CARD
        }
        if (lyricsFull) {
            if (x in (barLeft - slop)..(barRight + slop) && abs(y - fullProgressY) <= g.dp(16f)) return Target.PROGRESS
            if (y in lyricsTop..lyricsBottom) return Target.LYRICS
            if (openBox.contains(x, y)) return Target.OPEN
            return Target.CARD
        }
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
        scrubGrow.target = 1f
        kickLoop()
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
        scrubGrow.target = 0f
        kickLoop()
        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        holdOpen()
    }

    private fun msAt(x: Float, duration: Long): Long {
        val f = ((x - barLeft) / (barRight - barLeft)).coerceIn(0f, 1f)
        return (duration * f).toLong()
    }

    companion object {
        /** Now Playing, mounted already open: the app grows out of the island instead of its sheet rising again. */
        const val PLAYER_LINK = "lyricflow://player?instant=1"
        private const val AUTO_CLOSE_MS = 8_000L
        private const val BROWSE_CLOSE_MS = 20_000L
        private const val LONG_PRESS_MS = 450L
        private const val BAR_FRAME_MS = 33L
        /** A gesture's carried speed is capped, so a hard flick still settles with the spring's own small overshoot. */
        private const val MAX_FLING = 4f
        private const val MIN_GESTURE_S = 0.03f
        /** How much a drag past the end of its travel still moves the island. */
        private const val RUBBER = 0.3f
        private const val OPEN_LABEL = "Open LuvLyrics"
        private const val ELLIPSIS = "\u2026"
        /** A new song with no cover yet keeps the last colours this long, then fades to neutral. */
        private const val NEUTRAL_AFTER_MS = 600L
        private const val SEARCH_DEBOUNCE_MS = 220L
        /** How long a picked song's own cover and title wait in the card for the player to start it. */
        private const val FLY_HOLD_MS = 4_000L
        private const val CARET_BLINK_MS = 530L
        private const val SEARCH_HINT = "Songs, artists"
        private const val PLAY_LABEL = "Play"
        private const val LIBRARY_LINK = "lyricflow://open/library"
        /** A pull down that starts in this top share of the card opens search; lower down it opens the lyrics. */
        private const val SEARCH_ZONE = 0.4f
        /** How much taller the card grows for lyrics, the space above them, and each line's height. */
        private const val LYRICS_ROOM_DP = 62f
        private const val LYRICS_GAP_DP = 12f
        private const val LYRICS_LINE_DP = 26f
        private const val LYRIC_SP = 16f
        /** The next line waits dimmer, as in the app's own lyrics. */
        private const val NEXT_LINE_ALPHA = 0.42f
        /** Full lyrics: the app's bold lines, the sung one bright and a third of the way down. */
        private const val FULL_LYRIC_SP = 21f
        private const val FULL_LYRIC_GAP_DP = 12f
        private const val FULL_DIM_ALPHA = 0.38f
        private const val SUNG_LINE_AT = 0.3f
        /** The scrubber: a 7 dp line that swells to 1.6× under the finger (the app's slider). */
        private const val TRACK_DP = 7f
        private const val TRACK_GROW = 1.6f
        private const val HEADER_DP = 46f
        private const val PLAYLIST_ROW_DP = 62f
        private const val SONG_ROW_DP = 56f
        /** How strongly the cover's light shows through the card. */
        private const val GLOW_STRENGTH = 0.85f
        private val BAR_SPEED = floatArrayOf(3.2f, 4.1f, 2.8f, 3.7f)
        private val BAR_PHASE = floatArrayOf(0f, 1.7f, 3.1f, 4.6f)

        private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t

        private fun appIconBitmap(context: Context): Bitmap {
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
