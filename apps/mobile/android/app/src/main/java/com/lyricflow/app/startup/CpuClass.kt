package com.lyricflow.app.startup

import java.io.File

/**
 * Whether the phone's fastest CPU core is an old design (Cortex-A73 or earlier), read from `/proc/cpuinfo`.
 *
 * Memory and core count hide a slow phone: the Galaxy M31 has 6 GB and eight cores, but its Exynos 9611 pairs
 * Cortex-A73s with A53s, and it could not hold 60 fps under the app's full visuals. The core design is what
 * separates it from a phone that can. Unknown designs, and cpuinfo that cannot be read (x86 emulators), count as
 * fast: the frame watch (FrameWatch) still catches a slow phone this misses.
 */
object CpuClass {
    /** (implementer, part) pairs of old core designs, from the `CPU implementer` and `CPU part` lines. */
    private val OLD_CORES: Set<Pair<Int, Int>> = setOf(
        // Arm: A53, A35, A55, A57, A72, A73.
        0x41 to 0xd03, 0x41 to 0xd04, 0x41 to 0xd05, 0x41 to 0xd07, 0x41 to 0xd08, 0x41 to 0xd09,
        // Qualcomm Kryo (Snapdragon 820/821) and Kryo 2xx gold/silver (Snapdragon 660/665/835), Kryo 385 silver.
        0x51 to 0x201, 0x51 to 0x205, 0x51 to 0x211, 0x51 to 0x800, 0x51 to 0x801, 0x51 to 0x803,
        // Samsung Mongoose M1/M2 (Exynos 8890/8895).
        0x53 to 0x001, 0x53 to 0x002,
    )

    /** True when every core listed is an old design; false when any is newer or nothing could be read. */
    fun allCoresOld(cpuinfo: String): Boolean {
        val cores = parse(cpuinfo)
        return cores.isNotEmpty() && cores.all { it in OLD_CORES }
    }

    fun readAllCoresOld(): Boolean = try {
        allCoresOld(File("/proc/cpuinfo").readText())
    } catch (_: Exception) {
        false
    }

    private fun parse(cpuinfo: String): List<Pair<Int, Int>> {
        val cores = mutableListOf<Pair<Int, Int>>()
        var implementer: Int? = null
        for (line in cpuinfo.lineSequence()) {
            val key = line.substringBefore(':').trim()
            val value = line.substringAfter(':', "").trim()
            when (key) {
                "CPU implementer" -> implementer = value.toIntOrNull16()
                "CPU part" -> {
                    val part = value.toIntOrNull16()
                    if (implementer != null && part != null) cores += implementer to part
                }
            }
        }
        return cores
    }

    private fun String.toIntOrNull16(): Int? = removePrefix("0x").toIntOrNull(16)
}
