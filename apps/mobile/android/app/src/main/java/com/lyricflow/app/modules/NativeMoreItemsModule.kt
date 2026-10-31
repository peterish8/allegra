package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeMoreItemsView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Kotlin-rendered tiles and rows of the "More" menu (see NativeMoreItemsView). */
class NativeMoreItemsModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeMoreItems")

        View(NativeMoreItemsView::class) {
            Events("onSelect")

            Prop("items") { view: NativeMoreItemsView, json: String? -> view.setItems(json) }
            Prop("activeKey") { view: NativeMoreItemsView, key: String? -> view.setActiveKey(key) }
            Prop("palette") { view: NativeMoreItemsView, json: String? -> view.setPalette(json) }
            Prop("animateIn") { view: NativeMoreItemsView, on: Boolean? -> view.setAnimateIn(on) }

            OnViewDidUpdateProps { view: NativeMoreItemsView -> view.commit() }
        }
    }
}
