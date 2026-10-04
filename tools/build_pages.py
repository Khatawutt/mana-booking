#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
index.html (Mana Garden, default page)  ->  ratch/index.html (Mana Ratchayothin shell)

The two pages share css/ js/ data/ assets/. Only the <head> differs (title, share image,
icons) so that links shared in LINE/Facebook show the right logo.
  Garden       https://khatawutt.github.io/mana-booking/
  Ratchayothin https://khatawutt.github.io/mana-booking/ratch/   (the old ?b=ratch link still works)
Run after editing index.html:   python3 tools/build_pages.py
"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
h = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()

def sub(pattern, repl, s):
    out, n = re.subn(pattern, repl, s, count=1)
    assert n == 1, pattern
    return out

h = sub(r'<title>.*?</title>', '<title>Mana Ratchayothin | จองโต๊ะ &amp; สั่งอาหาร</title>', h)
h = sub(r'(<meta name="description" content=")[^"]*"', r'\1จองโต๊ะและสั่งอาหารล่วงหน้า Mana Ratchayothin Cafe\' &amp; Restaurant / Book a table and pre-order food online"', h)
h = sub(r'(<meta property="og:title" content=")[^"]*"', r'\1Mana Ratchayothin | จองโต๊ะ &amp; สั่งอาหาร"', h)
h = h.replace('og-garden.png', 'og-ratch.png').replace('favicon-garden.png', 'favicon-ratch.png').replace('apple-touch-garden.png', 'apple-touch-ratch.png')
h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="../">\n<script>window.MANA_DEFAULT_BRANCH = \'ratch\';</script>', 1)
h = h.replace('src="assets/logo-garden.webp"', 'src="assets/logo-ratch.webp"')
h = h.replace('<meta property="og:url" content="https://khatawutt.github.io/mana-booking/">', '')
os.makedirs(os.path.join(ROOT, 'ratch'), exist_ok=True)
open(os.path.join(ROOT, 'ratch', 'index.html'), 'w', encoding='utf-8').write(h)
print('wrote ratch/index.html')
