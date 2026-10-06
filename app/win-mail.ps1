# Volkan Deck - Outlook helper (Windows, classic Outlook over COM; started by the desktop app, one JSON request per line on stdin)
#   mail : { running, newOutlook, unread } over the inboxes of every account; with "top":true also the newest unread subject
# Never starts Outlook: it only attaches to a running one. Reads Subject / ReceivedTime / UnRead / UnReadItemCount only,
# none of which trigger Outlook's security prompt.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$ol = $null; $inboxes = @(); $inboxesAt = [datetime]::MinValue
function Reset-Outlook {
  foreach ($f in $script:inboxes) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($f) } catch {} }
  if ($script:ol) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($script:ol) } catch {} }
  $script:ol = $null; $script:inboxes = @(); $script:inboxesAt = [datetime]::MinValue
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
# inbox of every store (account), refreshed each minute so a new account is picked up
function Get-Inboxes {
  if (-not $script:ol) { $script:ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
  if ($script:inboxes.Count -gt 0 -and ((Get-Date) - $script:inboxesAt).TotalSeconds -lt 60) { return , $script:inboxes }
  $list = @()
  foreach ($st in $script:ol.Session.Stores) { try { $f = $st.GetDefaultFolder(6); if ($f) { $list += $f } } catch {} }   # 6 = olFolderInbox
  if ($list.Count -eq 0) { $list = @($script:ol.Session.GetDefaultFolder(6)) }
  $script:inboxes = $list; $script:inboxesAt = Get-Date
  return , $list
}
function Get-Mail([bool]$top) {
  $r = @{ running = $false; newOutlook = ([Diagnostics.Process]::GetProcessesByName('olk').Length -gt 0) }
  if ([Diagnostics.Process]::GetProcessesByName('OUTLOOK').Length -eq 0) { if ($script:ol) { Reset-Outlook }; return $r }
  $r.running = $true
  try {
    $n = 0
    foreach ($f in (Get-Inboxes)) { $n += [int]$f.UnReadItemCount }
    $r.unread = $n
    if ($top) {                                  # only when the count went up: sorting is the expensive part
      $best = $null; $bestAt = [datetime]::MinValue
      foreach ($f in (Get-Inboxes)) {
        try {
          $items = $f.Items
          $items.Sort('[ReceivedTime]', $true)
          $it = $items.GetFirst()
          if ($it -and $it.UnRead -and $it.ReceivedTime -gt $bestAt) { $best = $it; $bestAt = $it.ReceivedTime }
        } catch {}
      }
      if ($best) { $r.subject = [string]$best.Subject }
    }
  } catch {
    Reset-Outlook                               # closed, restarted or still starting: attach again on the next request
    $r.error = $_.Exception.Message
  }
  return $r
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $res = @{ ok = $false }
  try {
    $q = $line | ConvertFrom-Json
    $res.id = $q.id
    switch ($q.op) {
      'mail' { $res.r = Get-Mail ([bool]$q.top) }
      default { throw "unknown op $($q.op)" }
    }
    $res.ok = $true
  } catch { $res.error = $_.Exception.Message }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}
