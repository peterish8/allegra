"""Self-contained, phone-scale review pages for the HTML preview tool (no server).

python v6_review.py [board-name ...] > review.html
Uses the actual gallery HTML; only embeds assets and changes board furniture.
"""
from pathlib import Path
from html.parser import HTMLParser
import base64
import io
import json
import re
import sys
import logging
from PIL import Image
from fontTools import subset
logging.getLogger('fontTools').setLevel(logging.ERROR)

GALLERY = Path(__file__).parent.parent / 'design-gallery'


class Cells(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.depth = 0
        self.start = None
        self.cells = []
        self.offsets = [0]
        for m in re.finditer('\n', source):
            self.offsets.append(m.end())

    def index(self):
        line, col = self.getpos()
        return self.offsets[line - 1] + col

    def handle_starttag(self, tag, attrs):
        if tag != 'div':
            return
        if self.start is not None:
            self.depth += 1
        elif 'cell' in dict(attrs).get('class', '').split():
            self.start = self.index()
            self.depth = 1

    def handle_endtag(self, tag):
        if tag == 'div' and self.start is not None:
            self.depth -= 1
            if not self.depth:
                self.cells.append(self.source[self.start:self.index() + len('</div>')])
                self.start = None


def review(names, limit=0, offset=0):
    sections = []
    all_cells = []
    head = ''
    for name in names:
        source = (GALLERY / f'{name}.html').read_text(encoding='utf-8')
        head = source.split('<head>', 1)[1].split('</head>', 1)[0]
        parser = Cells(source)
        parser.feed(source)
        cells = parser.cells[offset:offset + limit] if limit else parser.cells[offset:]
        all_cells.extend(cells)
        sections.append(f'<section><h2>{name}</h2><div class="board">' + ''.join(cells) + '</div></section>')
    body = ''.join(sections)
    glyphs = {int(g) for g in re.findall(r'&#(\d+);', body)}
    font = subset.load_font(str(GALLERY / 'assets/Ionicons.ttf'), subset.Options())
    worker = subset.Subsetter()
    worker.populate(unicodes=glyphs)
    worker.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    head = head.replace('url(assets/Ionicons.ttf)', 'url(data:font/ttf;base64,' + base64.b64encode(buf.getvalue()).decode() + ')')
    assets = {}
    for name in set(re.findall(r'[a-z-]+\.jpg', body)):
        image = Image.open(GALLERY / name)
        image.thumbnail((256, 256))
        data = io.BytesIO()
        image.save(data, format='JPEG', quality=78)
        assets[name] = 'data:image/jpeg;base64,' + base64.b64encode(data.getvalue()).decode()
    # Data repeated in src attributes would exceed the preview tool's size limit.
    # Resolve src before parsing the body so the browser never requests relative images.
    body = re.sub(r'src="([a-z-]+\.jpg)"', r'data-cover="\1"', body)
    for name, data in assets.items():
        body = body.replace('url(' + name + ')', 'url(' + data + ')')
    script = '<script>const assets=' + json.dumps(assets) + ';document.querySelectorAll("[data-cover]").forEach(i=>{i.src=assets[i.dataset.cover]});document.querySelectorAll("[style]").forEach(e=>{let s=e.getAttribute("style");for(const [n,u] of Object.entries(assets))s=s.replaceAll(n,u);e.setAttribute("style",s)});</script>'
    css = '<style>html,body{background:transparent!important}.board{display:grid;grid-template-columns:repeat(3,max-content);padding:0;gap:24px}.cap{height:108px}section>h2{margin:20px 0;font:600 18px system-ui}section{margin-bottom:24px}</style>'
    return '<!doctype html><html><head>' + head + css + '</head><body>' + body + script + '</body></html>'


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    names = [n for n in sys.argv[1:] if not n.startswith('--')]
    limit = int(next((n.split('=')[1] for n in sys.argv[1:] if n.startswith('--limit=')), '0'))
    offset = int(next((n.split('=')[1] for n in sys.argv[1:] if n.startswith('--offset=')), '0'))
    print(review(names or ['V5-Responsive'], limit, offset))
