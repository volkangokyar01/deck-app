const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ASSETS, download, run } = require('./stats-assets');
const quotePS = value => "'" + String(value).replace(/'/g, "''") + "'";
const encodePS = value => Buffer.from(value, 'utf16le').toString('base64');
function createSensorInstaller({ fetch, cacheDir }) {
  let sid = null, operation = null, sensorDisabled = false;
  const powershell = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const outputDir = () => sid ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'VolkanDeckSensors', sid) : null;
  async function init() {
    if (process.platform !== 'win32' || sid) return;
    const result = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
    sid = result.match(/S-1-5-21-[\d-]+/)?.[0] || null;
  }
  async function status() {
    try { await init(); } catch (_) {}
    const file = outputDir() && path.join(outputDir(), 'readings.json');
    const marker = sid && path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VolkanDeckSensors', sid, 'install.json');
    let live = false;
    try { const age = Date.now() - JSON.parse(fs.readFileSync(file, 'utf8')).epoch * 1000; live = !sensorDisabled && age >= 0 && age < 5000; } catch (_) {}
    return { installed: !!sid && (fs.existsSync(marker) || fs.existsSync(outputDir())), live };
  }
  async function elevate(script, parameters) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const resultDir = fs.mkdtempSync(path.join(cacheDir, 'sensor-result-'));
    const resultFile = path.join(resultDir, 'result.json');
    const source = path.join(__dirname, script);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    // The elevated bootstrap runs only built-in commands. Copy the script into an
    // admin-owned directory and verify that copy before executing it, never -File app/.
    const bootstrap = `
$ErrorActionPreference='Stop'
$env:PSModulePath = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\\v1.0\\Modules'
$env:PATH = [Environment]::GetFolderPath('System')
Set-Location -LiteralPath ([Environment]::GetFolderPath('System'))
$env:ProgramFiles = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion').ProgramFilesDir
$env:ProgramData = [Environment]::GetFolderPath('CommonApplicationData')
$root = Join-Path $env:ProgramFiles 'VolkanDeckSensors'
$stage = $null; $locked = $false; $mutex = $null; $result = $null
function Protect($dir) {
  if (Test-Path -LiteralPath $dir) {
    $item = Get-Item -LiteralPath $dir -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        (Get-Acl -LiteralPath $dir).GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Sensör klasörü güvenli değil.' }
  } else { New-Item -ItemType Directory -Path $dir | Out-Null }
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true,$false)
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  foreach ($id in @('S-1-5-18','S-1-5-32-544')) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($id),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
  }
  Set-Acl -LiteralPath $dir -AclObject $acl
}
try {
  # Serialize installs/removals across Windows users, including ownership handoff.
  $security = [Security.AccessControl.MutexSecurity]::new()
  foreach ($id in @('S-1-5-18','S-1-5-32-544')) {
    $security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new([Security.Principal.SecurityIdentifier]::new($id),'FullControl','Allow'))
  }
  $created = $false
  $mutex = [Threading.Mutex]::new($false,'Global\\VolkanDeckSensors-Setup',[ref]$created,$security)
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Başka bir sensör kurulum/kaldırma işlemi sürüyor; bitince tekrar deneyin.' }
  Protect $root
  $stage = Join-Path $root ('.operation-' + [Guid]::NewGuid().ToString('N'))
  Protect $stage
  $target = Join-Path $stage ${quotePS(script)}
  Copy-Item -LiteralPath ${quotePS(source)} -Destination $target
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne ${quotePS(hash)}) { throw 'Sensör betiği doğrulanamadı.' }
  $parameters = @{ ${Object.entries({ ...parameters, UserSid: sid }).map(([key, value]) => key + ' = ' + quotePS(value)).join('; ')} }
  $result = & $target @parameters
} catch { $result = @{ ok=$false; message='Sensör işlemi tamamlanamadı: ' + $_.Exception.Message } }
finally {
  if ($locked) {
    try {
      if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
      if ((Test-Path -LiteralPath $root) -and @(Get-ChildItem -LiteralPath $root -Force).Count -eq 0) { Remove-Item -LiteralPath $root -Force }
    } catch { $result.ok=$false; $result.message += ' Geçici kurulum klasörü silinemedi: ' + $_.Exception.Message }
    $mutex.ReleaseMutex()
  }
  if ($mutex) { $mutex.Dispose() }
}
# Write data only, using CreateNew so a pre-existing file/link cannot be overwritten
# with administrator rights. Nothing from this user-writable result path is loaded.
$bytes = [Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json -Depth 4 -Compress))
$stream = [IO.File]::Open(${quotePS(resultFile)},[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
exit 0
`;
    const line = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + encodePS(bootstrap);
    const command = "$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath " + quotePS(powershell()) + ' -WorkingDirectory ' + quotePS(path.dirname(powershell())) + ' -Verb RunAs -ArgumentList ' + quotePS(line) + ' -Wait -PassThru; Write-Output $p.ExitCode } catch { if ($_.Exception.NativeErrorCode -eq 1223) { Write-Output 1223 } else { Write-Output 1 } }';
    try {
      const code = (await run(powershell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePS(command)], 180000)).trim();
      if (code === '1223') return { ok: false, message: 'Yönetici onayı iptal edildi; değişiklik yapılmadı.' };
      if (code !== '0') return { ok: false, message: 'Sensör işlemi tamamlanamadı; Windows sürücü izinlerini kontrol edip tekrar deneyin.' };
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, ''));
      if (typeof result.ok !== 'boolean' || typeof result.message !== 'string') throw new Error('İşlem sonucu okunamadı.');
      return result;
    } finally { fs.rmSync(resultDir, { recursive: true, force: true }); }
  }
  async function installOnce() {
    if (process.platform !== 'win32') return { ok: false, message: 'Bu adım yalnız Windows içindir.' };
    try {
      await init(); if (!sid) throw new Error('Windows kullanıcı kimliği okunamadı.');
      const dir = path.join(cacheDir, 'windows-sensors');
      const installer = await download(fetch, ASSETS.pawnio, dir);
      const archive = await download(fetch, ASSETS.lhm, dir);
      const signature = await run(powershell(), ['-NoProfile', '-NonInteractive', '-Command', '(Get-AuthenticodeSignature -LiteralPath ' + quotePS(installer) + ').Status.ToString()']);
      if (signature.trim() !== 'Valid') throw new Error('PawnIO kurulum dosyasının imzası geçerli değil.');
      const result = await elevate('sensor-setup.ps1', { Installer: installer, Archive: archive, Helper: path.join(__dirname, 'win-sensors.ps1') });
      if (result.ok) sensorDisabled = false;
      return result;
    } catch (e) { return { ok: false, message: 'Sensör kurulamadı: ' + e.message }; }
  }
  async function uninstallOnce() {
    if (process.platform !== 'win32') return { ok: false, message: 'Bu adım yalnız Windows içindir.' };
    try {
      await init(); if (!sid) throw new Error('Windows kullanıcı kimliği okunamadı.');
      const result = await elevate('sensor-uninstall.ps1', {});
      if (result.ok || result.stopped) sensorDisabled = true;
      return result;
    } catch (e) { return { ok: false, message: 'Sensör kaldırılamadı: ' + e.message }; }
  }
  function start(action) {
    if (operation) return Promise.resolve({ ok: false, message: 'Sensör işlemi sürüyor; bitince tekrar deneyin.' });
    operation = action().finally(() => { operation = null; }); return operation;
  }
  return { init, status, install: () => start(installOnce), uninstall: () => start(uninstallOnce), sensorFile: () => !sensorDisabled && outputDir() ? path.join(outputDir(), 'readings.json') : null };
}
module.exports = { createSensorInstaller };
