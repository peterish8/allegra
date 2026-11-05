"""Scripted audit of the round-5 boards: weights, accessible names, 48dp targets, contrast, copy rules, counts."""
import glob
import os
import re
from html.parser import HTMLParser
from pathlib import Path
from v5_kit import TOKENS

HERE = os.path.dirname(os.path.abspath(__file__))
BOARDS = sorted(glob.glob(os.path.join(HERE, "project", "V5-*.dc.html")))


def lum(hex_):
    h = hex_.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


class Scan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.unnamed = []
        self.small = []
        self.phones = 0
        self.text = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class", "") or ""
        if "ph" in cls.split():
            self.phones += 1
        interactive = tag == "button" or a.get("role") in ("button", "switch", "checkbox", "slider", "tab", "radio", "menuitemradio")
        if interactive:
            st = a.get("style", "") or ""
            w = re.search(r"(?<![-\w])width:(\d+)px", st)
            h = re.search(r"(?<![-\w])height:(\d+)px", st)
            if (w and int(w.group(1)) < 48 and "sw" not in cls) or (h and int(h.group(1)) < 40):
                self.small.append(f"<{tag} class='{cls}' style='{st[:60]}'>")
        hidden = a.get("aria-hidden") == "true" or (bool(self.stack) and bool(self.stack[-1][4]))
        if tag in ("img", "input", "br", "meta", "link"):
            return
        self.stack.append([tag, a, interactive, "", hidden])

    def handle_endtag(self, tag):
        while self.stack:
            t, a, inter, txt, hid = self.stack.pop()
            if self.stack and not hid:
                self.stack[-1][3] += txt
            if t == tag:
                if inter and not (a.get("aria-label") or txt.strip()):
                    self.unnamed.append(f"<{t} class='{a.get('class', '')}'>")
                break

    def handle_data(self, data):
        if self.stack and not self.stack[-1][4]:
            self.stack[-1][3] += data
        self.text.append(data)


def main():
    out = ["# V6 scripted audit", "", "Static source audit, not device or screen-reader evidence. Targets below inspect inline sizes; CSS/layout and artwork contrast still need visual review.", ""]
    weights, tracking, upper, emoji, grads = set(), [], 0, [], 0
    total_phones = 0
    unnamed_all, small_all = [], []
    for f in BOARDS:
        s = open(f, encoding="utf-8").read()
        name = os.path.basename(f)
        css_and_inline = s
        for m in re.finditer(r"font-weight:\s*(\d{3})", css_and_inline):
            weights.add(m.group(1))
        for m in re.finditer(r"font:\s*(\d{3})\s", css_and_inline):
            weights.add(m.group(1))
        for m in re.finditer(r"letter-spacing:\s*([^;\"}]+)", s):
            if m.group(1).strip() not in ("0", "4px"):
                tracking.append((name, m.group(1)))
        upper += len(re.findall(r"text-transform:\s*uppercase", s))
        body = s.split("</helmet>", 1)[1]
        texts = re.sub(r"<[^>]+>", " ", body)
        emoji += [(name, ch) for ch in set(re.findall(r"[\U0001F300-\U0001FAFF☀-➿]", texts)) if ch not in "✦"]
        grads += len(re.findall(r"linear-gradient", body))
        sc = Scan()
        sc.feed(body)
        total_phones += sc.phones
        unnamed_all += [(name, u) for u in sc.unnamed]
        small_all += [(name, x) for x in sc.small]
    out.append(f"- Boards: {len(BOARDS)}; phone frames: {total_phones}")
    # Keep the static design kit aligned with the app's runtime source of truth.
    runtime = (Path(HERE).parents[2] / 'apps/mobile/src/constants/allegraTheme.ts').read_text(encoding='utf-8')
    aliases = dict(base='bg', raised='bgSubtle', control='control', pressed='pressed', t1='ink', t2='inkSoft', t3='inkMuted', danger='danger')
    mismatches = []
    for design, app in aliases.items():
        match = re.search(r'\b' + app + r':\s*[\'"](#\w{6})[\'"]', runtime)
        if not match or match.group(1).lower() != TOKENS[design].lower():
            mismatches.append(f'{design} / {app}')
    out.append(f"- Design/runtime palette parity: {'FAIL ' + ', '.join(mismatches) if mismatches else 'pass'}")
    ok_w = weights <= {"400", "600", "700"}
    out.append(f"- Font weights used: {sorted(weights)} → {'pass' if ok_w else 'FAIL'} (only 400/600/700 ship in the app)")
    out.append(f"- Letter spacing other than the room code: {len(tracking)} → {'pass' if not tracking else 'FAIL ' + str(tracking[:5])}")
    out.append(f"- Uppercase transforms: {upper} → {'pass' if not upper else 'FAIL'}")
    out.append(f"- Emoji in UI text: {len(emoji)} → {'pass' if not emoji else 'FAIL ' + str(emoji[:5])}")
    out.append(f"- Interactive elements without a name: {len(unnamed_all)} → {'pass' if not unnamed_all else 'FAIL'}")
    for n, u in unnamed_all[:15]:
        out.append(f"  - {n}: {u}")
    out.append(f"- Interactive elements drawn under 48 wide / 40 tall: {len(small_all)} → {'pass' if not small_all else 'check'}")
    for n, u in small_all[:15]:
        out.append(f"  - {n}: {u}")
    out.append(f"- linear-gradient uses (generated covers, artist photo fade only): {grads}")
    out.append("")
    out.append("## Contrast (WCAG 2.2 1.4.3 for text, 1.4.11 for UI parts)")
    pairs = [("Text 1 #F4F4F5", "#F4F4F5"), ("Text 2 #A3A5AE", "#A3A5AE"), ("Text 3 #8A8D96", "#8A8D96"), ("Danger #FF6B61", "#FF6B61")]
    bgs = [("Base #0B0D10", "#0B0D10"), ("Raised #17191E", "#17191E"), ("Control #22252C", "#22252C"), ("Toast #2A2D34", "#2A2D34")]
    out.append("| Text | " + " | ".join(b[0] for b in bgs) + " |")
    out.append("|---|" + "---|" * len(bgs))
    for tn, tc in pairs:
        out.append(f"| {tn} | " + " | ".join(f"{ratio(tc, bc):.1f}" for _, bc in bgs) + " |")
    out.append(f"| Base text on white button | {ratio('#0B0D10', '#F4F4F5'):.1f} | | | |")
    out.append(f"| Danger on danger-tint button (≈#3A1E1F) | {ratio('#FF6B61', '#3A1E1F'):.1f} | | | |")
    out.append(f"| Selected-tab underline / switch on vs base (UI part) | {ratio('#F4F4F5', '#0B0D10'):.1f} | | | |")
    out.append(f"| Off-switch outline #8A8D96 vs control (UI part, 3:1 needed) | {ratio('#8A8D96', '#22252C'):.1f} | | | |")
    out.append(f"| Off-switch thumb #8A8D96 vs control | {ratio('#8A8D96', '#22252C'):.1f} | | | |")
    out.append(f"| Progress track #2A2D34 vs raised (decorative; the fill carries meaning) | {ratio('#2A2D34', '#17191E'):.1f} | | | |")
    out.append(f"| Lyrics non-sung line, 26 bold = large text, 3:1 needed (42% white ≈#6E7074) vs base | {ratio('#6E7074', '#0B0D10'):.1f} | | | |")
    rep = "\n".join(out) + "\n"
    open(os.path.join(HERE, "audit-v5.md"), "w", encoding="utf-8").write(rep)
    print(rep)
    if mismatches or not ok_w or tracking or upper or emoji or unnamed_all:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
