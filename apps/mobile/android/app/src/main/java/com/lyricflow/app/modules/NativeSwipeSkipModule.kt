package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeSwipeSkipView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Exposes [NativeSwipeSkipView] to JS as `<NativeSwipeSkip>` (src/components/NativeSwipeSkip.tsx). */
class NativeSwipeSkipModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeSwipeSkip")

        View(NativeSwipeSkipView::class) {
            Events("onSkip")

            Prop("enabled") { view: NativeSwipeSkipView, enabled: Boolean? -> view.enabled = enabled ?: false }
            Prop("rtl") { view: NativeSwipeSkipView, rtl: Boolean? -> view.rtl = rtl ?: false }
            Prop("reduceMotion") { view: NativeSwipeSkipView, reduce: Boolean? -> view.reduceMotion = reduce ?: false }
            Prop("songKey") { view: NativeSwipeSkipView, key: String? -> view.songKey = key }
        }
    }
}
