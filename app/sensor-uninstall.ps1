# Invoked from protected Program Files by the same one-UAC launcher as setup.
param([Parameter(Mandatory=$true)][ValidatePattern('^S-1-5-21-[0-9-]+$')][string]$UserSid)
$ErrorActionPreference = 'Stop'
$failures = [Collections.Generic.List[string]]::new()
$notes = [Collections.Generic.List[string]]::new()
$root = Join-Path $env:ProgramFiles 'VolkanDeckSensors'
$install = Join-Path $root $UserSid
$dataRoot = Join-Path $env:ProgramData 'VolkanDeckSensors'
$output = Join-Path $dataRoot $UserSid
$taskName = 'VolkanDeckSensors-' + $UserSid
$registryPaths = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
function Assert-Protected($path) {
  # Refuse junctions and writable files/directories, including ancestors.
  $trusted = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $item = Get-Item -LiteralPath $path -Force
  while ($item) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Bağlantı yolu kabul edilmedi: $($item.FullName)" }
    $acl = Get-Acl -LiteralPath $item.FullName
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw "Yolun sahibi güvenli değil: $($item.FullName)" }
    $write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor
      [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $write) -and
          $rule.IdentityReference.Value -notin ($trusted + @('S-1-3-0')) -and
          -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { throw "Yazılabilir yol kabul edilmedi: $($item.FullName)" }
    }
    # ProgramData can allow creation of sibling folders. The protected sensor root
    # blocks replacement of our children; do not reject the standard system parent.
    $item = if ($item -is [IO.FileInfo]) { $item.Directory } else { $item.Parent }
    if ($item -and $item.FullName -eq $env:ProgramData) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'ProgramData bağlantı klasörü kabul edilmedi.' }
      break
    }
    if ($item -and -not $item.Parent) { break }
  }
}
function Remove-SensorDirectory($dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return }
  Assert-Protected $dir
  # Do not recursively follow a link hidden inside an otherwise protected tree.
  foreach ($item in Get-ChildItem -LiteralPath $dir -Recurse -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Klasörde bağlantı var: $($item.FullName)" }
  }
  Remove-Item -LiteralPath $dir -Recurse -Force
}
$owned = $false
try {
  $markerFile = Join-Path $install 'install.json'
  if (Test-Path -LiteralPath $markerFile) {
    Assert-Protected $markerFile
    $marker = Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json
    $owned = $marker.pawnioInstalledByUs -eq $true
  } else { $notes.Add('Kurulum sahiplik kaydı bulunamadı; PawnIO güvenlik için bırakıldı.') }
} catch { $failures.Add('Kurulum kaydı okunamadı: ' + $_.Exception.Message) }
try {
  $task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
  if ($task) { Stop-ScheduledTask -InputObject $task }
} catch { $failures.Add('Sensör görevi durdurulamadı: ' + $_.Exception.Message) }
try {
  if (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false
  }
} catch { $failures.Add('Sensör görevi silinemedi: ' + $_.Exception.Message) }
$stopped = $false
try {
  $helper = Join-Path $install 'win-sensors.ps1'
  $pattern = '(?i)(?:^|\s)-File\s+"' + [regex]::Escape($helper) + '"(?:\s|$)'
  foreach ($process in Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'") {
    if ($process.ProcessId -ne $PID -and $process.CommandLine -match $pattern) {
      # Target this user's exact helper path; never kill all PowerShell processes.
      try { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop }
      catch { if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) { throw } }
    }
  }
  $stopped = $true
} catch { $failures.Add('Çalışan sensör işlemi kapatılamadı: ' + $_.Exception.Message) }
try {
  # Enumeration errors must not look like zero other users.
  $others = @(Get-ScheduledTask | Where-Object { $_.TaskName -like 'VolkanDeckSensors-*' -and $_.TaskName -ne $taskName })
  $ownTaskRemains = @(Get-ScheduledTask | Where-Object { $_.TaskName -eq $taskName }).Count -gt 0
  if ($owned -and $others.Count -gt 0) {
    # Hand ownership to remaining users, so the last user can remove our shared driver.
    foreach ($other in $others) {
      $otherSid = $other.TaskName.Substring('VolkanDeckSensors-'.Length)
      if ($otherSid -notmatch '^S-1-5-21-[0-9-]+$') { continue }
      $otherMarker = Join-Path (Join-Path $root $otherSid) 'install.json'
      Assert-Protected $otherMarker
      $record = Get-Content -LiteralPath $otherMarker -Raw | ConvertFrom-Json
      $record.pawnioInstalledByUs = $true
      $record | ConvertTo-Json -Compress | Set-Content -LiteralPath $otherMarker -Encoding UTF8
    }
    $notes.Add('PawnIO başka bir Windows kullanıcısının sensör görevi için bırakıldı.')
  } elseif ($owned -and $stopped -and -not $ownTaskRemains) {
    $keys = @(Get-ItemProperty -Path $registryPaths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'PawnIO*' })
    if ($keys.Count -gt 1) { throw 'Birden fazla PawnIO kaydı var; sürücü kaldırılmadı.' }
    $uninstaller = $null
    if ($keys.Count -eq 1) {
      # Parse the executable only. Never evaluate an HKLM command as PowerShell code.
      $line = $keys[0].UninstallString
      if ($line -match '^\s*"([^"]+\.exe)"\s+-uninstall(?:\s+-silent)?\s*$') { $uninstaller = $Matches[1] }
      elseif ($line -match '^\s*(.+\.exe)\s+-uninstall(?:\s+-silent)?\s*$') { $uninstaller = $Matches[1] }
      else { throw 'PawnIO kaldırma komutu tanınmadı; Uygulamalar ve özellikler bölümünden kaldırın.' }
    } elseif (Test-Path -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\PawnIO') {
      $uninstaller = Join-Path $install 'PawnIO_setup.exe'
      if ((Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash -ne '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032') { throw 'PawnIO kaldırıcı SHA-256 doğrulaması başarısız.' }
    }
    if ($uninstaller) {
      Assert-Protected $uninstaller
      if ((Get-AuthenticodeSignature -LiteralPath $uninstaller).Status -ne 'Valid') { throw 'PawnIO kaldırıcı imzası geçerli değil.' }
      # PawnIO.Setup 2.2.0: registered uninstall.exe, or the pinned setup, accepts these switches.
      # https://community.chocolatey.org/packages/pawnio/2.2.0 (tools/helpers.ps1)
      $p = Start-Process -FilePath $uninstaller -ArgumentList '-uninstall', '-silent' -WorkingDirectory (Split-Path -Parent $uninstaller) -Wait -PassThru
      if ($p.ExitCode -notin @(0, 3010)) { throw "PawnIO kaldırıcı hata verdi ($($p.ExitCode))." }
      $notes.Add('PawnIO sürücüsü kaldırıldı.' + $(if ($p.ExitCode -eq 3010) { ' Bilgisayarı yeniden başlatın.' } else { '' }))
    } else { $notes.Add('PawnIO sürücüsü zaten kaldırılmış.') }
  } elseif (-not $owned -and $marker) {
    $notes.Add('PawnIO başka bir program için zaten kuruluydu, dokunulmadı')
  } elseif ($owned) { throw 'Sensör görevi/işlemi hâlâ etkin; PawnIO kaldırılmadı.' }
} catch { $failures.Add('PawnIO kaldırılamadı: ' + $_.Exception.Message) }
if ($stopped) {
  foreach ($dir in @($install, $output)) {
    try { Remove-SensorDirectory $dir } catch { $failures.Add("Klasör silinemedi ($dir): " + $_.Exception.Message) }
  }
} else { $failures.Add('İşlem kapatılamadığı için sensör klasörleri bırakıldı.') }
foreach ($dir in @($root, $dataRoot)) {
  try {
    if (Test-Path -LiteralPath $dir) {
      Assert-Protected $dir
      if (@(Get-ChildItem -LiteralPath $dir -Force).Count -eq 0) { Remove-Item -LiteralPath $dir -Force }
    }
  } catch { $failures.Add("Boş ana klasör silinemedi ($dir): " + $_.Exception.Message) }
}
$message = if ($failures.Count -eq 0) { 'Sensör kurulumu kaldırıldı. CPU sıcaklığı artık “—” görünür; yeniden kurabilirsiniz.' } else { 'Sensör kaldırma işlemi kısmen tamamlandı.' }
if ($notes.Count) { $message += ' ' + ($notes -join ' ') }
if ($failures.Count) { $message += "`nTamamlanamayan adımlar:`n- " + ($failures -join "`n- ") }
@{ ok = ($failures.Count -eq 0); stopped = $stopped; message = $message; failures = @($failures.ToArray()) }
