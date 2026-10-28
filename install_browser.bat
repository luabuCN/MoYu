@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12 or newer first.
  pause
  exit /b 1
)
call npm ci --no-fund
if errorlevel 1 (
  echo Installation failed. Check network access to GitHub and try again.
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo Vue build failed. Check the errors above.
  pause
  exit /b 1
)
echo Installation complete. Open start_moyu.bat in this folder.
pause
