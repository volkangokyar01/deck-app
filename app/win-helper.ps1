# Volkan Deck - Windows helper (kept running by the desktop app, one JSON request per line on stdin)
#   media     : media sessions (Spotify, Apple Music, browsers, ...) via Windows' System Media Transport Controls
#   mctl      : play/pause, next, previous on one session
#   art       : current track thumbnail as base64 (on a separate helper instance)
#   vol/setvol/setmute : default output device volume via Core Audio
#   bright/setbright   : laptop panel (WMI) and external monitors (DDC/CI)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace VolkanDeck {
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int j();
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

  public static class Audio {
    static IAudioEndpointVolume Vol() {
      var en = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
      IMMDevice dev = null;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));   // eRender, eMultimedia
      IAudioEndpointVolume epv = null;
      var id = typeof(IAudioEndpointVolume).GUID;
      Marshal.ThrowExceptionForHR(dev.Activate(ref id, 23, 0, out epv));        // CLSCTX_ALL
      return epv;
    }
    public static int GetVolume() { float v; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return (int)Math.Round(v * 100); }
    public static void SetVolume(int pct) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, Guid.Empty)); }
    public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
    public static void SetMute(bool m) { Marshal.ThrowExceptionForHR(Vol().SetMute(m, Guid.Empty)); }
  }

  public static class Ddc {
    delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, IntPtr rect, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PHYSICAL_MONITOR { public IntPtr hPhysicalMonitor; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szPhysicalMonitorDescription; }
    [DllImport("dxva2.dll", SetLastError = true)] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, out uint count);
    [DllImport("dxva2.dll", SetLastError = true)] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, uint count, [Out] PHYSICAL_MONITOR[] monitors);
    [DllImport("dxva2.dll", SetLastError = true)] static extern bool DestroyPhysicalMonitors(uint count, PHYSICAL_MONITOR[] monitors);
    [DllImport("dxva2.dll", SetLastError = true)] static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr h, byte code, IntPtr type, out uint cur, out uint max);
    [DllImport("dxva2.dll", SetLastError = true)] static extern bool SetVCPFeature(IntPtr h, byte code, uint value);

    static List<PHYSICAL_MONITOR[]> Open() {
      var list = new List<PHYSICAL_MONITOR[]>();
      MonitorEnumProc cb = (h, dc, r, d) => {
        uint n;
        if (GetNumberOfPhysicalMonitorsFromHMONITOR(h, out n) && n > 0) {
          var a = new PHYSICAL_MONITOR[n];
          if (GetPhysicalMonitorsFromHMONITOR(h, n, a)) list.Add(a);
        }
        return true;
      };
      EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, cb, IntPtr.Zero);
      GC.KeepAlive(cb);
      return list;
    }
    static void Close(List<PHYSICAL_MONITOR[]> l) { foreach (var a in l) DestroyPhysicalMonitors((uint)a.Length, a); }
    // brightness (VCP 0x10) of the first monitor that answers, -1 if none supports DDC/CI
    public static int Get() {
      var l = Open();
      try {
        foreach (var a in l) foreach (var m in a) {
          uint cur, max;
          if (GetVCPFeatureAndVCPFeatureReply(m.hPhysicalMonitor, 0x10, IntPtr.Zero, out cur, out max) && max > 0) return (int)Math.Round(cur * 100.0 / max);
        }
      } finally { Close(l); }
      return -1;
    }
    // set every monitor that supports it; returns how many changed
    public static int Set(int pct) {
      int done = 0; var l = Open();
      try {
        foreach (var a in l) foreach (var m in a) {
          uint cur, max;
          if (GetVCPFeatureAndVCPFeatureReply(m.hPhysicalMonitor, 0x10, IntPtr.Zero, out cur, out max) && max > 0 &&
              SetVCPFeature(m.hPhysicalMonitor, 0x10, (uint)Math.Round(Math.Max(0, Math.Min(100, pct)) * max / 100.0))) done++;
        }
      } finally { Close(l); }
      return done;
    }
  }
}
'@

