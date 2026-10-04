#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data/garden.json + data/ratch.json  ->  backend/WebMenuData.gs  (ASCII only, for pasting into Apps Script)

Run after you edit a menu or a price:   python3 tools/build_backend_menu.py
It also refreshes "menuVersion" inside data/*.json so the web page can warn when the
Apps Script copy of the menu is out of date.
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def esc(s):
    o = []
    for ch in s:
        c = ord(ch)
        if ch == "'":
            o.append("\\'")
        elif ch == '\\':
            o.append('\\\\')
        elif c < 128:
            o.append(ch)
        elif c < 0x10000:
            o.append('\\u%04x' % c)
        else:
            c -= 0x10000
            o.append('\\u%04x\\u%04x' % (0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff)))
    return ''.join(o)


def q(s):
    return "'" + esc(s) + "'"


def menu_version(menu):
    s = ''.join('%s:%s;' % (it[0], it[4]) for c in menu for it in c['items'])
    h = 5381
    for ch in s:
        h = ((h * 33) ^ ord(ch)) & 0xffffffff
    return '%x' % h


def block(var, menu):
    out = []
    for c in menu:
        items = ["[%s,%s,%s,%s,%d]" % (q(i[0]), q(i[1]), q(i[2]), q(i[3]), i[4]) for i in c['items']]
        out.append("  {id:%s,th:%s,en:%s,items:[\n    %s\n  ]}" % (q(c['id']), q(c['th']), q(c['en']), ',\n    '.join(items)))
    return 'var %s = [\n%s\n];' % (var, ',\n'.join(out))


def main():
    lines = ['/* WebMenuData.gs - menu data for the Mana web booking app (generated, ASCII only).',
             '   Item = [id, name_th, name_en, name_zh, price]. Prices here are the ONLY source of truth for orders. */']
    for branch, var in (('garden', 'WEB_MENU_GARDEN'), ('ratch', 'WEB_MENU_RATCH')):
        p = os.path.join(ROOT, 'data', branch + '.json')
        txt = open(p, encoding='utf-8').read()
        data = json.loads(txt)
        ver = menu_version(data['menu'])
        if data.get('menuVersion') != ver:
            txt = re.sub(r'"menuVersion": "[0-9a-f]*"', '"menuVersion": "%s"' % ver, txt)
            open(p, 'w', encoding='utf-8').write(txt)
        for c in data['menu']:
            for i in c['items']:
                assert len(i) == 5 and isinstance(i[4], int) and i[4] > 0, i
        lines.append(block(var, data['menu']))
        print(branch, len(data['menu']), 'categories', sum(len(c['items']) for c in data['menu']), 'items, menuVersion', ver)
    out = os.path.join(ROOT, 'backend', 'WebMenuData.gs')
    open(out, 'w', newline='\n').write('\n'.join(lines) + '\n')
    bad = [c for c in open(out, 'rb').read() if c > 127]
    assert not bad, 'non-ASCII bytes in output'
    print('wrote', out)


if __name__ == '__main__':
    main()
