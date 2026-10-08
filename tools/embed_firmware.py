#!/usr/bin/env python3
"""Embed the compiled firmware into web/body.html as `const FIRMWARE=...`.
Usage: python3 tools/embed_firmware.py [bin-dir]   (default: firmware/bin, plus firmware/bin-qspi when present)
`parts` is the octal-PSRAM build (ESP32-S3R8, LilyGO's board); `qspi` the quad / no-PSRAM build (1.12.0).
The settings page picks one from the chip's eFuse when it flashes. The version is FW_VERSION in Board.h."""
import base64, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bins = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'firmware', 'bin')
qspi = os.path.join(ROOT, 'firmware', 'bin-qspi') if len(sys.argv) <= 1 else None
ver = re.search(r'#define FW_VERSION "([^"]+)"', open(os.path.join(ROOT, 'firmware/VolkanDeck/Board.h')).read()).group(1)


def read_parts(d):
    parts = []
    for line in open(os.path.join(d, 'flash_args')):
        m = re.match(r'(0x[0-9a-fA-F]+)\s+(\S+)', line.strip())
        if m:
            data = open(os.path.join(d, m.group(2)), 'rb').read()
            parts.append({'addr': int(m.group(1), 16), 'b64': base64.b64encode(data).decode()})
    return parts


fw = {'version': ver, 'parts': read_parts(bins)}
if qspi and os.path.exists(os.path.join(qspi, 'flash_args')):
    fw['qspi'] = read_parts(qspi)
js = 'const FIRMWARE=' + json.dumps(fw, separators=(',', ':')) + ';'
p = os.path.join(ROOT, 'web', 'body.html'); s = open(p).read()
s, n = re.subn(r'const FIRMWARE=\{.*?\};', lambda _: js, s, count=1, flags=re.S)
assert n == 1, 'FIRMWARE constant not found in body.html'
open(p, 'w').write(s)
print('embedded firmware v' + ver, [hex(x['addr']) for x in fw['parts']], '+ qspi' if 'qspi' in fw else '')
