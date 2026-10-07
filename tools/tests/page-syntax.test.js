// The whole settings page must parse: unit tests extract single functions and would miss a stray bracket
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');

for (const f of ['web/body.html', 'app/index.html', 'web/StreamDeck-Ayar.html']) {
  test(f + ': every inline script compiles', () => {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
    assert.ok(scripts.length > 0);
    scripts.forEach((s, i) => assert.doesNotThrow(() => new vm.Script(s, { filename: f + '#' + i }), f + ' script ' + i));
  });
}
