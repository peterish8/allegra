package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeQueueListView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Kotlin-rendered rows of Now Playing's Up next panel (see NativeQueueListView). */
class NativeQueueListModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeQueueList")

        View(NativeQueueListView::class) {
            Events("onPick", "onMove", "onAtTop", "onLift")

            Prop("rows") { view: NativeQueueListView, rows: String? -> view.setRows(rows) }
            Prop("currentIndex") { view: NativeQueueListView, index: Int? -> view.setCurrentIndex(index) }
            Prop("movable") { view: NativeQueueListView, on: Boolean? -> view.setMovable(on) }
            Prop("bottomPad") { view: NativeQueueListView, dp: Double? -> view.setBottomPad(dp) }
            Prop("startRow") { view: NativeQueueListView, row: Int? -> view.setStartRow(row) }
            Prop("scrollToken") { view: NativeQueueListView, token: Int? -> view.setScrollToken(token) }

            OnViewDidUpdateProps { view: NativeQueueListView -> view.commit() }
        }
    }
}
