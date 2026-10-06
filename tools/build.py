#!/usr/bin/env python3
"""Build the settings page and the desktop app page from web/head.css.html + web/body.html.
  web/StreamDeck-Ayar.html  standalone page (Chrome/Edge, Web Serial)
  app/index.html            same page + app/companion.js injected inside the page's IIFE
Both pages work offline: web/fonts (fonts.css + woff2) and web/vendor/esptool-js/bundle.js are embedded."""
import os
import re
import json
import base64
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GENERATED = {'app/index.html', 'web/StreamDeck-Ayar.html', 'app/build-info.json'}


def build_info():
    commit, dirty = None, False
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT,
                                         stderr=subprocess.DEVNULL).decode().strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    try:
        # NUL delimiters preserve spaces/newlines in paths; include individual untracked files.
        entries = iter(subprocess.check_output(
            ['git', 'status', '--porcelain', '-z', '--untracked-files=all'], cwd=ROOT,
            stderr=subprocess.DEVNULL).decode('utf-8', errors='surrogateescape').split('\0'))
        for entry in entries:
            if not entry:
                continue
            paths = [entry[3:]]
            if 'R' in entry[:2] or 'C' in entry[:2]:
                paths.append(next(entries))
            if any(p not in GENERATED for p in paths):
                dirty = True
    except (OSError, subprocess.CalledProcessError):
        pass
    return {'commit': commit, 'dirty': dirty, 'built': datetime.now(timezone.utc).isoformat()}


FONTS_MARK = re.compile(r'<!--@FONTS@.*?-->\n?', re.S)
ESPTOOL_MARK = '/*@ESPTOOL@*/null'


def b64file(path):
    return base64.b64encode(path.read_bytes()).decode('ascii')


def inline_fonts(head):
    """Replace the <!--@FONTS@--> marker with web/fonts/fonts.css, its url(x.woff2) as data URIs."""
    css_path = Path(ROOT, 'web', 'fonts', 'fonts.css')
    if not css_path.exists():
        return FONTS_MARK.sub('', head)
    def data_uri(m):
        name = m.group(1)
        if '/' in name or '\\' in name or not name.endswith('.woff2'):
            raise ValueError('web/fonts/fonts.css: unexpected font url ' + name)
        return 'url(data:font/woff2;base64,' + b64file(css_path.parent / name) + ')'
    css = re.sub(r'url\(([^)"\']+)\)', data_uri, css_path.read_text(encoding='utf-8'))
    return FONTS_MARK.sub(lambda _: '<style>\n' + css + '</style>\n', head)


def embed_esptool(body):
    """Put web/vendor/esptool-js/bundle.js (base64) where the page expects ESPTOOL_B64."""
    bundle = Path(ROOT, 'web', 'vendor', 'esptool-js', 'bundle.js')
    if ESPTOOL_MARK not in body or not bundle.exists():
        return body
    return body.replace(ESPTOOL_MARK, json.dumps(b64file(bundle)), 1)


def main():
    rd = lambda *p: Path(ROOT, *p).read_text(encoding='utf-8')
    head, body, comp = rd('web', 'head.css.html'), rd('web', 'body.html'), rd('app', 'companion.js')
    head, body = inline_fonts(head), embed_esptool(body)
    doc = lambda b: '<!doctype html>\n<html lang="tr">\n' + head + b + '\n</html>\n'
    Path(ROOT, 'web', 'StreamDeck-Ayar.html').write_text(doc(body), encoding='utf-8')
    end = body.rindex('})();')
    app = body[:end] + '\n/* ===== desktop app additions ===== */\n' + comp + '\n' + body[end:]
    Path(ROOT, 'app', 'index.html').write_text(doc(app), encoding='utf-8')
    with open(os.path.join(ROOT, 'app', 'build-info.json'), 'w', encoding='utf-8') as output:
        json.dump(build_info(), output)
        output.write('\n')
    print('built web/StreamDeck-Ayar.html, app/index.html and app/build-info.json')


if __name__ == '__main__':
    main()
