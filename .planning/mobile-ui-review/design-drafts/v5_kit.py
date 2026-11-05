"""LuvLyrics redesign, round 5: the design system as code.

Every board is built from these tokens and components, so a change here changes every screen.
Nothing in this file is app code; it renders mockups for the Design canvas.
"""
from html import escape as esc

# ---------------------------------------------------------------- tokens
TOKENS = {
    "base": "#0B0D10",      # page
    "raised": "#17191E",    # shell, sheets, fields
    "control": "#22252C",   # secondary buttons, chips, sort
    "pressed": "#2A2D34",   # pressed rows, toasts, progress track
    "t1": "#F4F4F5",        # primary text, the one primary action
    "t2": "#A3A5AE",        # secondary text, idle icons
    "t3": "#8A8D96",        # tertiary text: hints, placeholders (passes 4.5:1 on base and raised)
    "danger": "#FF6B61",    # destructive only
}

COVERS = {
    "low-tide": "02316c7dda6de4813b5e72088faae3cf",
    "golden-hour": "16f9f309d813cf2399715dd3c34f6d9a",
    "paper-lanterns": "0dc4f7bf0bc5a28e32fa4938e355182c",
    "static-rain": "74f23f1848c6d7e932d5d628b033f576",
    "small-hours": "80224f83fc614ceab8ebe2fc0d545939",
    "night-drive": "434b7a8267d07e303d359e48e3568765",
    "mira-vale": "fd73afff29511e822acce85d9fb77dc8",
    "baarish": "a28a4910c4101fff1cdaca12e592f638",
    "fade": "ea11274cd3d13d724014f84d61a8c141",
    "daily-mix": "4df23e692f869f66f7cb10047bdc6679",
}

# Two tones per cover for the artwork atmosphere (the app reads these from the cover at runtime).
TONES = {
    "low-tide": ("#1d4e6e", "#4f8db8"), "night-drive": ("#3a2b63", "#5a2430"),
    "golden-hour": ("#7a4a12", "#9a3a22"), "small-hours": ("#0f4c5c", "#2b6a7c"),
    "mira-vale": ("#2a2440", "#5b4a7c"), "paper-lanterns": ("#4b2a6c", "#8a3f6b"),
    "baarish": ("#1f4a3a", "#2f5a6a"), "static-rain": ("#2a3440", "#4a5664"),
    "fade": ("#4a1f5c", "#7a2f5c"), "daily-mix": ("#3a4a1f", "#5a6a2a"),
}


def cov(name):
    return f"/_blob/{COVERS[name]}"


SONGS = {
    "low": ("Low Tide", "Harbor Kids", "3:41", "low-tide", False),
    "baarish": ("Baarish (Monsoon Version) [feat. Aditi Rao]", "Kabir & The Monsoons", "5:12", "baarish", True),
    "static": ("Static in the Rain", "Orla North", "4:05", "static-rain", False),
    "small": ("Small Hours", "Mira Vale", "2:58", "small-hours", True),
    "lanterns": ("Paper Lanterns", "Mira Vale", "3:33", "paper-lanterns", False),
    "fade": ("Fade", "Neon Choir", "3:20", "fade", False),
    "golden": ("Golden Hour Again", "Sunny Arcade", "3:12", "golden-hour", True),
    "drive": ("Night Drive", "The Overpass", "4:18", "night-drive", False),
    "mix": ("Monsoon Mornings", "Kabir & The Monsoons", "3:56", "daily-mix", False),
}

