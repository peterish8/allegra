package com.lyricflow.app.modules

import com.lyricflow.app.views.NativePlayerFooterView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Kotlin-rendered bottom row of Now Playing: queue, output / sleep timer, lyrics (see NativePlayerFooterView). */
class NativePlayerFooterModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativePlayerFooter")

        View(NativePlayerFooterView::class) {
            Events("onAction")

            Prop("hasTimer") { view: NativePlayerFooterView, on: Boolean? -> view.setHasTimer(on) }
            Prop("sleepLabel") { view: NativePlayerFooterView, text: String? -> view.setSleepLabel(text) }
            Prop("outputDevices") { view: NativePlayerFooterView, on: Boolean? -> view.setOutputDevices(on) }
            Prop("outputActive") { view: NativePlayerFooterView, on: Boolean? -> view.setOutputActive(on) }
            Prop("showLyrics") { view: NativePlayerFooterView, on: Boolean? -> view.setShowLyrics(on) }
            Prop("lyricsLongPress") { view: NativePlayerFooterView, on: Boolean? -> view.setLyricsLongPress(on) }
            Prop("reduceMotion") { view: NativePlayerFooterView, on: Boolean? -> view.setReduceMotion(on) }
            Prop("waveColor") { view: NativePlayerFooterView, hex: String? -> view.setWaveColor(hex) }

            OnViewDidUpdateProps { view: NativePlayerFooterView -> view.commit() }
        }
    }
}
