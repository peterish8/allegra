package com.lyricflow.app.modules

import com.lyricflow.app.views.NativeTabBarView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Exposes the Android-rendered Allegra tab bar to React Navigation. */
class NativeTabBarModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeTabBar")

        View(NativeTabBarView::class) {
            Events("onTabPress", "onMorePress")

            Prop("variant") { view: NativeTabBarView, value: String? ->
                view.setVariant(value)
            }
            Prop("activeTab") { view: NativeTabBarView, value: String? ->
                view.setActiveTab(value)
            }
            Prop("moreActive") { view: NativeTabBarView, value: Boolean? ->
                view.setMoreState(value ?: false, view.isMoreOpen())
            }
            Prop("moreOpen") { view: NativeTabBarView, value: Boolean? ->
                view.setMoreState(view.isMoreActive(), value ?: false)
            }
            Prop("micEnabled") { view: NativeTabBarView, value: Boolean? ->
                view.setMicEnabled(value ?: false)
            }
            Prop("dark") { view: NativeTabBarView, value: Boolean? ->
                view.setDark(value ?: true)
            }
            Prop("glassBackground") { view: NativeTabBarView, value: Boolean? ->
                view.setGlassBackground(value ?: false)
            }
            Prop("bottomInset") { view: NativeTabBarView, value: Float? ->
                view.setBottomInset(value ?: 0f)
            }
            Prop("bottomOffset") { view: NativeTabBarView, value: Float? ->
                view.setBottomOffset(value ?: 0f)
            }
            Prop("activeTint") { view: NativeTabBarView, value: String? ->
                view.setActiveTint(value)
            }
            Prop("inactiveTint") { view: NativeTabBarView, value: String? ->
                view.setInactiveTint(value)
            }
        }
    }
}
