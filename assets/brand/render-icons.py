#!/usr/bin/env python3
"""Render every webyak icon from the laptop SVGs in this folder.

    python3 assets/brand/render-icons.py

Needs Python 3 with Pillow, and Google Chrome to rasterise the SVGs: Pillow
can't read SVG, and the colour art leans on SVG filters. Set CHROME to the
binary if it isn't at the macOS default. Paths resolve from this file, so it
runs from anywhere.

What each output is for, and why its margins are what they are:
docs/DESIGN.md#logo.
"""

import os
import subprocess
import sys
import tempfile
import time

from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
LANCZOS = Image.Resampling.LANCZOS

# theme.brand in src/constants/theme.ts.
GREEN = (0x10, 0xCE, 0xAC, 255)

# How much of the canvas the laptop's longer side takes.
APP_ICON = 0.62  # the OS rounds an app icon's corners off, so leave it room
MARK = 0.78  # favicon and sidebar are tiny, so the laptop is as big as it fits
MARK_RADIUS = 0.22  # the mark's corner radius, as a fraction of its side

# A launcher draws an Android adaptive icon through a mask of its own choosing,
# and only a centred circle 66dp across a 108dp canvas is sure to survive it.
ANDROID_SAFE_RADIUS = 33 / 108


def rasterise(svg, size=2048):
    """The SVG drawn size x size on a transparent background, cropped to its ink."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        page = os.path.join(tmp, 'page.html')
        shot = os.path.join(tmp, 'shot.png')
        with open(page, 'w') as f:
            f.write(
                '<!doctype html><style>html,body{margin:0;background:transparent}'
                f'img{{display:block;width:{size}px;height:{size}px}}</style>'
                f'<img src="file://{svg}">'
            )
        chrome = subprocess.Popen(
            [
                CHROME,
                '--headless',
                '--disable-gpu',
                '--hide-scrollbars',
                '--force-device-scale-factor=1',
                '--default-background-color=00000000',
                f'--user-data-dir={os.path.join(tmp, "profile")}',
                f'--window-size={size},{size}',
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
                    art = Image.open(shot).convert('RGBA')
                    break
                except OSError:
                    pass  # not there yet, or still being written
                if chrome.poll() is not None and not os.path.exists(shot):
                    sys.exit(f'Chrome exited without rendering {svg}')
                if time.monotonic() > deadline:
                    sys.exit(f'Timed out rendering {svg}')
                time.sleep(0.2)
        finally:
            chrome.kill()
            chrome.wait()
    return art.crop(art.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())


def one_colour(art):
    """White, with the art's white parts kept and its black parts cut out."""
    out = Image.new('RGBA', art.size, (255, 255, 255, 0))
    out.putalpha(ImageChops.multiply(art.getchannel('A'), art.convert('L')))
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


def save(image, path):
    image.save(os.path.join(ROOT, path), optimize=True)
    print(f'{path}  {image.width}x{image.height}')


def main():
    colour = rasterise(os.path.join(HERE, 'laptop.svg'))
    mono = one_colour(rasterise(os.path.join(HERE, 'laptop-mono.svg')))

    # The app icon is opaque and square: iOS and Android launchers round it
    # themselves, and the App Store rejects an icon with transparency.
    # Safari reads apple-touch-icon.png from the site root on its own.
    app = centred(scaled(colour, round(1024 * APP_ICON)), 1024, GREEN)
    save(app.convert('RGB'), 'assets/images/icon.png')
    save(app.resize((180, 180), LANCZOS).convert('RGB'), 'public/apple-touch-icon.png')

    # The mark is the same picture, tighter, with its corners rounded here,
    # because nothing downstream rounds a favicon. Expo shrinks web.favicon to
    # 48px before building favicon.ico, so it gets exactly 48px and the big
    # reduction is done here, by Pillow.
    mark = rounded(
        centred(scaled(colour, round(1024 * MARK)), 1024, GREEN), round(1024 * MARK_RADIUS)
    )
    save(mark.resize((48, 48), LANCZOS), 'assets/images/favicon.png')
    save(mark.resize((128, 128), LANCZOS), 'assets/images/logo.png')

    # Android: the laptop alone, inside the safe circle. app.json supplies the
    # green behind it, and the system tints the monochrome one.
    save(
        centred(scaled(colour, round(512 * ANDROID_SAFE_RADIUS / reach(colour))), 512),
        'assets/images/android-icon-foreground.png',
    )
    save(
        centred(scaled(mono, round(432 * ANDROID_SAFE_RADIUS / reach(mono))), 432),
        'assets/images/android-icon-monochrome.png',
    )

    # Splash: the laptop alone, drawn at app.json's imageWidth on its green.
    save(scaled(colour, 512), 'assets/images/splash-icon.png')


if __name__ == '__main__':
    main()
