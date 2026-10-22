package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeAlphabetRailView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Kotlin-rendered A–Z rail of the Library (see NativeAlphabetRailView). */
class NativeAlphabetRailModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeAlphabetRail")

        View(NativeAlphabetRailView::class) {
            Events("onPick")

            Prop("letters") { view: NativeAlphabetRailView, json: String? -> view.setLetters(json) }
            Prop("palette") { view: NativeAlphabetRailView, json: String? -> view.setPalette(json) }
            Prop("lineHeight") { view: NativeAlphabetRailView, dp: Double? -> view.setLineHeight(dp) }

            OnViewDidUpdateProps { view: NativeAlphabetRailView -> view.commit() }
        }
    }
}
