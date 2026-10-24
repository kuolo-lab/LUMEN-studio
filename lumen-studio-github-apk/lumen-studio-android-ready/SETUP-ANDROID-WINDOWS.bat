@echo off
setlocal
cd /d "%~dp0"
echo ========================================
echo LUMEN Studio - Android setup
echo ========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the current Node.js LTS release, then reopen this file.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js LTS and try again.
  pause
  exit /b 1
)
echo [1/4] Installing JavaScript dependencies. Internet is required for this step...
call npm install
if errorlevel 1 goto failed
echo.
if not exist "android\app\src\main\AndroidManifest.xml" (
  echo [2/4] Creating native Android project...
  call npx cap add android
  if errorlevel 1 goto failed
) else (
  echo [2/4] Android project already exists. Skipping creation.
)
echo.
echo [3/4] Building web app and syncing it to Android...
call npm run build
if errorlevel 1 goto failed
call npx cap sync android
if errorlevel 1 goto failed
call node scripts/patch-android.mjs
if errorlevel 1 goto failed
echo.
echo [4/4] Opening Android Studio...
call npx cap open android
if errorlevel 1 goto failed
echo.
echo Setup finished. In Android Studio, wait for Gradle sync to finish.
echo Then use Build ^> Build Bundle(s) / APK(s) ^> Build APK(s).
echo The debug APK is normally under android\app\build\outputs\apk\debug\app-debug.apk
pause
exit /b 0
:failed
echo.
echo Setup stopped because a command failed. Check the error above and the README.
pause
exit /b 1
