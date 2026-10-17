@echo off
cd /d "%~dp0"
echo Installing dependencies...
npm install
if errorlevel 1 exit /b 1
echo Starting MathCanvas...
npm run dev
