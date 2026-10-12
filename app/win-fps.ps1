# In-game FPS (2026-10-12). Runs as SYSTEM from the protected sensor directory (the ETW frame events that
# PresentMon reads need administrator rights). No network. Every second it writes fps.json: frames per
# second and the 1 % low of the last 60 s for each process that presented frames in the last 3 s.
# The desktop app picks the process that owns the foreground window (it runs in the user's session).
param([Parameter(Mandatory=$true)][string]$OutputDir)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'PresentMon.exe'
$session = 'GameDeckFPS'
function Write-Fps($procs) {
  try {
    $tmp = Join-Path $OutputDir 'fps.tmp'
    $json = @{ epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); procs = @($procs) } | ConvertTo-Json -Compress -Depth 4
    [IO.File]::WriteAllText($tmp, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tmp -Destination (Join-Path $OutputDir 'fps.json') -Force
  } catch {} # an unavailable output directory must not crash the task
}
$clock = [Diagnostics.Stopwatch]::StartNew()
while ($true) {
  $p = $null
  try {
    $psi = [Diagnostics.ProcessStartInfo]::new($exe)
    # Only frame times are needed: no GPU, input or display tracking (lighter), no console table.
    $psi.Arguments = '--output_stdout --no_console_stats --session_name ' + $session + ' --stop_existing_session --no_track_gpu --no_track_input --no_track_display --exclude dwm.exe'
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.CreateNoWindow = $true
    $p = [Diagnostics.Process]::Start($psi)
    $iApp = -1; $iPid = -1; $iMs = -1
    $seen = @{}                                   # pid -> @{ name; t = Queue[double] (ms clock); f = Queue[double] (frame ms) }
    $next = $clock.ElapsedMilliseconds + 1000
    while ($true) {
      $line = $p.StandardOutput.ReadLine()
      if ($null -eq $line) { break }              # PresentMon exited
      $c = $line.Split(',')
      if ($iMs -lt 0) {                           # header: find the columns by name (1.x / 2.x spellings)
        for ($i = 0; $i -lt $c.Length; $i++) {
          switch ($c[$i].Trim()) { 'Application' { $iApp = $i } 'ProcessID' { $iPid = $i } 'MsBetweenPresents' { $iMs = $i } }
        }
        continue
      }
      $now = $clock.ElapsedMilliseconds
      if ($c.Length -gt [Math]::Max($iMs, [Math]::Max($iApp, $iPid))) {
        $id = 0; $ms = 0.0
        if ([int]::TryParse($c[$iPid], [ref]$id) -and [double]::TryParse($c[$iMs], [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$ms) -and $ms -gt 0 -and $ms -lt 5000) {
          $e = $seen[$id]
          if (-not $e) { $e = @{ name = $c[$iApp]; t = [Collections.Generic.Queue[double]]::new(); f = [Collections.Generic.Queue[double]]::new() }; $seen[$id] = $e }
          $e.t.Enqueue($now); $e.f.Enqueue($ms)
        }
      }
      if ($now -lt $next) { continue }
      $next = $now + 1000
      $out = [Collections.Generic.List[object]]::new()
      foreach ($id in @($seen.Keys)) {
        $e = $seen[$id]
        while ($e.t.Count -and $now - $e.t.Peek() -gt 60000) { [void]$e.t.Dequeue(); [void]$e.f.Dequeue() }
        if (-not $e.t.Count -or $now - ($e.t.ToArray()[-1]) -gt 3000) { if (-not $e.t.Count) { $seen.Remove($id) }; continue }
        $t = $e.t.ToArray(); $f = $e.f.ToArray()
        # FPS from the newest frames covering ~1 s of frame time (their own durations), not from when the lines
        # arrived: PresentMon's piped output comes in bursts, which made some seconds look empty (2026-10-12)
        $sum = 0.0; $n = 0
        for ($i = $f.Length - 1; $i -ge 0 -and $sum -lt 1000; $i--) { $sum += $f[$i]; $n++ }
        if ($n -lt 2 -or $sum -le 0) { continue }
        $sorted = [double[]]$f.Clone(); [Array]::Sort($sorted)
        $p99 = $sorted[[Math]::Min($sorted.Length - 1, [int][Math]::Floor($sorted.Length * 0.99))]
        $out.Add(@{ pid = $id; name = $e.name; fps = [Math]::Round(1000.0 * $n / $sum, 1); low = [Math]::Round(1000.0 / $p99, 1) })
      }
      Write-Fps $out
    }
  } catch {}
  finally {
    if ($p) { try { if (-not $p.HasExited) { $p.Kill() } } catch {}; $p.Dispose() }
  }
  Write-Fps @()
  Start-Sleep -Seconds 5                           # PresentMon could not start or stopped: try again
}
