@echo off
setlocal
set "V=44.5.1"
set "DEST=%LOCALAPPDATA%\Programs\Volkan Deck"
set "SRC=%~dp0app"
echo.
echo  Volkan Deck kuruluyor (Electron %V% indiriliyor, ~150 MB)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';" ^
  "$z=Join-Path $env:TEMP 'electron-volkandeck.zip';" ^
  "Invoke-WebRequest -UseBasicParsing ('https://github.com/electron/electron/releases/download/v'+$env:V+'/electron-v'+$env:V+'-win32-x64.zip') -OutFile $z;" ^
  "Get-Process 'Volkan Deck' -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 1;" ^
  "if(Test-Path $env:DEST){ Remove-Item -Recurse -Force $env:DEST };" ^
  "Expand-Archive $z $env:DEST -Force; Remove-Item $z;" ^
  "Rename-Item (Join-Path $env:DEST 'electron.exe') 'Volkan Deck.exe';" ^
  "Remove-Item (Join-Path $env:DEST 'resources\default_app.asar') -ErrorAction SilentlyContinue;" ^
  "Copy-Item -Recurse $env:SRC (Join-Path $env:DEST 'resources\app');" ^
  "$w=New-Object -ComObject WScript.Shell;" ^
  "foreach($d in @([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('Desktop'))){ $s=$w.CreateShortcut((Join-Path $d 'Volkan Deck.lnk')); $s.TargetPath=(Join-Path $env:DEST 'Volkan Deck.exe'); $s.IconLocation=(Join-Path $env:DEST 'resources\app\icon.ico'); $s.Save() }"
if errorlevel 1 (
  echo.
  echo  Kurulum basarisiz oldu. Internet baglantisini kontrol edip tekrar dene.
  pause
  exit /b 1
)
start "" "%DEST%\Volkan Deck.exe"
echo  Kuruldu: %DEST%
echo  Baslat menusunde ve masaustunde "Volkan Deck" kisayolu var.
timeout /t 5 >nul