CSS = """
:root{--base:#0B0D10;--raised:#17191E;--control:#22252C;--pressed:#2A2D34;--t1:#F4F4F5;--t2:#A3A5AE;--t3:#8A8D96;--div:rgba(255,255,255,.06);--danger:#FF6B61;--scrim:rgba(0,0,0,.4)}
*{box-sizing:border-box}
body{margin:0;background:#202226;font-family:Inter,system-ui,sans-serif;color:var(--t1);-webkit-font-smoothing:antialiased}
button,input,textarea{font-family:inherit;color:inherit}
h1,h2,h3,p,ul,ol{margin:0;padding:0}
ul,ol{list-style:none}
.ms{font-family:'Material Symbols Rounded';font-weight:400;font-style:normal;font-size:24px;line-height:1;display:inline-block;white-space:nowrap;direction:ltr;font-feature-settings:'liga';font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;flex-shrink:0}
.ms.f{font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24}

/* board furniture (annotation, not UI) */
.board{display:inline-flex;gap:40px;padding:28px 32px 40px;align-items:flex-start}
.cell{width:390px;display:flex;flex-direction:column;gap:14px;flex-shrink:0}
.cap{height:124px;overflow:hidden;font:600 14px/19px Inter;color:#E8E9EC}
.cap p{margin-top:4px;font-weight:400;font-size:12px;line-height:17px;color:#9EA1AA}
.cap .pr{color:#F2C14E}
.cap .gap{color:#FF8A80}

/* phone */
.ph{position:relative;width:390px;height:844px;border-radius:36px;overflow:hidden;background:var(--base);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 30px 60px rgba(0,0,0,.35)}
.scr{position:absolute;inset:0;padding-top:28px;overflow:hidden;display:flex;flex-direction:column}
.sb{position:absolute;top:0;left:0;right:0;height:28px;display:flex;justify-content:space-between;align-items:center;padding:0 18px 0 24px;font:600 12px Inter;z-index:80;pointer-events:none}
.sb .ms{font-size:15px;margin-left:3px}
.gb{position:absolute;left:0;right:0;bottom:0;height:16px;display:flex;align-items:center;justify-content:center;z-index:90;pointer-events:none}
.gb i{width:108px;height:4px;border-radius:2px;background:rgba(255,255,255,.42)}
.glow{position:absolute;left:-60px;top:-150px;width:510px;height:430px;filter:blur(70px);opacity:.5;pointer-events:none}
.glow i{position:absolute;border-radius:50%}
.glow.np{top:-120px;height:620px;opacity:.75}

/* headers */
.top{display:flex;align-items:center;height:56px;padding:0 4px;flex-shrink:0}
.top .tt{flex:1;min-width:0;font:600 18px/24px Inter;padding-left:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.page{display:flex;align-items:center;height:56px;padding:0 4px 0 16px;flex-shrink:0}
.page h1{flex:1;font:700 28px/34px Inter}
.sec{display:flex;align-items:center;justify-content:space-between;height:48px;padding:0 4px 0 16px;margin-top:8px}
.sec h2{font:600 18px/24px Inter}
.ib{width:48px;height:48px;display:flex;align-items:center;justify-content:center;border:0;background:none;color:var(--t1);padding:0;flex-shrink:0;position:relative}
.ib.m{color:var(--t2)}
.dot{position:absolute;top:10px;right:10px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--t1);color:var(--base);font:700 10px/16px Inter;text-align:center;box-shadow:0 0 0 2px var(--base)}

/* text roles */
.meta{font:400 13px/18px Inter;color:var(--t2)}
.body{font:400 15px/22px Inter;color:var(--t2)}
.lead{font:700 20px/26px Inter}
.cap12{font:400 12px/16px Inter;color:var(--t3)}

/* tabs and chips */
.tabs{display:flex;gap:24px;height:48px;padding:0 16px;box-shadow:inset 0 -1px 0 var(--div);flex-shrink:0}
.tab{position:relative;height:48px;border:0;background:none;padding:0;font:400 15px Inter;color:var(--t2);white-space:nowrap}
.tab.on{font-weight:600;color:var(--t1)}
.tab.on::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;border-radius:1px;background:var(--t1)}
.chips{display:flex;gap:8px;padding:0 16px;flex-shrink:0;overflow:hidden}
.chip{height:48px;display:flex;align-items:center;border:0;background:none;padding:0;flex-shrink:0}
.chip>span{display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:8px;background:var(--control);font:400 13px Inter;color:var(--t1);white-space:nowrap}
.chip.on>span{background:var(--t1);color:var(--base);font-weight:600;padding-left:8px}
.chip .ms{font-size:18px}

/* fields and sort */
.field{display:flex;align-items:center;gap:8px;height:48px;padding:0 4px 0 12px;border-radius:12px;background:var(--raised);color:var(--t2);flex-shrink:0}
.field .ms{font-size:20px}
.field input,.field .v{flex:1;min-width:0;border:0;background:none;font:400 15px Inter;color:var(--t1);outline:none;white-space:nowrap;overflow:hidden}
.field .ph-t{color:var(--t3)}
.field.focus{box-shadow:inset 0 0 0 1.5px var(--t1)}
.caret{display:inline-block;width:1.5px;height:18px;background:var(--t1);vertical-align:-3px;margin-left:1px}
.sortb{height:48px;display:flex;align-items:center;border:0;background:none;padding:0;flex-shrink:0}
.sortb>span{display:flex;align-items:center;gap:6px;height:36px;padding:0 8px 0 10px;border-radius:8px;background:var(--control);font:600 13px Inter;color:var(--t1)}
.sortb .ms{font-size:18px}
.sortb .ms.c{color:var(--t2)}
.lbl{font:600 13px/18px Inter;color:var(--t2);padding:0 16px}

/* buttons */
.btn{display:flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;border:0;border-radius:12px;font:600 15px Inter;white-space:nowrap;flex-shrink:0}
.btn .ms{font-size:20px}
.btn.p{background:var(--t1);color:var(--base)}
.btn.s{background:var(--control);color:var(--t1)}
.btn.t{background:none;color:var(--t1);padding:0 12px}
.btn.d{background:rgba(255,107,97,.14);color:var(--danger)}
.btn.dis{opacity:.38}
.btn.blk{width:100%}
.btn.sm{height:48px;padding:0 12px;font-size:14px}
.btn.sm>span.v{display:flex;align-items:center;gap:6px;height:36px}
.btns{display:flex;gap:12px;padding:0 16px;flex-shrink:0}
.btns .btn{flex:1}
.btns[style*="column"] .btn{flex:none}

/* song row: one component, every list */
.row{display:flex;align-items:center;gap:12px;height:64px;padding:0 4px 0 16px;flex-shrink:0}
.row.nm{padding-right:16px}
.row.pr{background:rgba(255,255,255,.06)}
.aw{position:relative;width:48px;height:48px;flex-shrink:0}
.art{width:48px;height:48px;border-radius:8px;object-fit:cover;display:block;flex-shrink:0}
.art.c{border-radius:50%}
.gen{display:flex;align-items:center;justify-content:center;font:700 20px Inter;color:rgba(255,255,255,.78)}
.bdg{position:absolute;right:-4px;bottom:-4px;width:22px;height:22px;border-radius:11px;background:var(--t1);color:var(--base);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px var(--base)}
.bdg .ms{font-size:15px}
.bdg.pa{background:var(--control);color:var(--t1)}
.rt{flex:1;min-width:0;height:64px;display:flex;flex-direction:column;justify-content:center;box-shadow:inset 0 -1px 0 var(--div)}
.row.last .rt{box-shadow:none}
.rt b{font:400 15px/20px Inter;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row.on .rt b{font-weight:600}
.rt s{text-decoration:none;font:400 13px/18px Inter;color:var(--t2);display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden}
.rt s .ms{font-size:14px}
.rt s em{font-style:normal;overflow:hidden;text-overflow:ellipsis}
.row.un .art,.row.un .rt b{opacity:.45}
.row.dis{opacity:.4}
.num{width:24px;text-align:center;font:400 15px Inter;color:var(--t2);font-variant-numeric:tabular-nums;flex-shrink:0}
.ring{width:14px;height:14px;border-radius:50%;border:2px solid #3A3D45;border-top-color:var(--t1);border-right-color:var(--t1);flex-shrink:0}
.ring.lg{width:22px;height:22px;border-width:2.5px}

/* list rows for menus, settings, hubs */
.li{display:flex;align-items:center;gap:16px;min-height:56px;padding:4px 4px 4px 16px;flex-shrink:0}
.li>.ms{color:var(--t2)}
.li .lt{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;padding:6px 0}
.li .lt b{font:400 15px/20px Inter}
.li .lt s{text-decoration:none;font:400 13px/18px Inter;color:var(--t2)}
.li .val{font:400 14px Inter;color:var(--t2);white-space:nowrap}
.li .chev{color:var(--t3);width:40px;text-align:center}
.li.d,.li.d>.ms{color:var(--danger)}
.grp{padding:8px 0}
.gt{font:600 13px/18px Inter;color:var(--t2);padding:16px 16px 4px}
.hr{height:1px;background:var(--div);margin:8px 16px;flex-shrink:0}
.sw{width:52px;height:32px;border-radius:16px;background:var(--control);box-shadow:inset 0 0 0 2px var(--t3);position:relative;flex-shrink:0;margin-right:12px}
.sw i{position:absolute;left:8px;top:8px;width:16px;height:16px;border-radius:8px;background:var(--t3)}
.sw.on{background:var(--t1);box-shadow:none}
.sw.on i{left:24px;top:4px;width:24px;height:24px;border-radius:12px;background:var(--base)}

/* sheets, scrim, toast */
.scrim{position:absolute;inset:0;background:var(--scrim);z-index:50}
.sheet{position:absolute;left:0;right:0;bottom:0;z-index:60;background:var(--raised);border-radius:16px 16px 0 0;padding:8px 0 24px;display:flex;flex-direction:column}
.sheet.deep{background:#0D0F12;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.gr{align-self:center;width:32px;height:4px;border-radius:2px;background:#3A3D45;margin-bottom:4px;flex-shrink:0}
.sh{display:flex;align-items:center;gap:12px;min-height:56px;padding:0 4px 0 16px;flex-shrink:0}
.sh h2{flex:1;font:600 18px/24px Inter}
.sh .id{flex:1;min-width:0;display:flex;flex-direction:column}
.sh .id b{font:600 16px/21px Inter;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.opt{display:flex;align-items:center;gap:16px;min-height:52px;padding:0 16px;border:0;background:none;width:100%;text-align:left;font:400 15px Inter;color:var(--t1);flex-shrink:0}
.opt>.ms:first-child{color:var(--t2)}
.opt .ot{flex:1;min-width:0;display:flex;flex-direction:column;padding:6px 0}
.opt .ot small{font:400 13px/18px Inter;color:var(--t2)}
.opt.on{font-weight:600}
.opt.d,.opt.d>.ms:first-child{color:var(--danger)}
.opt .ck{margin-left:auto}
.toast{position:absolute;left:12px;right:12px;z-index:45;min-height:48px;border-radius:12px;background:rgba(42,45,52,.88);backdrop-filter:blur(20px) saturate(1.3);display:flex;align-items:center;gap:12px;padding:0 4px 0 16px;font:400 14px/20px Inter;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.toast .x{flex:1}

/* top glow: the playing song's cover, blurred once, fading out by ~20% of the screen */
.tg{position:absolute;left:0;right:0;top:0;height:270px;overflow:hidden;pointer-events:none;
    -webkit-mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.55) 50%,transparent 100%);mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.55) 50%,transparent 100%)}
.tg img{position:absolute;left:-70px;top:-150px;width:calc(100% + 140px);height:420px;object-fit:cover;filter:blur(54px) saturate(2) brightness(1.15);opacity:.85}

/* frost: a dark tint over the playing cover blurred once (no live blur of scrolling content) */
.frost{position:absolute;inset:0;overflow:hidden;pointer-events:none;background:#121418}
.frost img{position:absolute;left:-40px;top:-60px;width:calc(100% + 80px);height:calc(100% + 120px);object-fit:cover;filter:blur(36px) saturate(1.8) brightness(1.1);opacity:.6}
.frost i{position:absolute;inset:0;background:rgba(18,20,24,.58)}
.frost.solid img,.frost.solid i{display:none}
.frost.solid{background:var(--raised)}

/* shell: mini player + navigation, one anchored surface */
.shell{position:absolute;left:0;right:0;bottom:0;background:transparent;z-index:20;box-shadow:inset 0 1px 0 rgba(255,255,255,.07)}
.shell>*:not(.frost){position:relative}
.pg{height:2px;background:var(--pressed);overflow:hidden}
.pg i{display:block;height:2px;background:var(--t1)}
.pg.ind i{width:30%;margin-left:35%;background:var(--t2)}
.mini{display:flex;align-items:center;gap:4px;height:64px;padding:0 4px 0 16px}
.mini .id{flex:1;min-width:0;display:flex;align-items:center;gap:12px;height:64px}
.mini .art{width:44px;height:44px}
.mini .tx{display:flex;flex-direction:column;min-width:0}
.mini b{font:600 15px/20px Inter;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mini s{text-decoration:none;font:400 13px/18px Inter;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px}
.mini s.err{color:var(--t1)}
.mini s .ms{font-size:15px}
.nav{display:grid;grid-template-columns:repeat(5,1fr);height:80px;padding-bottom:16px;border-top:1px solid var(--div)}
.nav.top0{border-top:0}
.nv{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:400 12px Inter;color:var(--t2);border:0;background:none;padding:0}
.nv .ind{display:flex;align-items:center;justify-content:center;width:56px;height:30px;border-radius:10px}
.nv.on{color:var(--t1);font-weight:600}
.nv.on .ind{background:rgba(255,255,255,.13)}

/* keyboard (system) */
.kb{position:absolute;left:0;right:0;bottom:0;z-index:70;background:#1B1C1F;padding:6px 3px 20px}
.kb .sug{display:flex;justify-content:space-around;height:40px;align-items:center;font:400 15px Inter;color:var(--t2)}
.kb .kr{display:flex;justify-content:center;gap:5px;margin-top:9px}
.kb .k{width:33px;height:44px;border-radius:6px;background:#2E3034;display:flex;align-items:center;justify-content:center;font:400 18px Inter;color:var(--t1)}
.kb .k.w{width:52px;background:#3A3D42}
.kb .k.sp{width:170px}
.kb .k.go{width:52px;background:#A8C7FA;color:#062E6F}

/* empty, loading, error */
.empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:0 32px}
.empty .ei{width:64px;height:64px;border-radius:16px;background:var(--control);display:flex;align-items:center;justify-content:center;color:var(--t2);margin-bottom:8px}
.empty .ei .ms{font-size:32px}
.sk{background:var(--control);border-radius:6px}
.skrow{display:flex;align-items:center;gap:12px;height:64px;padding:0 16px}

/* cards and grids */
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 12px;padding:8px 16px}
.card .cv{width:100%;aspect-ratio:1;border-radius:12px;object-fit:cover;display:block}
.card b{display:block;margin-top:8px;font:400 15px/20px Inter;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card s{display:block;text-decoration:none;font:400 13px/18px Inter;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mos{display:grid;grid-template-columns:1fr 1fr;border-radius:12px;overflow:hidden;aspect-ratio:1}
.mos img{width:100%;height:100%;object-fit:cover;display:block}
.shelf{display:flex;gap:12px;padding:0 16px;overflow:hidden;flex-shrink:0}
.shelf .card{width:136px;flex-shrink:0}
.tile{display:flex;align-items:center;justify-content:center;background:var(--control);color:var(--t1)}
.av{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;font:600 15px Inter;color:#fff;flex-shrink:0;box-shadow:0 0 0 2px var(--base)}
.code{font:700 34px/40px Inter;letter-spacing:4px;font-variant-numeric:tabular-nums}

/* 200% system font scale (Android scales large text less: 28 -> 42) */
.x2 .page h1{font-size:42px;line-height:50px}
.x2 .page{height:auto;min-height:64px}
.x2 .tab{font-size:26px}
.x2 .tabs{height:64px;overflow:hidden}
.x2 .tab{height:64px}
.x2 .field{height:auto;min-height:60px}
.x2 .field .v{font-size:28px;line-height:36px}
.x2 .sortb>span{height:auto;min-height:44px;font-size:24px;line-height:30px;padding:6px 10px}
.x2 .btn{font-size:26px;height:auto;min-height:56px}
.x2 .row{height:auto;min-height:64px;padding-top:6px;padding-bottom:6px;align-items:flex-start}
.x2 .rt{height:auto;padding:4px 0 10px}
.x2 .rt b{font-size:30px;line-height:38px;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.x2 .rt s{font-size:26px;line-height:32px;white-space:normal}
.x2 .mini b{font-size:24px;line-height:30px}
.x2 .mini s{font-size:20px;line-height:26px}
.x2 .nv{font-size:15px}
.x2 .bl{display:none}
"""

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&amp;display=block">
<style>{css}</style>
</helmet>
"""

TAIL = """
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
renderVals() {{ return {{}}; }}
}}
</script>
</body>
</html>
"""


# ---------------------------------------------------------------- primitives
def ic(name, fill=False, size=None, color=None, cls=""):
    st = []
    if size:
        st.append(f"font-size:{size}px")
    if color:
        st.append(f"color:{color}")
    s = f' style="{";".join(st)}"' if st else ""
    return f'<span class="ms{" f" if fill else ""}{" " + cls if cls else ""}" aria-hidden="true"{s}>{name}</span>'


def ib(icon, label, fill=False, muted=False, badge=None, size=None, pressed=None):
    p = f' aria-pressed="{str(pressed).lower()}"' if pressed is not None else ""
    b = f'<span class="dot" aria-hidden="true">{badge}</span>' if badge else ""
    return f'<button class="ib{" m" if muted else ""}" aria-label="{esc(label)}"{p}>{ic(icon, fill, size)}{b}</button>'


def btn(label, kind="p", icon=None, fill_icon=False, extra="", block=False, aria=None):
    cls = f"btn {kind}{' blk' if block else ''}{(' ' + extra) if extra else ''}"
    a = f' aria-label="{esc(aria)}"' if aria else ""
    return f'<button class="{cls}"{a}>{ic(icon, fill_icon) if icon else ""}{esc(label)}</button>'


def art(cover, size=48, radius=None, circle=False, alt=""):
    st = f"width:{size}px;height:{size}px" + (f";border-radius:{radius}px" if radius is not None else "")
    return f'<img class="art{" c" if circle else ""}" src="{cov(cover)}" alt="{esc(alt)}" style="{st}">'


def gen_art(letter, tones=("#3b3f6b", "#6b3b5c"), size=48, radius=8):
    """The app's generated cover (duotone + monogram) for songs with no artwork. Never a grey box."""
    return (f'<span class="art gen" aria-hidden="true" style="width:{size}px;height:{size}px;border-radius:{radius}px;'
            f'background:linear-gradient(135deg,{tones[0]},{tones[1]});font-size:{int(size * 0.42)}px">{esc(letter)}</span>')


