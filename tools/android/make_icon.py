#!/usr/bin/env python3
"""Gera os ícones do app Android (docs/design/APK.md): uma lua de blocos (o jeito do jogo) num céu escuro, com estrelas e um
bloco laranja (a cor do traje) em órbita. Escreve os PNGs em android/app/src/main/res/mipmap-*/ e a cor de fundo do ícone adaptativo.
Uso: python3 tools/android/make_icon.py   (precisa do Pillow: pip install pillow)"""
import math
import os
import random

from PIL import Image, ImageDraw

RES = os.path.join(os.path.dirname(__file__), '..', '..', 'android', 'app', 'src', 'main', 'res')
BG = (18, 15, 38)  # #120F26, o fundo do jogo
BASE = 1024
CELLS = 26  # blocos no diâmetro da lua
MOON = [(176, 170, 160), (192, 186, 176), (162, 157, 148), (201, 196, 186)]
DARK = [(104, 100, 98), (96, 92, 92)]
SUIT = (255, 122, 47)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def foreground(size=BASE):
    """lua, estrelas e o bloco laranja sobre fundo transparente, tudo dentro da zona segura (66% do centro)"""
    rnd = random.Random(5)
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    diam = size * 0.5
    cell = diam / CELLS
    cx = cy = size / 2
    craters = [(rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(0.12, 0.26)) for _ in range(6)]
    light = (-0.55, -0.6, 0.58)
    ln = math.sqrt(sum(c * c for c in light))
    light = tuple(c / ln for c in light)
    for i in range(CELLS):
        for j in range(CELLS):
            x = (i + 0.5) / CELLS * 2 - 1
            y = (j + 0.5) / CELLS * 2 - 1
            r2 = x * x + y * y
            if r2 > 1:
                continue
            z = math.sqrt(1 - r2)
            lam = max(0.0, x * light[0] + y * light[1] + z * light[2])
            col = rnd.choice(MOON)
            for ccx, ccy, cr in craters:
                dist = math.hypot(x - ccx, y - ccy)
                if dist < cr:
                    col = rnd.choice(DARK)
                elif dist < cr * 1.35:
                    col = lerp(col, (236, 232, 222), 0.5)
            shade = 0.16 + 0.84 * lam
            col = tuple(round(c * shade) for c in col)
            x0, y0 = cx - diam / 2 + i * cell, cy - diam / 2 + j * cell
            d.rectangle([x0, y0, x0 + cell + 0.6, y0 + cell + 0.6], fill=col + (255,))
    # bloco laranja em órbita (o traje) e estrelas pequenas
    s = cell * 1.8
    ox, oy = cx + diam * 0.5, cy - diam * 0.46
    d.rectangle([ox, oy, ox + s, oy + s], fill=SUIT + (255,))
    d.rectangle([ox, oy, ox + s, oy + s * 0.35], fill=lerp(SUIT, (255, 255, 255), 0.35) + (255,))
    for _ in range(14):
        a, r = rnd.uniform(0, math.tau), rnd.uniform(0.3, 0.46) * size
        px, py = cx + math.cos(a) * r, cy + math.sin(a) * r
        if math.hypot(px - cx, py - cy) < diam / 2 + cell * 2:
            continue
        t = cell * rnd.choice([0.5, 0.7, 1.0])
        d.rectangle([px, py, px + t, py + t], fill=(235, 238, 255, rnd.choice([150, 220, 255])))
    return im


def legacy(fg, size, round_icon):
    """ícone antigo (sem camadas): fundo em degradê com a mesma arte maior, quadrado com cantos ou redondo"""
    bg = Image.new('RGBA', (BASE, BASE), BG + (255,))
    g = ImageDraw.Draw(bg)
    for y in range(BASE):
        g.line([(0, y), (BASE, y)], fill=lerp((30, 22, 64), BG, y / BASE) + (255,))
    art = fg.resize((round(BASE * 1.25), round(BASE * 1.25)), Image.LANCZOS)
    off = (BASE - art.width) // 2
    bg.alpha_composite(art, (off, off))
    mask = Image.new('L', (BASE, BASE), 0)
    m = ImageDraw.Draw(mask)
    if round_icon:
        m.ellipse([0, 0, BASE - 1, BASE - 1], fill=255)
    else:
        m.rounded_rectangle([0, 0, BASE - 1, BASE - 1], radius=BASE // 5, fill=255)
    out = Image.new('RGBA', (BASE, BASE), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


def main():
    fg = foreground()
    for dens, fsize, lsize in [('mdpi', 108, 48), ('hdpi', 162, 72), ('xhdpi', 216, 96), ('xxhdpi', 324, 144), ('xxxhdpi', 432, 192)]:
        d = os.path.join(RES, f'mipmap-{dens}')
        fg.resize((fsize, fsize), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_foreground.png'))
        legacy(fg, lsize, False).save(os.path.join(d, 'ic_launcher.png'))
        legacy(fg, lsize, True).save(os.path.join(d, 'ic_launcher_round.png'))
    with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#120F26</color>\n</resources>\n')
    fg.resize((512, 512), Image.LANCZOS).save('/tmp/spacing-icon-preview.png')
    print('ícones escritos em', os.path.abspath(RES))


if __name__ == '__main__':
    main()
