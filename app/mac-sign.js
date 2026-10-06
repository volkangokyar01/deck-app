// Keep the identity flow in installer/Mac-Kur.command in sync with this module.
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CN = 'Volkan Deck Yerel';
const KEYCHAIN = 'volkan-deck.keychain-db';
const ADHOC_REQUIREMENT = 'designated => identifier "com.volkan.deck"';
const outputText = output => typeof output === 'string' ? output : [output?.stdout, output?.stderr].join('\n');
const runFile = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args,
  { timeout: 120e3, maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
    if (err) reject(err);
    else resolve(stdout + '\n' + stderr);
  }));

function createMacSigner({ userData, run = runFile }) {
  const dir = path.join(userData, 'signing');
  const keychain = path.join(dir, KEYCHAIN), passFile = path.join(dir, 'keychain-pass');
  const findIdentity = async () => {
    const text = outputText(await run('/usr/bin/security', ['find-identity', '-p', 'codesigning', keychain]));
    return text.match(/\b([a-fA-F0-9]{40})\s+"Volkan Deck Yerel"/)?.[1] || null;
  };
  async function ensureIdentity() {
    let temp = null, created = false;
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.chmod(dir, 0o700);
      let exists = false;
      try { await fs.access(keychain); exists = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (exists) {
        try {
          const password = (await fs.readFile(passFile, 'utf8')).trim();
          if (!/^[a-f0-9]{32}$/.test(password)) throw new Error('Geçersiz parola');
          await fs.chmod(passFile, 0o600);
          await run('/usr/bin/security', ['unlock-keychain', '-p', password, keychain]);
          const id = await findIdentity();
          if (id) return { keychain, id };
        } catch (_) {}
        await run('/usr/bin/security', ['delete-keychain', keychain]);
      }
      const password = crypto.randomBytes(16).toString('hex');
      await fs.writeFile(passFile, password, { mode: 0o600 });
      await fs.chmod(passFile, 0o600);
      temp = await fs.mkdtemp(path.join(dir, 'identity-'));
      const key = path.join(temp, 'key.pem'), cert = path.join(temp, 'cert.pem'), p12 = path.join(temp, 'id.p12');
      const p12pass = crypto.randomBytes(16).toString('hex');
      await run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert,
        '-days', '3650', '-nodes', '-subj', '/CN=' + CN,
        '-addext', 'extendedKeyUsage=critical,codeSigning', '-addext', 'keyUsage=critical,digitalSignature',
        '-addext', 'basicConstraints=critical,CA:false']);
      await run('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', p12, '-passout', 'pass:' + p12pass]);
      await run('/usr/bin/security', ['create-keychain', '-p', password, keychain]);
      created = true;
      await run('/usr/bin/security', ['unlock-keychain', '-p', password, keychain]);
      try { await run('/usr/bin/security', ['import', p12, '-k', keychain, '-P', p12pass, '-T', '/usr/bin/codesign']); }
      finally { await fs.rm(temp, { recursive: true, force: true }); temp = null; }
      await run('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain]);
      const id = await findIdentity();
      if (!id) throw new Error('İmza kimliği bulunamadı');
      return { keychain, id };
    } catch (_) {
      // Creation errors may contain command arguments. Never log passwords.
      // Do not reuse a partially imported identity without its non-interactive ACL.
      if (created) {
        try { await run('/usr/bin/security', ['delete-keychain', keychain]); } catch (_) {}
      }
      return null;
    } finally { if (temp) await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
  }
  async function signApp(bundle, identity) {
    try {
      if (identity === undefined) identity = await ensureIdentity();
      if (identity) {
        const password = (await fs.readFile(passFile, 'utf8')).trim();
        await run('/usr/bin/security', ['unlock-keychain', '-p', password, identity.keychain]);
        await run('/usr/bin/codesign', ['--force', '--deep', '--keychain', identity.keychain, '--sign', identity.id, bundle]);
      } else {
        await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]);
        // Only the outer bundle gets the requirement; helpers retain their identifiers.
        await run('/usr/bin/codesign', ['--force', '--sign', '-', '-r=' + ADHOC_REQUIREMENT, bundle]);
      }
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
      if (identity) {
        const requirement = outputText(await run('/usr/bin/codesign', ['-dr', '-', bundle]));
        if (!requirement.includes('identifier "com.volkan.deck"') ||
            !requirement.toLowerCase().includes('certificate leaf = h"' + identity.id.toLowerCase() + '"'))
          throw new Error('Sertifika gereksinimi doğrulanamadı');
      }
    } catch (_) {
      const e = new Error('Uygulama imzası doğrulanamadı; kurulum betiğini yeniden çalıştır.');
      e.userMessage = e.message;
      throw e;
    }
  }
  return { ensureIdentity, signApp };
}

module.exports = { createMacSigner, CN, KEYCHAIN, ADHOC_REQUIREMENT };