def mosaic(covers, size=None, radius=12):
    st = f' style="width:{size}px;border-radius:{radius}px"' if size else ""
    return f'<span class="mos"{st} aria-hidden="true">' + "".join(f'<img src="{cov(c)}" alt="">' for c in covers[:4]) + "</span>"


def glow(cover, np=False, opacity=None):
    a, b = TONES[cover]
    o = f' style="opacity:{opacity}"' if opacity is not None else ""
    if np:
        return (f'<div class="glow np" aria-hidden="true"{o}><i style="left:20px;top:80px;width:320px;height:340px;background:{a}"></i>'
                f'<i style="left:230px;top:40px;width:280px;height:300px;background:{b}"></i>'
                f'<i style="left:60px;top:380px;width:360px;height:200px;background:{a};opacity:.6"></i></div>')
    return (f'<div class="glow" aria-hidden="true"{o}><i style="left:60px;top:70px;width:230px;height:220px;background:{a}"></i>'
            f'<i style="left:240px;top:50px;width:220px;height:200px;background:{b}"></i></div>')


def song_row(key, state=None, trailing="more", meta=None, last=False, num=None, pressed=False, circle=False):
    """state: None | playing | paused | selected | unselected | unavailable | disabled | downloading | noart"""
    title, artist, dur, cover, dl = SONGS[key]
    cls = "row"
    if state in ("playing", "paused"):
        cls += " on"
    if state == "unavailable":
        cls += " un"
    if state == "disabled":
        cls += " dis"
    if last:
        cls += " last"
    if pressed:
        cls += " pr"
    if trailing is None:
        cls += " nm"
    # leading
    if num is not None:
        lead = f'<span class="num" aria-hidden="true">{num}</span>'
    elif state == "noart" or cover is None:
        lead = gen_art(title[0])
    else:
        a = art(cover, circle=circle)
        if state == "playing":
            lead = f'<span class="aw">{a}<span class="bdg" aria-hidden="true">{ic("graphic_eq")}</span></span>'
        elif state == "paused":
            lead = f'<span class="aw">{a}<span class="bdg pa" aria-hidden="true">{ic("graphic_eq")}</span></span>'
        else:
            lead = a
    # meta line
    bits = []
    if meta is None:
        if dl and state not in ("unavailable",):
            bits.append(ic("download_done", True))
        m = artist
        if state == "playing":
            m += " · Playing"
        elif state == "paused":
            m += " · Paused"
        elif state == "unavailable":
            bits = [ic("error")]
            m = "Can’t play right now"
        elif state == "downloading":
            bits = ['<span class="ring" aria-hidden="true"></span>']
            m = "Saving · 40%"
        elif state == "disabled":
            m = artist + " · Already in this playlist"
    else:
        m = meta
    meta_html = "".join(bits) + f"<em>{esc(m)}</em>"
    label = f"{title}, {artist}" + (", now playing" if state == "playing" else ", paused" if state == "paused" else "") + (", downloaded" if dl else "")
    # trailing
    if trailing == "more":
        tr = ib("more_vert", f"More actions for {title}", muted=True)
    elif trailing == "drag":
        tr = ib("drag_indicator", f"Move {title}", muted=True)
    elif trailing == "check":
        on = state == "selected"
        tr = (f'<button class="ib{"" if on else " m"}" role="checkbox" aria-checked="{str(on).lower()}" aria-label="Select {esc(title)}">'
              f'{ic("check_circle" if on else "radio_button_unchecked", on)}</button>')
    elif trailing == "close":
        tr = ib("close", f"Remove {title} from recent searches", muted=True, size=20)
    else:
        tr = ""
    return (f'<li class="{cls}">{lead}<button class="rt" style="border:0;background:none;padding:0;text-align:left;color:inherit" '
            f'aria-label="{esc(label)}"><b>{esc(title)}</b><s>{meta_html}</s></button>{tr}</li>')


