package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeTrackRowView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Kotlin-rendered song row of the Library and the download lists (see NativeTrackRowView). */
class NativeTrackRowModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeTrackRow")

        View(NativeTrackRowView::class) {
            Events("onPress", "onLongPress", "onTrailing")

            Prop("title") { view: NativeTrackRowView, v: String? -> view.setTitle(v) }
            Prop("meta") { view: NativeTrackRowView, v: String? -> view.setMeta(v) }
            Prop("label") { view: NativeTrackRowView, v: String? -> view.setLabel(v) }
            Prop("cover") { view: NativeTrackRowView, v: String? -> view.setCover(v) }
            Prop("base") { view: NativeTrackRowView, v: String? -> view.setBase(v) }
            Prop("mid") { view: NativeTrackRowView, v: String? -> view.setMid(v) }
            Prop("spark") { view: NativeTrackRowView, v: String? -> view.setSpark(v) }
            Prop("glyph") { view: NativeTrackRowView, v: String? -> view.setGlyph(v) }
            Prop("variant") { view: NativeTrackRowView, v: Int? -> view.setVariant(v) }
            Prop("current") { view: NativeTrackRowView, on: Boolean? -> view.setCurrent(on) }
            Prop("progress") { view: NativeTrackRowView, v: Double? -> view.setProgress(v) }
            Prop("trailing") { view: NativeTrackRowView, v: String? -> view.setTrailing(v) }
            Prop("trailingLabel") { view: NativeTrackRowView, v: String? -> view.setTrailingLabel(v) }
            Prop("palette") { view: NativeTrackRowView, json: String? -> view.setPalette(json) }

            OnViewDidUpdateProps { view: NativeTrackRowView -> view.commit() }
        }
    }
}
