"""Adds the Round 7 page and its boards to a canvas index read from the design canvas, keeping every other key as read.

    python v7_canvas_index.py <folder holding project/canvas.json> <design-drafts/project>

Read the live project/canvas.json from the canvas first (it changes when the owner edits the canvas), then run this,
then publish project/canvas.json and the V7-*.dc.html files together. canvas.r7-staged.json is the result as of
2026-11-06, for reference only: do not publish it over a newer index. Widths must match what v7_revision.py prints.
"""
import json
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1])          # the canvas folder holding project/canvas.json
src = Path(sys.argv[2])           # design-drafts/project with the generated V7 boards
index_path = root / "project" / "canvas.json"
index = json.loads(index_path.read_text(encoding="utf-8"))

boards = [
    ("V7-1-Chips.dc.html", 1744, "1 · Mood chips"),
    ("V7-2-Menus.dc.html", 1314, "2 · Action menus"),
    ("V7-3-Navigation.dc.html", 2604, "3 · Navigation"),
    ("V7-4-Actions.dc.html", 1284, "4 · Play and Shuffle"),
    ("V7-5-Library.dc.html", 2174, "5 · Library background"),
    ("V7-6-Voice.dc.html", 4324, "6 · Voice search"),
    ("V7-7-Consistency.dc.html", 1314, "7 · Consistency"),
    ("V7-8-Shell.dc.html", 2174, "8 · Bottom surface"),
    ("V7-9-Rows.dc.html", 3004, "9 · Stream rows"),
]
page = {"id": "r7", "name": "Round 7: revision brief (for approval)"}
if not any(p.get("id") == "r7" for p in index.get("pages", [])):
    index["pages"].insert(0, page)

y = 0
for name, w, title in boards:
    index["boards"][name] = {"x": 0, "y": y, "w": w, "h": 1050, "title": title, "page": "r7"}
    if name not in index["order"]:
        index["order"].append(name)
    shutil.copyfile(src / name, root / "project" / name)
    y += 1050 + 120

index.setdefault("notes", {})["r7title"] = {
    "x": 0, "y": -300, "kind": "title1", "maxW": 4324, "page": "r7",
    "text": "Round 7: the revision brief, items 1–9. For approval; nothing here is implemented yet.",
}
index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
print("boards:", len(index["boards"]), "pages:", [p["id"] for p in index["pages"]])
