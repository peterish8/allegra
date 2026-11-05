"""Merge the round-5 boards into the live canvas index without touching existing pages or boards.

usage: v5_canvas.py <live canvas.json> <board-sizes.json>  -> writes project/canvas.json
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
live = json.load(open(sys.argv[1], encoding="utf-8"))
sizes = json.load(open(sys.argv[2], encoding="utf-8"))

PAGES = [
    {"id": "r5", "name": "Round 5: system + 5 screens (review)"},
    {"id": "r5all", "name": "Round 5: every screen and state"},
]
LAYOUT = {
    "r5": [
        [("V5-Navigation", "Navigation map"), ("V5-System", "Design system"), ("V5-Components", "Components")],
        [("V5-Library", "1 · Library"), ("V5-Playlist", "2 · Playlist")],
        [("V5-Search", "3 · Search"), ("V5-NowPlaying", "4 · Now playing")],
        [("V5-SongActions", "5 · Song actions")],
    ],
    "r5all": [
        [("V5-LibraryMore", "Library: tabs and tools"), ("V5-Coverage", "Coverage matrix")],
        [("V5-PlaylistFlows", "Playlist: create, rename, delete")],
        [("V5-AddToPlaylist", "Adding songs to playlists"), ("V5-Luvs", "Luvs")],
        [("V5-Stream", "Stream")],
        [("V5-Browse", "Artist and album"), ("V5-Overlays", "Voice, notices, app states")],
        [("V5-PlayerTools", "Player sheets and modes")],
        [("V5-You", "You and Settings")],
        [("V5-Social", "Blends and LuvLink")],
        [("V5-Tools", "DJ, import and editors")],
        [("V5-Responsive", "Sizes and large text")],
    ],
}

canvas = dict(live)
existing_ids = {p["id"] for p in live["pages"]}
canvas["pages"] = [p for p in PAGES if p["id"] not in existing_ids] + [
    dict(p, name="Refined v4 (older)") if p["id"] == "accent" else p for p in live["pages"]]
boards = dict(live["boards"])
order = []
GAP_X, GAP_Y = 120, 220
for page, rows in LAYOUT.items():
    y = 0
    for row in rows:
        x, row_h = 0, 0
        for name, title in row:
            w, h = sizes[name]
            if name == "V5-Coverage":
                continue
            boards[name + ".dc.html"] = {"x": x, "y": y, "w": w, "h": h, "title": title, "radius": 16, "page": page}
            order.append(name + ".dc.html")
            x += w + GAP_X
            row_h = max(row_h, h)
        y += row_h + GAP_Y
    if page == "r5all":
        w, h = sizes["V5-Coverage"]
        boards["V5-Coverage.dc.html"] = {"x": 4100, "y": 0, "w": w, "h": h, "title": "Coverage matrix", "radius": 16, "page": page}
        order.append("V5-Coverage.dc.html")
canvas["boards"] = boards
canvas["order"] = order + [b for b in live["order"] if b not in order]
canvas["launch"] = {"view": "canvas", "page": "r5"}
notes = dict(live.get("notes", {}))
notes["r5t"] = {"x": 0, "y": -200, "text": "Round 5: one system, five screens to validate it", "kind": "title1", "maxW": 2400, "page": "r5", "w": 240}
notes["r5a"] = {"x": 0, "y": -200, "text": "Round 5: every verified screen, sheet and state", "kind": "title1", "maxW": 2400, "page": "r5all", "w": 240}
canvas["notes"] = notes
os.makedirs(os.path.join(HERE, "project"), exist_ok=True)
json.dump(canvas, open(os.path.join(HERE, "project", "canvas.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(len(boards), "boards;", [p["id"] for p in canvas["pages"]])