def status_bar(time="9:41"):
    return (f'<div class="sb" aria-hidden="true"><span>{time}</span><span>{ic("signal_cellular_alt", True)}'
            f'{ic("wifi", True)}{ic("battery_full", True)}</span></div>')


GESTURE = '<div class="gb" aria-hidden="true"><i></i></div>'

NAV = [("stream", "Stream", "radio"), ("luvs", "Luvs", "favorite"), ("library", "Library", "library_music"),
       ("search", "Search", "search"), ("you", "You", "account_circle")]

SHELL_H = {"full": 146, "nav": 81, "none": 16}


def nav_bar(active, top_border=True):
    items = []
    for key, label, icon in NAV:
        on = key == active
        cur = ' aria-current="page"' if on else ""
        items.append(f'<button class="nv{" on" if on else ""}"{cur}><span class="ind">{ic(icon, on)}</span>{label}</button>')
    return f'<nav class="nav{"" if top_border else " top0"}" aria-label="Main">' + "".join(items) + "</nav>"


def mini_player(state="playing", song="low", progress=38):
    title, artist, _, cover, _ = SONGS[song]
    if state == "buffering":
        pg = '<div class="pg ind" aria-hidden="true"><i></i></div>'
        sub = f"<s>{esc(artist)}</s>"
        ctrl = ('<button class="ib" aria-label="Loading, tap to pause" aria-busy="true"><span class="ring lg" aria-hidden="true"></span></button>'
                + ib("skip_next", "Next song", True))
    elif state == "remote":
        pg = f'<div class="pg" aria-hidden="true"><i style="width:{progress}%"></i></div>'
        sub = f'<s>{ic("computer")}Playing on Living room PC</s>'
        ctrl = ib("pause", "Pause on Living room PC", True, size=32) + ib("skip_next", "Next song", True)
    elif state == "error":
        pg = f'<div class="pg" aria-hidden="true"><i style="width:{progress}%;background:var(--t2)"></i></div>'
        sub = f'<s class="err">{ic("error")}Couldn’t play. Try again</s>'
        ctrl = ib("refresh", "Try again") + ib("skip_next", "Next song", True)
    else:
        pg = f'<div class="pg" aria-hidden="true"><i style="width:{progress}%"></i></div>'
        sub = f"<s>{esc(artist)}</s>"
        play = state == "playing"
        ctrl = ib("pause" if play else "play_arrow", "Pause" if play else "Play", True, size=32) + ib("skip_next", "Next song", True)
    return (pg + f'<div class="mini" role="group" aria-label="Now playing"><button class="id" style="border:0;background:none;padding:0;color:inherit;text-align:left" '
            f'aria-label="{esc(title)} by {esc(artist)}. Open player">{art(cover, 44)}<span class="tx"><b>{esc(title)}</b>{sub}</span></button>{ctrl}</div>')


