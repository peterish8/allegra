package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeCanvasWashView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Exposes [NativeCanvasWashView] to JS as `<NativeCanvasWash>` (src/components/player/NativeCanvasWash.tsx). */
class NativeCanvasWashModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeCanvasWash")

        View(NativeCanvasWashView::class) {
            Prop("targetId") { view: NativeCanvasWashView, id: String? -> view.setTargetId(id) }
            Prop("active") { view: NativeCanvasWashView, active: Boolean? -> view.active = active ?: false }
        }
    }
}
