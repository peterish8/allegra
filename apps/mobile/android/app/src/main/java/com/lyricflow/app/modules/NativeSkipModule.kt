package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeSkipView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Exposes [NativeSkipView] to JS as `<NativeSkip>` (src/components/NativeSkip.tsx). */
class NativeSkipModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeSkip")

        View(NativeSkipView::class) {
            Events("onSkip")

            Prop("direction") { view: NativeSkipView, direction: Int? ->
                view.direction = direction ?: 0
            }
        }
    }
}
