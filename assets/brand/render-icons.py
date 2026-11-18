#!/usr/bin/env python3
"""Render every webyak icon, and the link-preview card, from laptop.svg in this
folder.

    python3 assets/brand/render-icons.py

Needs Python 3 with Pillow, and Google Chrome to rasterise the SVG, which
Pillow can't read, and to set the card's text. Set CHROME to the binary if it
isn't at the macOS default.
Paths resolve from this file, so it runs from anywhere.

What each output is for, and why its margins are what they are:
docs/DESIGN.md#logo.
"""

import os
import subprocess
import sys
import tempfile
import time

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
LANCZOS = Image.Resampling.LANCZOS

# theme.brand and theme.onBrand in src/constants/theme.ts: the accent, and the
# near-black that goes on it, because white on this green is too faint.
GREEN = (0x10, 0xCE, 0xAC, 255)
INK = (0x00, 0x20, 0x1A, 255)
WHITE = (255, 255, 255, 255)

# How much of the canvas the laptop's width takes. It is wider than it is tall.
APP_ICON = 0.66  # the OS rounds an app icon's corners off, so leave it room
MARK = 0.8  # favicon and sidebar are tiny, so the laptop is as big as it fits
MARK_RADIUS = 0.22  # the mark's corner radius, as a fraction of its side

# A launcher draws an Android adaptive icon through a mask of its own choosing,
# and only a centred circle 66dp across a 108dp canvas is sure to survive it.
ANDROID_SAFE_RADIUS = 33 / 108


def screenshot(html, width, height, what):
    """`html` as headless Chrome draws it in a width x height window, as RGBA.
    Whatever the page leaves unpainted stays transparent."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        page = os.path.join(tmp, 'page.html')
        shot = os.path.join(tmp, 'shot.png')
        with open(page, 'w') as f:
            f.write(html)
        chrome = subprocess.Popen(
            [
                CHROME,
                '--headless',
                '--disable-gpu',
                '--hide-scrollbars',
                '--force-device-scale-factor=1',
                '--default-background-color=00000000',
                f'--user-data-dir={os.path.join(tmp, "profile")}',
                f'--window-size={width},{height}',
                f'--screenshot={shot}',
                f'file://{page}',
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Headless Chrome on macOS can write the screenshot and then never
        # exit, so wait for a readable file rather than for the process.
        try:
            deadline = time.monotonic() + 60
            while True:
                try:
                    return Image.open(shot).convert('RGBA')
                except OSError:
                    pass  # not there yet, or still being written
                if chrome.poll() is not None and not os.path.exists(shot):
                    sys.exit(f'Chrome exited without rendering {what}')
                if time.monotonic() > deadline:
                    sys.exit(f'Timed out rendering {what}')
                time.sleep(0.2)
        finally:
            chrome.kill()
            chrome.wait()


def rasterise(svg, size=2048):
    """The SVG's coverage at size x size, as an alpha mask cropped to its ink."""
    art = screenshot(
        '<!doctype html><style>html,body{margin:0;background:transparent}'
        f'img{{display:block;width:{size}px;height:{size}px}}</style>'
        f'<img src="file://{svg}">',
        size,
        size,
        svg,
    )
    alpha = art.getchannel('A')
    return alpha.crop(alpha.point(lambda a: 255 if a > 8 else 0).getbbox())


def glyph(mask, colour):
    """The outline in one colour. The SVG strokes with currentColor, so only
    its coverage matters."""
    out = Image.new('RGBA', mask.size, colour)
    out.putalpha(mask)
    return out


def scaled(art, longest):
    k = longest / max(art.size)
    return art.resize((round(art.width * k), round(art.height * k)), LANCZOS)


def centred(art, size, background=(0, 0, 0, 0)):
    canvas = Image.new('RGBA', (size, size), background)
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return canvas


def rounded(tile, radius):
    mask = Image.new('L', tile.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, tile.width - 1, tile.height - 1), radius=radius, fill=255
    )
    out = tile.copy()
    out.putalpha(mask)
    return out


