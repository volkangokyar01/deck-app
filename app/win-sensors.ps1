# Runs as SYSTEM from a protected Program Files directory. No requests or network.
param([Parameter(Mandatory=$true)][string]$OutputDir)
$ErrorActionPreference = 'Stop'
$computer = $null
$nextOpen = [DateTime]::MinValue
function Update-Hardware($hw) {
  $hw.Update()
  foreach ($sub in $hw.SubHardware) { Update-Hardware $sub }
}
function Get-Sensors($hw) {
  $hw.Sensors
  foreach ($sub in $hw.SubHardware) { Get-Sensors $sub }
}
try {
  [Reflection.Assembly]::LoadFrom((Join-Path $PSScriptRoot 'lhm\LibreHardwareMonitorLib.dll')) | Out-Null
  while ($true) {
    $reading = @{ epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); temp = $null; power = $null }
    try {
      if (-not $computer -and [DateTime]::UtcNow -ge $nextOpen) {
        $computer = New-Object LibreHardwareMonitor.Hardware.Computer
        $computer.IsCpuEnabled = $true
        $computer.Open()
      }
      if ($computer) {
        foreach ($hw in $computer.Hardware) {
          if ($hw.HardwareType -ne 'Cpu') { continue }
          Update-Hardware $hw
          $sensors = @(Get-Sensors $hw)
          foreach ($name in @('CPU Package', 'Tctl/Tdie', 'Core (Tctl/Tdie)', 'CPU (Tctl/Tdie)')) {
            $sensor = $sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -eq $name -and $null -ne $_.Value } | Select-Object -First 1
            if ($sensor -and $sensor.Value -gt 0 -and $sensor.Value -le 150) { $reading.temp = [double]$sensor.Value; break }
          }
          $power = $sensors | Where-Object { $_.SensorType -eq 'Power' -and $_.Name -in @('CPU Package', 'Package') -and $null -ne $_.Value } | Select-Object -First 1
          if ($power -and $power.Value -ge 0 -and $power.Value -lt 3000) { $reading.power = [double]$power.Value }
          break # same first CPU package as os.cpus()
        }
      }
    } catch {
      $reading.temp = $null; $reading.power = $null
      if ($computer) { try { $computer.Close() } catch {} }; $computer = $null
      $nextOpen = [DateTime]::UtcNow.AddSeconds(15)
    }
    try {
      $tmp = Join-Path $OutputDir 'readings.tmp'
      [IO.File]::WriteAllText($tmp, ($reading | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
      Move-Item -LiteralPath $tmp -Destination (Join-Path $OutputDir 'readings.json') -Force
    } catch {} # an unavailable output directory must not crash the task
    Start-Sleep -Milliseconds 1000
  }
} finally { if ($computer) { try { $computer.Close() } catch {} } }