def frost(cover=None, solid=False):
    if solid or not cover:
        return '<div class="frost solid" aria-hidden="true"></div>'
    return f'<div class="frost" aria-hidden="true"><img src="{cov(cover)}" alt=""><i></i></div>'


def shell(active="library", mini="playing", song="low", progress=38, solid=False):
    inner = (mini_player(mini, song, progress) if mini else "") + nav_bar(active, top_border=bool(mini))
    cover = SONGS[song][3] if mini else None
    return f'<div class="shell">{frost(cover, solid)}{inner}</div>'


def top_glow(cover="low-tide"):
    return f'<div class="tg" aria-hidden="true"><img src="{cov(cover)}" alt=""></div>'


def sheet(inner, label="Sheet", top=None, extra_style=""):
    st = f' style="top:{top}px;{extra_style}"' if top is not None else (f' style="{extra_style}"' if extra_style else "")
    return f'<section class="sheet" role="dialog" aria-modal="true" aria-label="{esc(label)}"{st}><div class="gr" aria-hidden="true"></div>{inner}</section>'


def opt(icon, label, hint=None, on=False, danger=False, check=False, trailing=None, fill=False):
    cls = "opt" + (" on" if on else "") + (" d" if danger else "")
    lt = f'<span class="ot">{esc(label)}<small>{esc(hint)}</small></span>' if hint else f'<span class="ot">{esc(label)}</span>'
    tr = ""
    if check:
        tr = ic("check", cls="ck") if on else ""
    if trailing:
        tr = trailing
    role = ' role="menuitemradio" aria-checked="' + str(on).lower() + '"' if check else ""
    return f'<button class="{cls}"{role}>{ic(icon, fill) if icon else ""}{lt}{tr}</button>'


