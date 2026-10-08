#!/usr/bin/env python3
"""Embed the compiled firmware (firmware/bin) into web/body.html as `const FIRMWARE=...`.
Usage: python3 tools/embed_firmware.py [bin-dir]   (default: firmware/bin)
The version is read from FW_VERSION in firmware/VolkanDeck/Board.h."""
import base64, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bins = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'firmware', 'bin')
ver = re.search(r'#define FW_VERSION "([^"]+)"', open(os.path.join(ROOT, 'firmware/VolkanDeck/Board.h')).read()).group(1)
parts = []
for line in open(os.path.join(bins, 'flash_args')):
    m = re.match(r'(0x[0-9a-fA-F]+)\s+(\S+)', line.strip())
    if m:
        data = open(os.path.join(bins, m.group(2)), 'rb').read()
        parts.append({'addr': int(m.group(1), 16), 'b64': base64.b64encode(data).decode()})
fw = 'const FIRMWARE=' + json.dumps({'version': ver, 'parts': parts}, separators=(',', ':')) + ';'
p = os.path.join(ROOT, 'web', 'body.html'); s = open(p).read()
s, n = re.subn(r'const FIRMWARE=\{.*?\};', lambda _: fw, s, count=1, flags=re.S)
assert n == 1, 'FIRMWARE constant not found in body.html'
open(p, 'w').write(s); print('embedded firmware v' + ver, [hex(x['addr']) for x in parts])
