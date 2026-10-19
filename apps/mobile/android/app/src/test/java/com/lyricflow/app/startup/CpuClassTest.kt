package com.lyricflow.app.startup

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CpuClassTest {
    private fun cpuinfo(vararg cores: Pair<String, String>) = cores.mapIndexed { i, (implementer, part) ->
        "processor\t: $i\nBogoMIPS\t: 52.00\nCPU implementer\t: $implementer\nCPU architecture: 8\nCPU variant\t: 0x0\nCPU part\t: $part\nCPU revision\t: 2\n"
    }.joinToString("\n")

    @Test
    fun `a Galaxy M31 (Exynos 9611, four A73 and four A53) is old`() {
        val m31 = cpuinfo(*Array(4) { "0x41" to "0xd03" }, *Array(4) { "0x41" to "0xd09" })
        assertTrue(CpuClass.allCoresOld(m31))
    }

    @Test
    fun `one newer core makes the phone new`() {
        val sd720g = cpuinfo(*Array(6) { "0x51" to "0x805" }, *Array(2) { "0x51" to "0x804" })
        assertFalse(CpuClass.allCoresOld(sd720g))
        val a76 = cpuinfo(*Array(6) { "0x41" to "0xd05" }, *Array(2) { "0x41" to "0xd0b" })
        assertFalse(CpuClass.allCoresOld(a76))
    }

    @Test
    fun `a Snapdragon 665 (Kryo 260) is old`() {
        assertTrue(CpuClass.allCoresOld(cpuinfo(*Array(4) { "0x51" to "0x801" }, *Array(4) { "0x51" to "0x800" })))
    }

    @Test
    fun `cpuinfo with no core lines (an x86 emulator) is not old`() {
        assertFalse(CpuClass.allCoresOld("processor\t: 0\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Core(TM)\n"))
        assertFalse(CpuClass.allCoresOld(""))
    }
}
