package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeAppleBackdropView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Exposes the Android Now Playing background renderer to `src/components/player/NativeAppleBackdrop.tsx`. */
class NativeAppleBackdropModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeAppleBackdrop")

        View(NativeAppleBackdropView::class) {
            Prop("uri") { view: NativeAppleBackdropView, uri: String? -> view.setUri(uri) }
            Prop("primary") { view: NativeAppleBackdropView, color: String? -> view.setPrimaryColor(color) }
            Prop("secondary") { view: NativeAppleBackdropView, color: String? -> view.setSecondaryColor(color) }
            Prop("tertiary") { view: NativeAppleBackdropView, color: String? -> view.setTertiaryColor(color) }
            Prop("frameWidth") { view: NativeAppleBackdropView, width: Double? -> view.setFrameWidth(width) }
            Prop("frameHeight") { view: NativeAppleBackdropView, height: Double? -> view.setFrameHeight(height) }
            Prop("showHero") { view: NativeAppleBackdropView, show: Boolean? -> view.setShowHero(show) }
            Prop("veil") { view: NativeAppleBackdropView, veil: Boolean? -> view.setVeil(veil) }
            Prop("shiftX") { view: NativeAppleBackdropView, shift: Double? -> view.setShiftX(shift) }
            OnViewDidUpdateProps { view: NativeAppleBackdropView -> view.commit() }
        }
    }
}
