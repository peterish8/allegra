package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeLyricsView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Kotlin-rendered synchronized lyrics for Now Playing (see NativeLyricsView). */
class NativeLyricsModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeLyrics")

        View(NativeLyricsView::class) {
            Events("onLyricPress", "onScrollState", "onAtTop", "onPill")

            Prop("payload") { view: NativeLyricsView, payload: String? -> view.setPayload(payload) }
            Prop("config") { view: NativeLyricsView, config: String? -> view.setConfig(config) }
            Prop("seedMs") { view: NativeLyricsView, ms: Double? -> view.setSeed(ms) }
            Prop("live") { view: NativeLyricsView, live: Boolean? -> view.setLive(live) }
            Prop("resumeSignal") { view: NativeLyricsView, signal: Int? -> view.setResumeSignal(signal) }

            OnViewDidUpdateProps { view: NativeLyricsView -> view.commit() }
        }
    }
}