def reach(art):
    """How far the ink reaches from the art's centre, per unit of its longer side."""
    k = 256 / max(art.size)
    alpha = art.getchannel('A').resize(
        (round(art.width * k), round(art.height * k)), Image.Resampling.BOX
    )
    w, h = alpha.size
    far = 0.0
    for i, a in enumerate(alpha.tobytes()):
        if a > 8:
            x, y = i % w + 0.5 - w / 2, i // w + 0.5 - h / 2
            far = max(far, (x * x + y * y) ** 0.5)
    return far / 256


def share_card(mark):
    """The picture a link to webyak unfurls with: the mark, the name and what it
    is, on the app's black. 1200x630 is the size Open Graph consumers expect
    for a large image. The text is drawn by Chrome in the app's own font stack
    (src/global.css), at sizes still legible at the ~400px Discord shows it."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        tile = os.path.join(tmp, 'mark.png')
        mark.resize((240, 240), LANCZOS).save(tile)
        card = screenshot(
            f"""<!doctype html><meta charset="utf-8"><style>
            html, body {{ margin: 0; width: 1200px; height: 630px; overflow: hidden }}
            body {{
              display: flex; align-items: center; gap: 72px; padding: 0 120px;
              box-sizing: border-box; color: #FFFFFF;
              font-family: Spline Sans, Inter, ui-sans-serif, system-ui, sans-serif;
              background: radial-gradient(circle at 240px 315px, rgba(16, 206, 172, 0.2),
                rgba(16, 206, 172, 0) 440px) #000000;
            }}
            img {{ width: 240px; height: 240px; flex: none }}
            h1 {{ margin: 0; font-size: 136px; line-height: 1; font-weight: 700; letter-spacing: -4px }}
            p {{ margin: 24px 0 0; font-size: 48px; line-height: 1.15; font-weight: 500; color: #A2A6AD }}
            .note {{ margin-top: 40px; font-size: 32px; font-weight: 600; color: #10CEAC }}
            </style>
            <img src="file://{tile}">
            <div><h1>webyak</h1><p>Yik Yak, on the web.</p><p class="note">Unofficial · open source</p></div>""",
            1200,
            630,
            'the share card',
        )
    return card.convert('RGB')


def save(image, path):
    image.save(os.path.join(ROOT, path), optimize=True)
    print(f'{path}  {image.width}x{image.height}')


def main():
    mask = rasterise(os.path.join(HERE, 'laptop.svg'))
    ink = glyph(mask, INK)

    # The app icon is opaque and square: iOS and Android launchers round it
    # themselves, and the App Store rejects an icon with transparency.
    # Safari reads apple-touch-icon.png from the site root on its own.
    app = centred(scaled(ink, round(1024 * APP_ICON)), 1024, GREEN)
    save(app.convert('RGB'), 'assets/images/icon.png')
    save(app.resize((180, 180), LANCZOS).convert('RGB'), 'public/apple-touch-icon.png')

    # The mark is the same picture, tighter, with its corners rounded here,
    # because nothing downstream rounds a favicon. Expo shrinks web.favicon to
    # 48px before building favicon.ico, so it gets exactly 48px and the big
    # reduction is done here, by Pillow.
    mark = rounded(
        centred(scaled(ink, round(1024 * MARK)), 1024, GREEN), round(1024 * MARK_RADIUS)
    )
    save(mark.resize((48, 48), LANCZOS), 'assets/images/favicon.png')
    save(mark.resize((128, 128), LANCZOS), 'assets/images/logo.png')

    # The link preview on Discord, iMessage, Slack and the like, named by the
    # og:image tag in public/index.html. Opaque: some unfurlers draw a
    # transparent image on white.
    save(share_card(mark), 'public/og-image.png')

    # Android: the laptop alone, inside the safe circle. app.json supplies the
    # green behind it. The themed icon is white because the system only reads
    # its alpha and tints it.
    save(
        centred(scaled(ink, round(512 * ANDROID_SAFE_RADIUS / reach(ink))), 512),
        'assets/images/android-icon-foreground.png',
    )
    white = glyph(mask, WHITE)
    save(
        centred(scaled(white, round(432 * ANDROID_SAFE_RADIUS / reach(white))), 432),
        'assets/images/android-icon-monochrome.png',
    )

    # Splash: the laptop alone, drawn at app.json's imageWidth on its green.
    save(scaled(ink, 512), 'assets/images/splash-icon.png')


if __name__ == '__main__':
    main()
