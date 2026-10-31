package com.lyricflow.app.island

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Typeface
import java.io.File

/**
 * SF Pro Text, the face the whole app uses (`src/theme/appleTypography.ts`). Release builds carry the app's
 * fonts as raw resources; they are copied out once so Typeface can open them. Debug builds take fonts from
 * Metro, so there the island falls back to the system sans.
 */
object IslandFonts {
    @Volatile var regular: Typeface = Typeface.DEFAULT
        private set
    @Volatile var semibold: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        private set
    @Volatile var bold: Typeface = Typeface.create("sans-serif", Typeface.BOLD)
        private set

    private var loaded = false
    private val listeners = java.util.concurrent.CopyOnWriteArrayList<() -> Unit>()

    /**
     * Off the main thread; [onLoaded] runs on that thread once a face changed. Every caller is told, not only the
     * first: the island and the Now Playing lyrics both ask for the faces.
     */
    fun load(context: Context, onLoaded: () -> Unit): () -> Unit {
        listeners += onLoaded
        val stop = { listeners.remove(onLoaded); Unit }
        if (loaded) return stop
        loaded = true
        Thread {
            val app = context.applicationContext
            val r = face(app, "assets_fonts_sfprotextregular")
            val s = face(app, "assets_fonts_sfprotextsemibold")
            val b = face(app, "assets_fonts_sfprotextbold")
            if (r != null) regular = r
            if (s != null) semibold = s
            if (b != null) bold = b
            if (r != null || s != null || b != null) listeners.forEach { it() }
        }.apply { isDaemon = true; name = "island-fonts" }.start()
        return stop
    }

    @SuppressLint("DiscouragedApi")
    private fun face(context: Context, name: String): Typeface? = try {
        val id = context.resources.getIdentifier(name, "raw", context.packageName)
        if (id == 0) {
            null
        } else {
            val file = File(File(context.noBackupFilesDir, "island-fonts").apply { mkdirs() }, "$name.otf")
            if (!file.isFile || file.length() == 0L) {
                val tmp = File(file.parentFile, "$name.tmp")
                context.resources.openRawResource(id).use { input -> tmp.outputStream().use { input.copyTo(it) } }
                tmp.renameTo(file)
            }
            Typeface.createFromFile(file)
        }
    } catch (_: Throwable) {
        null
    }
}
