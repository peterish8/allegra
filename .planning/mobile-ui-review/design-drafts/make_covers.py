"""Generate photographic-looking placeholder album covers for the LuvLyrics mockups.

Each cover is built from soft light, blur, grain and a vignette so it reads like a photo, not a flat shape.
Output: 600x600 JPEGs next to this script.
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 600
OUT = os.path.dirname(os.path.abspath(__file__))
FONTS = "C:/Windows/Fonts/"


def font(name, size):
    try:
        return ImageFont.truetype(FONTS + name, size)
    except OSError:
        return ImageFont.load_default()


def vgrad(top, bottom):
    t = np.linspace(0, 1, S)[:, None, None]
    a = np.array(top, float)[None, None, :]
    b = np.array(bottom, float)[None, None, :]
    img = a * (1 - t) + b * t
    return np.repeat(img, S, axis=1)


def glow(arr, cx, cy, r, color, strength=1.0):
    y, x = np.mgrid[0:S, 0:S]
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
    w = np.clip(1 - d, 0, 1) ** 2 * strength
    arr += w[..., None] * (np.array(color, float)[None, None, :] - arr) * 0.9
    return arr


def finish(img, grain=10, vignette=0.45, seed=0):
    rng = np.random.default_rng(seed)
    a = np.asarray(img, float)
    a += rng.normal(0, grain, a.shape[:2])[..., None]
    y, x = np.mgrid[0:S, 0:S]
    d = np.sqrt((x - S / 2) ** 2 + (y - S / 2) ** 2) / (S * 0.72)
    a *= (1 - vignette * np.clip(d, 0, 1) ** 2)[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def to_img(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def bokeh(img, n, colors, rmin, rmax, seed, blur=6, area=(0, 0, S, S)):
    rng = random.Random(seed)
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(n):
        r = rng.uniform(rmin, rmax)
        x = rng.uniform(area[0], area[2])
        y = rng.uniform(area[1], area[3])
        c = rng.choice(colors)
        d.ellipse([x - r, y - r, x + r, y + r], fill=c + (rng.randint(70, 190),))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def low_tide():  # harbour at dusk
    a = vgrad((54, 92, 128), (196, 160, 140))
    a = glow(a, 300, 360, 260, (250, 214, 170), 0.9)
    img = to_img(a)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 372, S, S], fill=(22, 40, 58))
    for i in range(40):
        y = 380 + i * 6
        d.line([(0, y), (S, y)], fill=(40 + i, 70 + i, 96 + i // 2), width=1)
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    img = bokeh(img, 14, [(255, 205, 140), (255, 236, 200)], 2, 5, 3, blur=1.5, area=(40, 350, 560, 372))
    d = ImageDraw.Draw(img)
    d.polygon([(0, 372), (90, 340), (150, 356), (230, 330), (300, 360), (380, 344), (470, 362), (600, 338), (600, 372)], fill=(26, 34, 46))
    d.text((34, 36), "HARBOR KIDS", font=font("arialbd.ttf", 22), fill=(245, 240, 232))
    d.text((34, 64), "low tide", font=font("georgiai.ttf", 30), fill=(245, 240, 232))
    return finish(img, 9, 0.5, 1)


def golden_hour():  # warm sun flare, haze
    a = vgrad((242, 176, 92), (176, 64, 38))
    a = glow(a, 410, 210, 340, (255, 238, 196), 1.0)
    a = glow(a, 120, 520, 260, (120, 30, 24), 0.8)
    img = to_img(a).filter(ImageFilter.GaussianBlur(2))
    img = bokeh(img, 10, [(255, 240, 210)], 10, 40, 5, blur=10, area=(250, 80, 560, 330))
    d = ImageDraw.Draw(img)
    d.text((36, 500), "golden hour again", font=font("georgia.ttf", 40), fill=(54, 20, 10))
    return finish(img, 11, 0.4, 2)


def paper_lanterns():  # lantern bokeh at night
    a = vgrad((34, 16, 48), (12, 8, 20))
    a = glow(a, 300, 260, 300, (110, 40, 90), 0.6)
    img = to_img(a)
    img = bokeh(img, 26, [(255, 170, 80), (255, 120, 90), (255, 214, 140)], 12, 46, 7, blur=12)
    img = bokeh(img, 8, [(255, 200, 120)], 6, 14, 8, blur=2, area=(120, 160, 480, 420))
    d = ImageDraw.Draw(img)
    d.text((300, 548), "MIRA VALE · PAPER LANTERNS", font=font("arial.ttf", 18), fill=(250, 226, 210), anchor="mm")
    return finish(img, 12, 0.55, 3)


def static_rain():  # rain on glass, cold light
    a = vgrad((70, 88, 104), (24, 30, 38))
    a = glow(a, 180, 200, 280, (160, 186, 206), 0.7)
    img = to_img(a)
    img = bokeh(img, 18, [(230, 180, 120), (180, 210, 240)], 10, 30, 11, blur=16)
    rng = random.Random(4)
    streaks = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(streaks)
    for _ in range(160):
        x = rng.uniform(0, S)
        y = rng.uniform(0, S)
        L = rng.uniform(20, 90)
        d.line([(x, y), (x + rng.uniform(-3, 3), y + L)], fill=(220, 235, 245, rng.randint(40, 120)), width=rng.choice([1, 1, 2]))
    for _ in range(120):
        x, y, r = rng.uniform(0, S), rng.uniform(0, S), rng.uniform(1.5, 4)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(235, 245, 255, rng.randint(80, 170)))
    img = Image.alpha_composite(img.convert("RGBA"), streaks.filter(ImageFilter.GaussianBlur(0.6))).convert("RGB")
    d = ImageDraw.Draw(img)
    d.text((36, 40), "Orla North", font=font("georgia.ttf", 34), fill=(236, 240, 244))
    return finish(img, 10, 0.5, 4)


def small_hours():  # deep night, moon, stars
    a = vgrad((10, 22, 46), (30, 58, 74))
    a = glow(a, 420, 160, 200, (120, 150, 170), 0.5)
    img = to_img(a)
    rng = random.Random(9)
    d = ImageDraw.Draw(img)
    for _ in range(170):
        x, y = rng.uniform(0, S), rng.uniform(0, 420)
        r = rng.choice([0.6, 0.8, 1.0, 1.4])
        c = rng.randint(170, 255)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(c, c, min(255, c + 10)))
    moon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    m = ImageDraw.Draw(moon)
    m.ellipse([380, 110, 470, 200], fill=(246, 232, 196, 255))
    img = Image.alpha_composite(img.convert("RGBA"), moon.filter(ImageFilter.GaussianBlur(1.2))).convert("RGB")
    img = Image.alpha_composite(img.convert("RGBA"), moon.filter(ImageFilter.GaussianBlur(30))).convert("RGB")
    d = ImageDraw.Draw(img)
    d.polygon([(0, 470), (120, 430), (260, 460), (380, 420), (600, 450), (600, 600), (0, 600)], fill=(8, 14, 24))
    d.text((36, 520), "small hours", font=font("georgiai.ttf", 36), fill=(226, 230, 236))
    return finish(img, 9, 0.5, 5)


def night_drive():  # city lights through a windscreen
    a = vgrad((16, 18, 30), (6, 6, 12))
    img = to_img(a)
    img = bokeh(img, 40, [(255, 90, 80), (255, 190, 90), (120, 180, 255), (255, 240, 220)], 8, 40, 13, blur=14, area=(0, 220, 600, 520))
    d = ImageDraw.Draw(img)
    d.text((36, 40), "NIGHT DRIVE", font=font("arialbd.ttf", 30), fill=(240, 240, 244))
    d.text((36, 76), "a playlist", font=font("arial.ttf", 20), fill=(190, 190, 200))
    return finish(img, 12, 0.45, 6)


def mira_portrait():  # artist photo: silhouette with rim light
    a = vgrad((58, 44, 86), (20, 16, 32))
    a = glow(a, 420, 180, 300, (210, 150, 120), 0.7)
    img = to_img(a)
    fig = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    f = ImageDraw.Draw(fig)
    f.ellipse([220, 150, 380, 330], fill=(14, 10, 20, 255))
    f.rounded_rectangle([140, 320, 470, 700], radius=150, fill=(14, 10, 20, 255))
    rim = fig.filter(ImageFilter.GaussianBlur(6))
    img = Image.alpha_composite(img.convert("RGBA"), Image.new("RGBA", (S, S), (240, 180, 140, 0))).convert("RGB")
    glowl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    glowl.paste((240, 170, 130, 120), (8, -4), rim)
    img = Image.alpha_composite(img.convert("RGBA"), glowl.filter(ImageFilter.GaussianBlur(8))).convert("RGBA")
    img = Image.alpha_composite(img, fig).convert("RGB")
    return finish(img, 11, 0.5, 7)


def monsoon():  # green, hazy, hindi single
    a = vgrad((54, 92, 70), (18, 34, 28))
    a = glow(a, 200, 180, 300, (170, 210, 160), 0.6)
    img = to_img(a).filter(ImageFilter.GaussianBlur(2))
    img = bokeh(img, 16, [(220, 240, 200), (190, 230, 190)], 6, 22, 21, blur=8)
    d = ImageDraw.Draw(img)
    d.text((36, 500), "baarish", font=font("georgia.ttf", 46), fill=(240, 246, 236))
    d.text((38, 556), "Kabir & The Monsoons", font=font("arial.ttf", 20), fill=(214, 226, 210))
    return finish(img, 10, 0.45, 8)


def neon_fade():  # magenta / teal club light
    a = vgrad((40, 10, 60), (8, 30, 46))
    a = glow(a, 150, 170, 280, (230, 60, 160), 0.8)
    a = glow(a, 470, 450, 300, (40, 200, 210), 0.7)
    img = to_img(a).filter(ImageFilter.GaussianBlur(3))
    d = ImageDraw.Draw(img)
    d.text((300, 300), "FADE", font=font("arialbd.ttf", 120), fill=(250, 244, 255), anchor="mm")
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    return finish(img, 13, 0.4, 9)


def daily_mix():  # warm film still
    a = vgrad((200, 150, 110), (96, 60, 48))
    a = glow(a, 300, 300, 280, (240, 210, 170), 0.6)
    img = to_img(a).filter(ImageFilter.GaussianBlur(4))
    d = ImageDraw.Draw(img)
    d.text((36, 520), "Daily Mix 1", font=font("arialbd.ttf", 38), fill=(255, 250, 244))
    return finish(img, 12, 0.45, 10)


COVERS = {
    "low-tide": low_tide,
    "golden-hour": golden_hour,
    "paper-lanterns": paper_lanterns,
    "static-rain": static_rain,
    "small-hours": small_hours,
    "night-drive": night_drive,
    "mira-vale": mira_portrait,
    "baarish": monsoon,
    "fade": neon_fade,
    "daily-mix": daily_mix,
}

if __name__ == "__main__":
    for name, fn in COVERS.items():
        path = os.path.join(OUT, name + ".jpg")
        fn().save(path, "JPEG", quality=84, optimize=True)
        print(name, os.path.getsize(path) // 1024, "KB")
