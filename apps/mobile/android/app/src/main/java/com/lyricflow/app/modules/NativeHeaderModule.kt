package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeHeaderView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Kotlin-rendered grabber and chips of Now Playing's header (see NativeHeaderView). */
class NativeHeaderModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeHeader")

        View(NativeHeaderView::class) {
            Events("onAction")

            Prop("together") { view: NativeHeaderView, count: Int? -> view.setTogether(count) }
            Prop("playingOn") { view: NativeHeaderView, name: String? -> view.setPlayingOn(name) }
            Prop("playingKind") { view: NativeHeaderView, kind: String? -> view.setPlayingKind(kind) }
            Prop("waveColor") { view: NativeHeaderView, hex: String? -> view.setWaveColor(hex) }

            OnViewDidUpdateProps { view: NativeHeaderView -> view.commit() }
        }
    }
}