def li(icon, label, hint=None, value=None, chevron=True, switch=None, danger=False, lead_html=None):
    lead = lead_html if lead_html is not None else (ic(icon) if icon else "")
    lt = f'<span class="lt"><b>{esc(label)}</b>' + (f"<s>{esc(hint)}</s>" if hint else "") + "</span>"
    tr = ""
    if value:
        tr += f'<span class="val">{esc(value)}</span>'
    if switch is not None:
        tr += f'<span class="sw{" on" if switch else ""}" role="switch" aria-checked="{str(switch).lower()}" aria-label="{esc(label)}"><i></i></span>'
    elif chevron:
        tr += ic("chevron_right", cls="chev")
    return f'<div class="li{" d" if danger else ""}" role="button">{lead}{lt}{tr}</div>'


def toast(text, action=None, bottom=154):
    a = f'<button class="btn t" style="height:48px">{esc(action)}</button>' if action else ""
    return f'<div class="toast" role="status" style="bottom:{bottom}px"><span class="x">{esc(text)}</span>{a}</div>'


def keyboard(suggest=("mira", "Mira", "mirage")):
    rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]
    s = '<div class="kb" aria-hidden="true"><div class="sug">' + "".join(f"<span>{w}</span>" for w in suggest) + "</div>"
    s += '<div class="kr">' + "".join(f'<span class="k">{c}</span>' for c in rows[0]) + "</div>"
    s += '<div class="kr">' + "".join(f'<span class="k">{c}</span>' for c in rows[1]) + "</div>"
    s += ('<div class="kr"><span class="k w">' + ic("keyboard_capslock", size=20) + "</span>" + "".join(f'<span class="k">{c}</span>' for c in rows[2])
          + '<span class="k w">' + ic("backspace", size=20) + "</span></div>")
    s += ('<div class="kr"><span class="k w">?123</span><span class="k">,</span><span class="k sp"></span><span class="k">.</span>'
          f'<span class="k go">{ic("search", size=20)}</span></div></div>')
    return s


