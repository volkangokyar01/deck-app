# Widget sensor dependencies

No binary is committed. `stats-assets.js` downloads official, pinned release assets
using Electron `net.fetch` (10-second timeout), checks SHA-256 before use and caches
them under `userData/stats-cache`. App updates continue to copy only `app/`.

| Asset | Official release | SHA-256 of downloaded asset |
| --- | --- | --- |
| macmon arm64 0.8.2 (MIT) | [macmon-v0.8.2.tar.gz](https://github.com/vladkens/macmon/releases/tag/v0.8.2) | `588d5bde79885ba36f693e5150911c10c3ad208a2e418a3f2aa827ac84a2d973` |
| LibreHardwareMonitor 0.9.6 (.NET Framework / net472, MPL-2.0) | [LibreHardwareMonitor.zip](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/tag/v0.9.6) | `086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001` |
| Official signed PawnIO installer 2.2.0 | [PawnIO_setup.exe](https://github.com/namazso/PawnIO.Setup/releases/tag/2.2.0) | `1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032` |

These are GitHub release asset digests, verified against the official
[macmon](https://github.com/vladkens/macmon/releases/expanded_assets/v0.8.2),
[LHM](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/expanded_assets/v0.9.6)
and [PawnIO](https://github.com/namazso/PawnIO.Setup/releases/expanded_assets/2.2.0)
asset metadata on 2026-10-05. PawnIO is also checked using PowerShell
`Get-AuthenticodeSignature` before UAC and inside setup; the installer is invoked
with `-install -silent`, leaving the official signed distribution selected.

## Windows

[LHM 0.9.5](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/tag/v0.9.5)
introduced PawnIO. This implementation pins 0.9.6; **no WinRing0**. The normal
.NET Framework release works with built-in Windows PowerShell 5.1 / .NET Framework
4.7.2+ (prefer 4.8). The complete verified release dependency set is retained,
including `LibreHardwareMonitorLib.dll` and its managed/transitive dependencies:
DiskInfoToolkit 1.1.2, HidSharp 2.6.4, RAMSPDToolkit-NDD 1.4.2,
System.Management 10.0.2, System.Memory 4.6.3, System.Threading.AccessControl 10.0.3
and their packaged dependencies. The PawnIO modules are embedded in the library;
PawnIOLib.dll is **not** required. Only `IsCpuEnabled` is turned on, so GPU,
motherboard, memory/SPD, storage, PSU and fan-control providers are not enabled.
UI executables, `.sys` and any `WinRing0` payloads are removed after extraction.
See the pinned [project dependencies](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/v0.9.6/LibreHardwareMonitorLib/LibreHardwareMonitorLib.csproj).

LHM opens the PawnIO device with read/write access. The driver's
[security descriptor](https://github.com/namazso/PawnIO/blob/b312f788158eb78ea1ce210269cce292cf3ace9c/PawnIO/PawnIO.inf.in)
allows only SYSTEM and administrators. Thus a normal process cannot read CPU
sensors even after driver installation. One UAC installs a SYSTEM Task Scheduler
task at this user's logon (also started immediately), with highest privileges.
It executes a private copy of `win-sensors.ps1` and DLLs under
`%ProgramFiles%/VolkanDeckSensors/<SID>`, writable only by SYSTEM/administrators.
It emits only temperature/package power and timestamp to
`%ProgramData%/VolkanDeckSensors/<SID>/readings.json`; this user has read-only
access. There is no listener, input protocol, arbitrary command or user-writable
code path in the elevated task. The app reads this file without elevation.
Missing/stale/error readings become null. Setup can be repeated to repair/update
the helper; updates to this privileged helper require the same explicit button.

The unmodified library's MPL license and third-party notices are included here
and retained from the downloaded release. Source is available at the exact
[v0.9.6 tag](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/v0.9.6).
The separately installed driver is obtained from the author's official signed
distribution linked by [pawnio.eu](https://pawnio.eu/), not repackaged.

## macOS

Official release CI builds on arm64 macOS and archives `macmon`, `LICENSE` and
`readme.md`. The binary is extracted from the hash-verified archive, then ad-hoc
signed and checked with `codesign --verify --strict` before spawn. Running
`macmon pipe -i 1000` needs no sudo and emits JSON lines; load uses active residency
ratios and GHz uses sampled core frequency. macmon reports **average** CPU/GPU
sensor temperatures, not an Intel-style package sensor. Fan RPM is not converted
to the contract's fan percentage, and Apple unified memory is not mislabeled
as dedicated VRAM. Those fields remain null. Intel Mac / macmon failures preserve
`os.cpus()` load and null temperatures. The binary lives outside the signed app
bundle, avoiding runtime changes that invalidate its ad-hoc signature; it has
its own ad-hoc signature. No changes to `/Applications` are needed.

## Manual verification on hardware

Windows must verify UAC cancellation, invalid hash/signature rejection, DLL loading
on PowerShell 5.1, actual Intel CPU Package / AMD Tctl/Tdie temperature and package
power, task restart at logon, file/directory ACLs, absence of startup UAC, NVIDIA
PATH/NVSMI/System32/DriverStore detection, stream restart/quit and adapter resets.
Test from a standard app process; temperature must stay null when the task or
driver is unavailable. Verify that setup leaves the signed edition selected.
On Apple Silicon verify download, arm64 execution, codesign, JSON metrics and
sleep/resume, using the unpackaged app and the installed ad-hoc-signed app.

`node --test app/stats.test.js` covers parser edge cases, unit conversion, adapter
resets, weather configuration changes, FX business days and last-good caching.
`node app/stats-smoke.js` prints live groups for İstanbul (41.01, 28.97), attempting
the pinned macmon download on Apple Silicon. This command never installs Windows
drivers and never modifies the installed app.
