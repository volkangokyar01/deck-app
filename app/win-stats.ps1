# Independent from the media helper: a slow SMTC call cannot block network samples.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
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
    [Console]::Out.WriteLine(($counters | ConvertTo-Json -Compress -Depth 3))
    [Console]::Out.Flush()
  } catch {}
  Start-Sleep -Milliseconds 1000
}
