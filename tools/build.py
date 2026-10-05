#!/usr/bin/env python3
"""Build the settings page and the desktop app page from web/head.css.html + web/body.html.
  web/StreamDeck-Ayar.html  standalone page (Chrome/Edge, Web Serial)
  app/index.html            same page + app/companion.js injected inside the page's IIFE"""
import os
import json
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


def main():
    rd = lambda *p: Path(ROOT, *p).read_text(encoding='utf-8')
    head, body, comp = rd('web', 'head.css.html'), rd('web', 'body.html'), rd('app', 'companion.js')
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
