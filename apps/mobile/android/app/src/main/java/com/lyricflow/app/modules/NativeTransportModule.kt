package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeTransportView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NativeTransportModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeTransport")
        View(NativeTransportView::class) {
            Events("onFallback")
            Prop("plain") { view: NativeTransportView, plain: Boolean -> view.plain = plain }
            Prop("tint") { view: NativeTransportView, color: Int -> view.tint = color }
            Prop("surface") { view: NativeTransportView, color: Int -> view.surface = color }
            Prop("glyph") { view: NativeTransportView, glyph: Float -> view.glyphDp = glyph }
            Prop("status") { view: NativeTransportView, _: String -> view.refresh() }
            Prop("songId") { view: NativeTransportView, _: String? -> view.refresh() }
            Prop("reduceMotion") { view: NativeTransportView, value: Boolean -> view.reduceMotion = value }
            Prop("pressDuration") { view: NativeTransportView, duration: Int -> view.pressDuration = duration.toLong() }
        }
    }
}
