@echo off
cd /d "%~dp0"
echo Writing Firebase configuration to .env.local...
(
  echo VITE_FIREBASE_API_KEY=AIzaSyD3bdk2XemDmg8Ylil0tm44KZFbTTaGPxA
  echo VITE_FIREBASE_AUTH_DOMAIN=math-canvas-b3f38.firebaseapp.com
  echo VITE_FIREBASE_DATABASE_URL=https://math-canvas-b3f38-default-rtdb.firebaseio.com/
  echo VITE_FIREBASE_PROJECT_ID=math-canvas-b3f38
  echo VITE_FIREBASE_APP_ID=1:845053391737:web:64e64b3b6cb537bb5875a8
) > "%~dp0.env.local"
if errorlevel 1 exit /b 1
echo Installing dependencies...
npm install
if errorlevel 1 exit /b 1
echo Building Windows installer...
npm run dist
pause
