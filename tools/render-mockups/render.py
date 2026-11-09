"""Render each btc-dao mock-up screen to PNG in its default state.

Usage: python3 render.py <mockups_dir> <out_dir>
"""
import json, os, shutil, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
src, out = sys.argv[1], sys.argv[2]
pages = os.path.join(HERE, 'pages')
os.makedirs(pages, exist_ok=True)
os.makedirs(out, exist_ok=True)

font_dir = 'file://' + os.path.join(HERE, 'node_modules', '@fontsource')
with open(os.path.join(HERE, 'support.js'), encoding='utf-8') as f:
    support = f.read().replace('__FONT_DIR__', font_dir)
with open(os.path.join(pages, 'support.js'), 'w', encoding='utf-8') as f:
    f.write(support)

with open(os.path.join(src, 'canvas.json'), encoding='utf-8') as f:
    boards = json.load(f)['boards']

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--allow-file-access-from-files'])
    for name, b in boards.items():
        shutil.copy(os.path.join(src, name), os.path.join(pages, name))
        ctx = browser.new_context(viewport={'width': b['w'], 'height': b['h']}, device_scale_factor=2)
        page = ctx.new_page()
        page.route('http*://**/*', lambda route: route.abort())
        page.goto('file://' + os.path.join(pages, name))
        page.wait_for_selector('body[data-rendered="1"]')
        page.evaluate('document.fonts.ready')
        page.wait_for_timeout(300)
        png = os.path.join(out, name.replace('.dc.html', '.png'))
        page.screenshot(path=png, clip={'x': 0, 'y': 0, 'width': b['w'], 'height': b['h']})
        ctx.close()
        print('rendered', png)
    browser.close()
