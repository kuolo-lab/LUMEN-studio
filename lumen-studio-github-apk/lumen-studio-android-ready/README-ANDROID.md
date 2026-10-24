# LUMEN Studio: Android app setup

**Simplest cloud-build route:** follow [`GITHUB-APK-GUIDE.md`](GITHUB-APK-GUIDE.md) to upload this project to GitHub and let GitHub Actions build an installable debug APK, similar to the workflow used for Mochi's Secret Number. You can do this without installing Android Studio locally.


## What you need on Windows

1. Install **Node.js LTS** from https://nodejs.org/.
2. Install **Android Studio** from https://developer.android.com/studio.
3. In Android Studio's SDK Manager, install the Android SDK platform and build tools recommended by the installed Android Studio version.
4. Keep a working internet connection for the initial npm and Gradle downloads.

## Easiest setup

1. Extract this ZIP to a normal folder, for example `C:\LumenStudio`. Do not run it from inside the ZIP preview.
2. Double-click `SETUP-ANDROID-WINDOWS.bat`.
3. Let npm install dependencies and Android Studio open. The first Gradle sync can take several minutes.
4. In Android Studio, wait for Gradle sync to finish. Connect your Android phone with USB debugging enabled, or use an emulator.
5. Press **Run** to install the app on the connected device.
6. To create an installable debug APK, choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**. The usual output path is `android\app\build\outputs\apk\debug\app-debug.apk`.

## If the setup script stops

Open Command Prompt in this project folder and run these commands one at a time:

```bat
npm install
npx cap add android
npm run build
npx cap sync android
node scripts/patch-android.mjs
npx cap open android
```

If `npx cap add android` says the Android platform already exists, continue with the build and sync commands.

## Important feature limitations

- This wrapper does not magically add native camera features. The current camera module uses `navigator.mediaDevices.getUserMedia()` and advanced track constraints. Support varies by device and Android System WebView.
- The app's current “RAW” fallback saves JPEG/PNG output; it is not sensor-native DNG RAW.
- The app stores projects in browser IndexedDB inside the app's WebView. Clearing app storage may remove locally saved projects. Export important photos to a safe location.
- This setup script prepares a **debug APK** workflow. A signed release APK/AAB for distribution needs a release signing key and a separate release build process.

## What this project does not do yet

It does not include a native Android Camera2 implementation, verified device-specific manual shutter/ISO support, Play Store signing, or a completed test report from a physical phone. Those need to be implemented/tested separately rather than claimed based on the UI alone.