function Get-Bright {
  try {
    $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
    if ($b) { return [int]$b.CurrentBrightness }
  } catch {}
  return [VolkanDeck.Ddc]::Get()
}
function Set-Bright([int]$v) {
  $n = 0
  try {
    foreach ($x in @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop)) {
      Invoke-CimMethod -InputObject $x -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]0; Brightness = [byte]$v } | Out-Null; $n++
    }
  } catch {}
  return $n + [VolkanDeck.Ddc]::Set($v)
}

# ---- media sessions (WinRT from Windows PowerShell 5.1) ----
$smtcOk = $false; $smtcErr = ''; $mgr = $null
function Await($op, [Type]$type) {
  $t = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $t.Wait(3000)) { throw 'timeout' }
  $t.Result
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $smtcOk = $true
} catch { $smtcErr = $_.Exception.Message }

function Get-Media {
  $cur = $mgr.GetCurrentSession()
  $curId = if ($cur) { $cur.SourceAppUserModelId } else { '' }
  $out = @()
  foreach ($s in $mgr.GetSessions()) {
    $p = $null
    try { $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]) } catch {}
    $pb = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
    $out += [pscustomobject]@{
      app = $s.SourceAppUserModelId
      title = if ($p) { [string]$p.Title } else { '' }
      artist = if ($p) { [string]$p.Artist } else { '' }
      status = [string]$pb.PlaybackStatus
      pos = $tl.Position.TotalSeconds
      dur = $tl.EndTime.TotalSeconds
      updated = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
      current = ($s.SourceAppUserModelId -eq $curId)
    }
  }
  return , $out
}
function Invoke-Media([string]$app, [string]$action) {
  foreach ($s in $mgr.GetSessions()) {
    if ($s.SourceAppUserModelId -ne $app) { continue }
    $op = switch ($action) {
      'play_pause' { $s.TryTogglePlayPauseAsync() }
      'next' { $s.TrySkipNextAsync() }
      'prev' { $s.TrySkipPreviousAsync() }
      default { throw "unknown action $action" }
    }
    return [bool](Await $op ([bool]))
  }
  return $false
}
function Get-Art([string]$app, [string]$title, [string]$artist) {
  $stream = $null; $reader = $null
  try {
    $s = $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -eq $app } | Select-Object -First 1
    if (-not $s) { return $null }
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    if (-not $p.Thumbnail -or [string]$p.Title -cne $title -or [string]$p.Artist -cne $artist) { return $null }
    $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if (-not $stream -or $stream.Size -eq 0 -or $stream.Size -gt 8MB) { return $null }
    $reader = [Windows.Storage.Streams.DataReader]::new($stream.GetInputStreamAt(0))
    $n = Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
    if ($n -ne $stream.Size) { return $null }
    $bytes = New-Object byte[] ([int]$n)
    $reader.ReadBytes($bytes)
    return [Convert]::ToBase64String($bytes)
  } catch { return $null }
  finally {
    if ($reader) { try { $reader.Dispose() } catch {} }
    if ($stream) { try { $stream.Dispose() } catch {} }
  }
}

[Console]::Out.WriteLine('{"ready":true,"smtc":' + ($(if ($smtcOk) { 'true' } else { 'false' })) + '}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $res = @{ ok = $false }
  try {
    $q = $line | ConvertFrom-Json
    $res.id = $q.id
    switch ($q.op) {
      'media' { if (-not $smtcOk) { throw "smtc: $smtcErr" }; $res.r = Get-Media }
      'art' { if (-not $smtcOk) { throw "smtc: $smtcErr" }; $res.r = Get-Art $q.app $q.title $q.artist }
      'mctl' { if (-not $smtcOk) { throw "smtc: $smtcErr" }; $res.r = Invoke-Media $q.app $q.action }
      'vol' { $res.r = @{ vol = [VolkanDeck.Audio]::GetVolume(); mute = [VolkanDeck.Audio]::GetMute() } }
      'setvol' { [VolkanDeck.Audio]::SetVolume([int]$q.v); $res.r = $true }
      'setmute' { [VolkanDeck.Audio]::SetMute([bool]$q.v); $res.r = $true }
      'bright' { $res.r = Get-Bright }
      'setbright' { $res.r = Set-Bright ([int]$q.v) }
      default { throw "unknown op $($q.op)" }
    }
    $res.ok = $true
  } catch { $res.error = $_.Exception.Message }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}
