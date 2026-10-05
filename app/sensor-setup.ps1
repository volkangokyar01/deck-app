# One UAC operation installs the signed driver and an immutable, read-only sensor task.
param([Parameter(Mandatory=$true)][string]$Installer,
      [Parameter(Mandatory=$true)][string]$Archive,
      [Parameter(Mandatory=$true)][string]$Helper,
      [Parameter(Mandatory=$true)][ValidatePattern('^S-1-5-21-[0-9-]+$')][string]$UserSid)
$ErrorActionPreference = 'Stop'
function Assert-Hash($file, $hash) {
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hash) { throw 'SHA-256 doğrulaması başarısız.' }
}
function Protect-Directory($dir, $reader) {
  if (Test-Path -LiteralPath $dir) {
    if ((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Bağlantı klasörü kabul edilmedi.' }
    $owner = (Get-Acl -LiteralPath $dir).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @('S-1-5-18', 'S-1-5-32-544')) { throw 'Sensör klasörünün sahibi güvenli değil.' }
  } else { New-Item -ItemType Directory -Path $dir | Out-Null }
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  }
  if ($reader) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($reader), 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')) }
  Set-Acl -LiteralPath $dir -AclObject $acl
}
try {
  # Look before running the installer; refreshing an owned installation keeps ownership.
  $registryPaths = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
  $pawnioPresent = @(Get-ItemProperty -Path $registryPaths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'PawnIO*' }).Count -gt 0 -or
    (Test-Path -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\PawnIO')
  Assert-Hash $Installer '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032'
  Assert-Hash $Archive '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001'
  if ((Get-AuthenticodeSignature -LiteralPath $Installer).Status -ne 'Valid') { throw 'PawnIO imzası geçerli değil.' }
  $root = Join-Path $env:ProgramFiles 'VolkanDeckSensors'
  Protect-Directory $root $null
  $install = Join-Path $root $UserSid
  Protect-Directory $install $UserSid
  $markerFile = Join-Path $install 'install.json'
  $owned = -not $pawnioPresent
  if (Test-Path -LiteralPath $markerFile) {
    $previous = Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json
    $owned = $owned -or ($previous.pawnioInstalledByUs -eq $true)
  }
  $dataRoot = Join-Path $env:ProgramData 'VolkanDeckSensors'
  Protect-Directory $dataRoot $null
  $output = Join-Path $dataRoot $UserSid
  Protect-Directory $output $UserSid
  # Never schedule an elevated process that loads scripts/DLLs from user-writable app/cache.
  $taskName = 'VolkanDeckSensors-' + $UserSid
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $taskName; Start-Sleep -Seconds 1 }
  $signedSetup = Join-Path $install 'PawnIO_setup.exe'
  Copy-Item -LiteralPath $Installer -Destination $signedSetup -Force
  Assert-Hash $signedSetup '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032'
  $p = Start-Process -FilePath $signedSetup -ArgumentList '-install', '-silent' -Wait -PassThru
  if ($p.ExitCode -notin @(0, 3010)) { throw "PawnIO kurulumu başarısız ($($p.ExitCode))." }
  # Record immediately, so a later task/DLL failure can still be uninstalled safely.
  @{ pawnioInstalledByUs = [bool]$owned; version = '2.2.0'; date = [DateTimeOffset]::UtcNow.ToString('o') } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $markerFile -Encoding UTF8
  $zip = Join-Path $install 'lhm.zip'
  Copy-Item -LiteralPath $Archive -Destination $zip -Force
  Assert-Hash $zip '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001'
  $lhm = Join-Path $install 'lhm'
  if (Test-Path -LiteralPath $lhm) { Remove-Item -LiteralPath $lhm -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $lhm
  if (-not (Test-Path -LiteralPath (Join-Path $lhm 'LibreHardwareMonitorLib.dll'))) { throw 'Sensör DLL dosyası bulunamadı.' }
  # Keep release dependencies/licenses, remove UI and any legacy driver payloads.
  Get-ChildItem -LiteralPath $lhm -Recurse -File | Where-Object { $_.Extension -in @('.exe', '.sys') -or $_.Name -like '*WinRing0*' } | Remove-Item -Force
  Copy-Item -LiteralPath $Helper -Destination (Join-Path $install 'win-sensors.ps1') -Force
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $args = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $install 'win-sensors.ps1') + '" -OutputDir "' + $output + '"'
  $action = New-ScheduledTaskAction -Execute $ps -Argument $args -WorkingDirectory $install
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserSid
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  @{ ok = $true; message = 'CPU sıcaklığı sürücüsü ve sensör görevi kuruldu. Sonraki açılışlarda yönetici onayı istenmez; değer gelmezse bilgisayarı yeniden başlat.' }
} catch { @{ ok = $false; message = 'Sensör kurulamadı: ' + $_.Exception.Message } }
