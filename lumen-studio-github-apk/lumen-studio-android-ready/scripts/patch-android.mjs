import fs from 'node:fs';
import path from 'node:path';

const manifest = path.resolve('android/app/src/main/AndroidManifest.xml');
if (!fs.existsSync(manifest)) {
  console.error('Android project not found. Run: npx cap add android');
  process.exit(1);
}
let xml = fs.readFileSync(manifest, 'utf8');
const permissions = [
  'android.permission.CAMERA',
  'android.permission.INTERNET',
];
for (const permission of permissions) {
  const line = `    <uses-permission android:name="${permission}" />`;
  if (!xml.includes(`android:name="${permission}"`)) {
    xml = xml.replace('<application', `${line}\n    <application`);
  }
}
fs.writeFileSync(manifest, xml);
console.log('Patched AndroidManifest.xml with camera and internet permissions.');
