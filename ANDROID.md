# 📱 JEXI OS — Real Android App (APK)

JEXI OS is now a **real native Android app** — with its own app icon, splash
screen, and full-screen window — not a browser shortcut. It's built with
[Capacitor](https://capacitorjs.com), Google's official tool for turning web
apps into native apps.

**Cost: $0.** No Play Store fee, no credit card, no developer account.
GitHub Actions builds the APK for free on every push; you just download and
install the file — exactly like installing any APK from a website.

---

## 📥 How to get the APK (2 minutes)

1. Open your repo on GitHub: `https://github.com/lewiseinstein15-Tech/jexi-os-`
2. Click the **Actions** tab (top of the page)
3. In the left sidebar click **"Build JEXI OS APK"**
4. Click the **latest green run** (it rebuilds automatically after every code push)
5. At the bottom of the run page, under **Artifacts**, click **`jexi-os-apk`** to
   download a `.zip`
6. Unzip it — inside is **`app-debug.apk`**

> No new code changes needed? You can still force a build anytime: Actions →
> "Build JEXI OS APK" → **Run workflow** → green button.

---

## 📲 How to install on your Android phone

1. **Transfer the APK to your phone.** Easiest free ways:
   - Upload `app-debug.apk` to your own **Google Drive** and download it on the
     phone, or
   - Send it to yourself on **WhatsApp / Telegram** (open it on the phone), or
   - Plug the phone into your computer via USB and copy the file over.
2. **Tap the APK file.** Android will ask to allow installing from that source
   (your file manager / Drive / WhatsApp). Tap **Settings → Allow from this
   source → Install**.
3. Wait a few seconds → **JEXI OS** appears on your home screen with its neon
   "AI eye" icon. 🎉

*No Play Store, no $25 registration, no card — sideloading is completely free.*

---

## 🌐 Does it need internet?

- **The app itself is installed and bundled** — it opens instantly with its own
  icon and splash screen, like any app.
- **JEXI's brain** (the AI that answers you) lives on your free **Render**
  server, so **chat, vision and the virtual desktop need internet** — there is
  no free way to run a full AI on the phone itself.
- When the connection drops, the app stays open and reconnects automatically
  when you're back online.

---

## 🔄 After you make code changes

Nothing to do manually — every push to `main` (that touches the app, Android
project, or config) triggers a fresh APK build automatically. Download the
new artifact and reinstall (your chat memory and creator face-print are stored
on the device / in the app, so they survive reinstalls where supported).

---

## 🛠 Dev notes (for building on your own machine)

```bash
npm install                # once
npm run apk:generate       # regenerate icon/splash assets (optional)
npm run build              # build the web app
npx cap sync android       # copy the app into the Android shell
cd android && ./gradlew assembleDebug   # compile the APK
# APK output: android/app/build/outputs/apk/debug/app-debug.apk
```

- **Android version:** the APK supports Android **7.0+** (API 24+).
- The APK is **debug-signed** — fine for personal use. When you ever want to
  publish to the Play Store, we'll set up a release keystore (still free
  locally; Play charges $25 once).
