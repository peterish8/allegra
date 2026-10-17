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

    private var loaded = false

    /** Off the main thread; [onLoaded] runs on that thread once a face changed. */
    fun load(context: Context, onLoaded: () -> Unit) {
        if (loaded) return
        loaded = true
        Thread {
            val app = context.applicationContext
            val r = face(app, "assets_fonts_sfprotextregular")
            val s = face(app, "assets_fonts_sfprotextsemibold")
            if (r != null) regular = r
            if (s != null) semibold = s
            if (r != null || s != null) onLoaded()
        }.apply { isDaemon = true; name = "island-fonts" }.start()
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
