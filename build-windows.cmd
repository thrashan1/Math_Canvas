@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required to build the installer.
  echo Install the current Node.js LTS release from https://nodejs.org/ and try again.
  exit /b 1
)

for /f "tokens=1,2 delims=." %%A in ('node -p "process.versions.node"') do (
  set "NODE_MAJOR=%%A"
  set "NODE_MINOR=%%B"
)
if %NODE_MAJOR% LSS 22 (
  echo Node.js 22.12 or newer is required to build the installer.
  exit /b 1
)
if %NODE_MAJOR% EQU 22 if %NODE_MINOR% LSS 12 (
  echo Node.js 22.12 or newer is required to build the installer.
  exit /b 1
)

echo Installing locked project dependencies...
call npm ci
if errorlevel 1 exit /b 1

echo Building the Windows installer...
call npm run dist:windows
if errorlevel 1 exit /b 1

echo.
echo Installer created in the release folder.
exit /b 0
