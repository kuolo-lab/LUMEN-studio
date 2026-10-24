# Build LUMEN Studio APK with GitHub Actions

This is the same general workflow used for Mochi's Secret Number: GitHub builds the Android APK in the cloud, then you download the APK artifact. You do not need Android Studio installed on your own computer for this workflow.

## 1. Create a GitHub repository

1. Sign in at https://github.com/.
2. Click **+** then **New repository**.
3. Name it `lumen-studio`.
4. Choose **Public** or **Private** (either works for this workflow).
5. Click **Create repository**.

## 2. Upload the project files

1. Extract this ZIP on your computer.
2. Open the `lumen-studio-android-ready` folder.
3. Make sure you can see `package.json`, `index.html`, `src`, `public`, `scripts`, and `.github` directly inside that folder.
4. On the new GitHub repository page, choose **Add file → Upload files**.
5. Upload the *contents* of `lumen-studio-android-ready`, including the hidden `.github` folder and its `workflows/build-apk.yml` file. Do not upload only the outer folder as a single nested directory.
6. Commit the files to the `main` branch.

Important: ensure `.github/workflows/build-apk.yml` is actually in the repository. If your browser's upload interface does not include hidden folders, create the `.github/workflows` folders in the repository and add `build-apk.yml` there, or use GitHub Desktop to upload the project folder.

## 3. Run the build

1. Open the repository's **Actions** tab.
2. Select **Build LUMEN Studio Android APK** on the left.
3. If it has not started automatically after your commit, click **Run workflow**, select `main`, then click **Run workflow** again.
4. Open the newest run and wait for the steps to finish. A green check means the build completed; a red X means a step failed and its logs need to be inspected.

## 4. Download the APK

1. Open the successful workflow run.
2. Scroll to **Artifacts** near the bottom of the run summary.
3. Download **Lumen-Studio-Android-APK** (it downloads as a ZIP).
4. Extract that ZIP. Inside is `app-debug.apk`.
5. Transfer the APK to your Android phone and open it to install. Android may ask you to allow installation from that file manager/browser; only enable this for the app you intentionally downloaded.

## If the build fails

Open the failed run, select the red step, and copy the first meaningful error message. Share it for troubleshooting. Do not repeatedly rerun the same failed build without checking the logs.

## Honest limitations

- This produces a **debug APK** for testing, not a Play Store release.
- The current app is a React web app wrapped in a native Android shell using Capacitor.
- Manual camera shutter speed and ISO controls depend on the device and Android WebView's camera support. This workflow does not yet add a dedicated native Camera2 camera implementation.
- The app's current RAW fallback is not sensor-native DNG RAW capture.