def skeleton_rows(n=5, start=0):
    out = []
    for i in range(n):
        w1 = [62, 48, 70, 55, 40, 66, 52][(i + start) % 7]
        w2 = [36, 30, 42, 28, 34, 26, 38][(i + start) % 7]
        out.append(f'<div class="skrow" aria-hidden="true"><span class="sk" style="width:48px;height:48px;border-radius:8px"></span>'
                   f'<span style="flex:1;display:flex;flex-direction:column;gap:8px"><span class="sk" style="width:{w1}%;height:12px"></span>'
                   f'<span class="sk" style="width:{w2}%;height:10px"></span></span></div>')
    return "".join(out)


def empty_state(icon, title, body, actions=""):
    return (f'<div class="empty"><span class="ei" aria-hidden="true">{ic(icon)}</span><p class="lead">{esc(title)}</p>'
            f'<p class="body">{esc(body)}</p>{actions}</div>')


def phone(body, shell_html="", overlay="", bg="", time="9:41", w=390, h=844, cls="", glow_cover="low-tide"):
    """Every screen gets the playing song's glow across its top unless it draws its own background or nothing has played."""
    size = f' style="width:{w}px;height:{h}px"' if (w, h) != (390, 844) else ""
    if not bg and glow_cover:
        bg = top_glow(glow_cover)
    return (f'<div class="ph{" " + cls if cls else ""}"{size}>{bg}<div class="scr">{body}</div>{shell_html}{overlay}{status_bar(time)}{GESTURE}</div>')


def cell(title, notes="", ph="", proposals=(), gaps=(), w=390):
    p = "".join(f'<p class="pr">Proposal: {esc(x)}</p>' for x in proposals)
    g = "".join(f'<p class="gap">Needs code: {esc(x)}</p>' for x in gaps)
    n = f"<p>{esc(notes)}</p>" if notes else ""
    st = f' style="width:{w}px"' if w != 390 else ""
    return f'<div class="cell"{st}><div class="cap">{esc(title)}{n}{p}{g}</div>{ph}</div>'


def board(title, cells, w=None, h=None, raw=False):
    if raw:
        inner = cells
    else:
        inner = '<div class="board">' + "".join(cells) + "</div>"
    return HEAD.format(title=esc(title), css=CSS) + inner + TAIL.format(w=w or 0, h=h or 0)
