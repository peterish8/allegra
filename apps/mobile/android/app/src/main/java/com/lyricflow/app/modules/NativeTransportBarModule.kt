package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeTransportBarView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Kotlin-rendered Android transport strip for Now Playing. */
class NativeTransportBarModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeTransportBar")

        View(NativeTransportBarView::class) {
            Events("onPlayPause", "onSkip")

            Prop("playing") { view: NativeTransportBarView, playing: Boolean? ->
                view.setPlaying(playing ?: false)
            }
            Prop("tint") { view: NativeTransportBarView, tint: String? ->
                view.setTint(tint)
            }
            Prop("nativeSkip") { view: NativeTransportBarView, enabled: Boolean? ->
                view.setNativeSkip(enabled ?: false)
            }
        }
    }
}
