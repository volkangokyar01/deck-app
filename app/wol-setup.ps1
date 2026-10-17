# Wake-on-LAN settings for Windows (2026-10-17, firmware 1.17.0). Invoked from protected Program Files by the
# same one-UAC launcher as the sensor setup. Lets the deck turn this computer on from sleep and from shutdown:
# - the wired network card wakes on a magic packet (also from S5 / shutdown when the driver supports it)
# - the deck's USB keyboard may wake the computer from sleep
# - fast startup is turned off (with it, "shut down" is a hibernate state many cards cannot wake from)
# The BIOS setting (Wake on LAN on, ErP off) cannot be changed from Windows; the app shows those steps.
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^S-1-5-21-[0-9-]+$')][string]$UserSid,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$')][string]$Mac
)
$ErrorActionPreference = 'Stop'
$done = [Collections.Generic.List[string]]::new()
$failures = [Collections.Generic.List[string]]::new()
$want = ($Mac -replace '[:-]', '').ToUpperInvariant()
$nic = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { ($_.MacAddress -replace '-', '').ToUpperInvariant() -eq $want } | Select-Object -First 1
if (-not $nic) {
  return @{ ok = $false; message = "Ağ kartı bulunamadı ($Mac). Ethernet kablosunun takılı olduğundan emin olun." }
}
# Driver advanced properties: registry keywords are standard; display names vary by vendor (Realtek / Intel)
$props = @(Get-NetAdapterAdvancedProperty -Name $nic.Name -AllProperties -ErrorAction SilentlyContinue)
function Enable-Prop($keywords, $names, $label) {
  $p = $props | Where-Object { $_.RegistryKeyword -in $keywords -or $_.DisplayName -in $names } | Select-Object -First 1
  if (-not $p) { return }
  try {
    $on = $null
    if ($p.ValidRegistryValues) { foreach ($v in @('1', '2', '3')) { if ($v -in $p.ValidRegistryValues) { $on = $v; break } } }
    if (-not $on) { $on = '1' }
    if ("$($p.RegistryValue)" -ne $on) { Set-NetAdapterAdvancedProperty -Name $nic.Name -RegistryKeyword $p.RegistryKeyword -RegistryValue $on -NoRestart }
    $done.Add($label)
  } catch { $failures.Add("$label açılamadı: " + $_.Exception.Message) }
}
Enable-Prop @('*WakeOnMagicPacket') @('Wake on Magic Packet', 'Magic Paketinde Uyandır') 'Magic Packet ile uyanma'
Enable-Prop @('S5WakeOnLan', '*S5WakeOnLan') @('Shutdown Wake-On-Lan', 'Shutdown Wake Up', 'Kapanmada Wake-On-Lan') 'Kapalıyken uyanma (S5)'
Enable-Prop @('*WakeOnPattern') @('Wake on pattern match') 'Desen ile uyanma'
# Realtek's power saving can cut the link while the computer is off
foreach ($kw in @('PowerDownPll', '*PowerSavingMode', 'EnableGreenEthernet')) {
  $p = $props | Where-Object { $_.RegistryKeyword -eq $kw } | Select-Object -First 1
  if ($p -and "$($p.RegistryValue)" -ne '0') { try { Set-NetAdapterAdvancedProperty -Name $nic.Name -RegistryKeyword $kw -RegistryValue '0' -NoRestart } catch {} }
}
try {
  Set-NetAdapterPowerManagement -Name $nic.Name -WakeOnMagicPacket Enabled -ErrorAction Stop
  $done.Add('Ağ kartı güç yönetimi')
} catch { $failures.Add('Ağ kartı güç yönetimi: ' + $_.Exception.Message) }
# "Allow this device to wake the computer" for the network card and the deck (USB VID 303A)
$wakeable = @(& powercfg.exe /devicequery wake_programmable)
$armed = @(& powercfg.exe /devicequery wake_armed)
function Arm($name, $label) {
  if ($name -in $armed) { $done.Add($label); return }
  & powercfg.exe /deviceenablewake "$name" | Out-Null
  if ($LASTEXITCODE -eq 0) { $done.Add($label) } else { $failures.Add("$label için uyandırma izni verilemedi") }
}
$nicDev = $wakeable | Where-Object { $_ -eq $nic.InterfaceDescription } | Select-Object -First 1
if ($nicDev) { Arm $nicDev 'Ağ kartı uyandırabilir' } else { $failures.Add('Ağ kartı Windows tarafından uyandırıcı olarak gösterilmiyor') }
$deck = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match 'VID_303A' -and $_.FriendlyName -in $wakeable })
$deckArmed = $false
foreach ($d in $deck) { $before = $failures.Count; Arm $d.FriendlyName 'Deck uykudan uyandırabilir'; if ($failures.Count -eq $before) { $deckArmed = $true; break } }
if (-not $deck.Count) { $done.Add('Deck USB ile takılı değil (uykudan USB ile uyandırma için kabloyla takıp tekrar çalıştırın)') }
# Fast startup off
try {
  Set-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 0 -Type DWord
  $done.Add('Hızlı başlatma kapatıldı')
} catch { $failures.Add('Hızlı başlatma kapatılamadı: ' + $_.Exception.Message) }
$message = if ($failures.Count -eq 0) { 'Windows ayarları tamam (' + $nic.Name + '). Son adım: BIOS''ta Wake on LAN açık, ErP kapalı olmalı.' } else { 'Windows ayarları kısmen yapıldı.' }
if ($done.Count) { $message += "`nYapılanlar: " + ($done -join ', ') }
if ($failures.Count) { $message += "`nYapılamayanlar:`n- " + ($failures -join "`n- ") }
@{ ok = ($failures.Count -eq 0); message = $message; adapter = $nic.Name; deck = $deckArmed }
