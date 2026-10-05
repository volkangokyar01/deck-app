#!/usr/bin/env python3
"""Build the settings page and the desktop app page from web/head.css.html + web/body.html.
  web/StreamDeck-Ayar.html  standalone page (Chrome/Edge, Web Serial)
  app/index.html            same page + app/companion.js injected inside the page's IIFE"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda *p: open(os.path.join(ROOT, *p), encoding='utf-8').read()
head, body, comp = rd('web', 'head.css.html'), rd('web', 'body.html'), rd('app', 'companion.js')
doc = lambda b: '<!doctype html>\n<html lang="tr">\n' + head + b + '\n</html>\n'
open(os.path.join(ROOT, 'web', 'StreamDeck-Ayar.html'), 'w', encoding='utf-8').write(doc(body))
end = body.rindex('})();')
app = body[:end] + '\n/* ===== desktop app additions ===== */\n' + comp + '\n' + body[end:]
open(os.path.join(ROOT, 'app', 'index.html'), 'w', encoding='utf-8').write(doc(app))
print('built web/StreamDeck-Ayar.html and app/index.html')
