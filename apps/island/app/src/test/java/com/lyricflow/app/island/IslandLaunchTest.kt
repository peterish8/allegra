package com.lyricflow.app.island

import android.app.Application
import android.content.Context
import android.graphics.RectF
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class, sdk = [28])
@LooperMode(LooperMode.Mode.PAUSED)
// This tests window ownership and cancellation; pixels are checked on the emulator.
@GraphicsMode(GraphicsMode.Mode.LEGACY)
class IslandLaunchTest {
    @Test
    fun `cancelling before the first frame removes the surface without starting the app`() {
        val context = RuntimeEnvironment.getApplication()
        val realWindows = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        var added = 0
        var removed = 0
        val windows = object : WindowManager by realWindows {
            override fun addView(view: View, params: ViewGroup.LayoutParams) { added++ }
            override fun removeViewImmediate(view: View) { removed++ }
        }
        var appStarts = 0
        var finished = 0
        val launch = IslandLaunch(context, windows, IslandBudget.LOW,
            onShown = { appStarts++ }, onDone = { finished++ })
        val look = IslandLaunch.Look(RectF(100f, 20f, 300f, 80f), 30f,
            snapshot = null, cover = null, coverFrom = null, coverRadius = 0f,
            flow = null, colors = IslandColors.NEUTRAL)
        assertTrue(launch.play(look, 400, 800))
        assertEquals(1, added)
        launch.finishNow()
        launch.finishNow()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("a cancelled request never opens an activity", 0, appStarts)
        assertEquals("the window is removed exactly once", 1, removed)
        assertEquals("the owner is released exactly once", 1, finished)
    }
}
