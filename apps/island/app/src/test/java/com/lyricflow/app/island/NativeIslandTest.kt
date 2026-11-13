package com.lyricflow.app.island

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeIslandTest {

    private fun detect(brand: String, display: String = "", vararg props: Pair<String, String>): String? {
        val map = props.toMap()
        return NativeIsland.detect({ map[it].orEmpty() }, brand, display)
    }

    @Test
    fun `a Samsung phone has no island of its own, so it gets ours`() {
        assertNull(detect("samsung", "SP1A.210812.016.M315FXXU5CWB1"))
    }

    @Test
    fun `a Pixel has no island of its own`() {
        assertNull(detect("google", "BP2A.250605.031"))
    }

    @Test
    fun `HyperOS 3 has Xiaomi's island, HyperOS 2 does not`() {
        assertEquals("Xiaomi's Super Island", detect("Xiaomi", "", "ro.mi.os.version.code" to "3"))
        assertEquals("Xiaomi's Super Island", detect("POCO", "", "ro.mi.os.version.code" to "4"))
        assertNull(detect("Redmi", "", "ro.mi.os.version.code" to "2"))
    }

    @Test
    fun `ColorOS 15 and its siblings have live alerts at the camera`() {
        assertEquals("OPPO's Fluid Cloud", detect("OPPO", "", "ro.build.version.oplusrom" to "V15.0.0"))
        assertEquals("Live Alerts", detect("OnePlus", "", "ro.build.version.oplusrom" to "V15.0.1"))
        assertEquals("Live Alerts", detect("realme", "", "ro.build.version.oplusrom" to "V16.0.0"))
        assertNull(detect("OnePlus", "", "ro.build.version.oplusrom" to "V14.0.0"))
    }

    @Test
    fun `vivo's island needs OriginOS 5, never Funtouch`() {
        assertEquals("vivo's Origin Island", detect("vivo", "", "ro.vivo.os.name" to "OriginOS", "ro.vivo.os.version" to "5.0"))
        assertNull(detect("vivo", "", "ro.vivo.os.name" to "Funtouch", "ro.vivo.os.version" to "15.0"))
        assertNull(detect("vivo", "", "ro.vivo.os.name" to "OriginOS", "ro.vivo.os.version" to "4.0"))
    }

    @Test
    fun `Honor's capsule arrived with MagicOS 8`() {
        assertEquals("Honor's Magic Capsule", detect("HONOR", "", "ro.build.version.magic" to "MagicOS_8.0.0"))
        assertNull(detect("HONOR", "", "ro.build.version.magic" to "MagicOS_7.2"))
    }

    @Test
    fun `Huawei's live window needs HarmonyOS 4 on a Huawei`() {
        assertEquals("Huawei's Live Window", detect("HUAWEI", "", "hw_sc.build.platform.version" to "4.0.0"))
        assertNull(detect("HUAWEI", "", "hw_sc.build.platform.version" to "3.0.0"))
    }

    @Test
    fun `Meizu's smart island arrived with Flyme 11`() {
        assertEquals("Meizu's Smart Island", detect("Meizu", "Flyme 11.0.0.0A"))
        assertNull(detect("Meizu", "Flyme 10.5.0.0A"))
    }

    @Test
    fun `the major version is the first number in the string`() {
        assertEquals(15, NativeIsland.majorOf("V15.0.0"))
        assertEquals(8, NativeIsland.majorOf("MagicOS_8.0.0"))
        assertEquals(3, NativeIsland.majorOf("3"))
        assertNull(NativeIsland.majorOf(""))
    }
}
