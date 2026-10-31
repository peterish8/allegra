package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeSongActionsView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Kotlin-rendered round buttons at the end of Now Playing's title row: fullscreen, options, like (see NativeSongActionsView). */
class NativeSongActionsModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeSongActions")

        View(NativeSongActionsView::class) {
            Events("onAction")

            Prop("fullscreen") { view: NativeSongActionsView, mode: String? -> view.setFullscreen(mode) }
            Prop("hasMore") { view: NativeSongActionsView, on: Boolean? -> view.setHasMore(on) }
            Prop("liked") { view: NativeSongActionsView, on: Boolean? -> view.setLiked(on) }
            Prop("saving") { view: NativeSongActionsView, on: Boolean? -> view.setSaving(on) }
            Prop("slop") { view: NativeSongActionsView, dp: Double? -> view.setSlop(dp) }
            Prop("likeLabel") { view: NativeSongActionsView, text: String? -> view.setLikeLabel(text) }
            Prop("reduceMotion") { view: NativeSongActionsView, on: Boolean? -> view.setReduceMotion(on) }

            OnViewDidUpdateProps { view: NativeSongActionsView -> view.commit() }
        }
    }
}
