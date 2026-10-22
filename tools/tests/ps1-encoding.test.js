// Windows PowerShell 5.1 reads a .ps1 without BOM in the ANSI code page: Turkish messages of wol-setup.ps1 came back
// as "Windows ayarlarÄ± tamam", "aÃ§Ä±k" (2026-10-22). A script with non-ASCII text must be saved as UTF-8 with BOM.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const app = path.join(__dirname, '..', '..', 'app');

test('every PowerShell script with non-ASCII text starts with a UTF-8 BOM', () => {
  const scripts = fs.readdirSync(app).filter(f => /\.ps1$/i.test(f));
  assert.ok(scripts.includes('wol-setup.ps1'));
  for (const f of scripts) {
    const b = fs.readFileSync(path.join(app, f));
    if (b.every(x => x < 0x80)) continue;
    assert.deepStrictEqual([...b.subarray(0, 3)], [0xef, 0xbb, 0xbf], f + ' UTF-8 BOM ile kaydedilmeli');
  }
});

test('the Wake-on-LAN result keeps its line breaks on the page', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'body.html'), 'utf8');
  assert.match(page, /id:"wolOut",hidden:true,style:"white-space:pre-line"/);
});
