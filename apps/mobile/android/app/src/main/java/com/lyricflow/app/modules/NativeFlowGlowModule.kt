package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeFlowGlowView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Exposes [NativeFlowGlowView] to JS as `<NativeFlowGlow>` (src/components/player/NativeFlowGlow.tsx). */
class NativeFlowGlowModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeFlowGlow")

        View(NativeFlowGlowView::class) {
            Prop("coverUri") { view: NativeFlowGlowView, uri: String? -> view.setCover(uri) }
            Prop("active") { view: NativeFlowGlowView, active: Boolean? -> view.active = active ?: false }
            Prop("playing") { view: NativeFlowGlowView, playing: Boolean? -> view.playing = playing ?: false }
        }
    }
}
