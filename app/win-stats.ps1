# Independent from the media helper: a slow SMTC call cannot block network samples.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# The process that owns the foreground window: the in-game FPS card shows that process (2026-10-12)
Add-Type -Namespace GameDeck -Name Fg -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
'@
while ($true) {
  try {
    $counters = @{}
    foreach ($nic in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($nic.OperationalStatus -ne 'Up' -or $nic.NetworkInterfaceType -eq 'Loopback') { continue }
      try {
        $s = $nic.GetIPStatistics()
        $counters[$nic.Id] = @{ down = $s.BytesReceived; up = $s.BytesSent }
      } catch {} # unsupported virtual adapters must not hide the remaining interfaces
    }
    $fg = [uint32]0
    try { [void][GameDeck.Fg]::GetWindowThreadProcessId([GameDeck.Fg]::GetForegroundWindow(), [ref]$fg) } catch {}
    [Console]::Out.WriteLine((@{ nics = $counters; fg = $fg } | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
  } catch {}
  Start-Sleep -Milliseconds 1000
}
