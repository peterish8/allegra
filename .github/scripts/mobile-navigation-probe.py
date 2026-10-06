#!/usr/bin/env python3
"""Check an installed app's visible pages and Stream scrolling through real taps.

Usage: python .github/scripts/mobile-navigation-probe.py --out <evidence-directory>
Requires adb and an already running LuvLyrics build. Uses reduced system animations
so UIAutomator can read the continuously animated app, then restores all scales.
Launch the app with reduced motion enabled first if its shaders prevent idle:
Reanimated reads that setting at startup, so changing scales alone may not suffice.
Normal-animation flicker still requires the separate screen-recording check.
Does not install an APK, clear app data, or change listener preferences.
"""

import argparse
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", help="adb device serial")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    prefix = ["adb"] + (["-s", args.serial] if args.serial else [])

    def adb(*command, timeout=25):
        return subprocess.run(prefix + list(command), check=True, capture_output=True,
                              timeout=timeout).stdout.decode("utf-8", errors="replace").strip()

    def link(target):
        adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW",
            "-d", f"lyricflow://open/{target}", "com.lyricflow.app")
        time.sleep(0.7)

    def snapshot(name):
        result = adb("shell", "uiautomator", "dump", "/sdcard/nav-probe.xml")
        if "dumped" not in result:
            raise RuntimeError(f"Cannot inspect {name}: {result}")
        xml = adb("shell", "cat", "/sdcard/nav-probe.xml")
        (args.out / f"{name}.xml").write_text(xml, encoding="utf-8")
        png = subprocess.run(prefix + ["exec-out", "screencap", "-p"], check=True,
                             capture_output=True, timeout=15).stdout
        (args.out / f"{name}.png").write_bytes(png)
        return ET.fromstring(xml)

    def bounds(node):
        return tuple(map(int, re.findall(r"\d+", node.get("bounds", ""))))

    def tap(root, label):
        # Search focuses its input. Its floating tab bar is still in the tree,
        # but the keyboard covers its coordinates; dismiss it before tapping.
        if "mInputShown=true" in adb("shell", "dumpsys", "input_method"):
            adb("shell", "input", "keyevent", "4")
            time.sleep(0.3)
            root = snapshot(f"before-{label.lower()}-keyboard-dismissed")
        node = next((n for n in root.iter("node") if n.get("content-desc") == label), None)
        if node is None:
            raise AssertionError(f"No tappable {label} control")
        x1, y1, x2, y2 = bounds(node)
        adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
        time.sleep(0.7)

    def heading(root, title):
        # The bottom bar also contains page names. Only count the page's heading.
        return next((n for n in root.iter("node") if n.get("text") == title
                     and len(bounds(n)) == 4 and bounds(n)[1] < height * 0.3), None)

    def require_page(name, title):
        root = snapshot(name)
        if heading(root, title) is None:
            raise AssertionError(f"{name}: destination heading {title!r} is not visible")
        print(f"PASS {name}: visible {title}", flush=True)
        return root

    def scroll_to_top():
        for _ in range(3):
            adb("shell", "input", "swipe", str(width // 2), str(int(height * 0.25)),
                str(width // 2), str(int(height * 0.7)), "300")
        time.sleep(0.5)

    scales = ("animator_duration_scale", "transition_animation_scale", "window_animation_scale")
    original = {key: adb("shell", "settings", "get", "global", key) for key in scales}
    size = re.findall(r"(\d+)x(\d+)", adb("shell", "wm", "size"))[-1]
    width, height = map(int, size)
    try:
        for key in scales:
            adb("shell", "settings", "put", "global", key, "0")
        link("stream")
        scroll_to_top()
        x = str(width // 2)
        stream = require_page("stream-initial", "Stream")
        tap(stream, "Library")
        library = require_page("library-by-tap", "Library")
        tap(library, "Stream")
        stream = require_page("stream-return", "Stream")
        adb("shell", "input", "swipe", x, str(int(height * 0.7)),
            x, str(int(height * 0.25)), "500")
        time.sleep(0.5)
        scrolled = snapshot("stream-scrolled")
        if heading(scrolled, "Stream") is not None:
            raise AssertionError("Stream did not scroll its heading out of view")
        print("PASS Stream scrolls after returning from Library", flush=True)
        for destination, title in (("settings", "Settings"), ("search", "Search"),
                                   ("playlists", "Playlists")):
            link(destination)
            root = require_page(destination, title)
            tap(root, "Library")
            require_page(f"library-after-{destination}", "Library")
        link("stream")
        scroll_to_top()
        require_page("stream-final", "Stream")
        print("PASS navigation reachability and scrolling probe", flush=True)
    finally:
        for key, value in original.items():
            if value == "null":
                adb("shell", "settings", "delete", "global", key)
            else:
                adb("shell", "settings", "put", "global", key, value)


if __name__ == "__main__":
    main()
