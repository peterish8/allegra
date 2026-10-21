package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeScrubberView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Kotlin-rendered song scrubber of Now Playing (see NativeScrubberView). */
class NativeScrubberModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeScrubber")

        View(NativeScrubberView::class) {
            Events("onCommit")

            Prop("songId") { view: NativeScrubberView, id: String? -> view.setSongId(id) }
            Prop("seedSec") { view: NativeScrubberView, sec: Double? -> view.setSeed(sec) }
            Prop("durationSec") { view: NativeScrubberView, sec: Double? -> view.setDuration(sec) }
            Prop("live") { view: NativeScrubberView, on: Boolean? -> view.setLive(on) }
            Prop("trackHeight") { view: NativeScrubberView, dp: Double? -> view.setTrackHeight(dp) }
            Prop("label") { view: NativeScrubberView, text: String? -> view.setLabel(text) }

            OnViewDidUpdateProps { view: NativeScrubberView -> view.commit() }
        }
    }
}
