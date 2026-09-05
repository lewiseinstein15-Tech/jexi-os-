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

### Easiest — the download page (for you AND friends)

Open the app's **"GET APP"** tab (or go straight to the live site
`https://lewiseinstein15-Tech.github.io/jexi-os-/`) and tap **DOWNLOAD JEXI OS
APK**. It grabs the newest build automatically.

Direct permanent link (always the newest build, no login needed):

```
https://github.com/lewiseinstein15-Tech/jexi-os-/releases/latest/download/app-debug.apk
```

### Manual — from GitHub Actions

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
   - Send it to yourself on **WhatsApp** (open it on the phone), or
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

## 🔄 Automatic updates (no more missing new versions)

The APK now **tells you when a new build is out** — no more wondering if you're
on the latest version:

- Every APK has a build number baked in at compile time.
- The app **automatically checks** GitHub for the newest release:
  - the moment you open the app,
  - every time the app regains focus,
  - and every few minutes while it's open.
- When a newer build exists, a green **"NEW UPDATE READY"** banner appears at
the top of the app with a one-tap **UPDATE** button that downloads the newest
APK straight from GitHub. The **GET APP** tab also shows your installed build
vs the latest, and its download button turns into **"UPDATE TO BUILD #N"**.
- You still tap Install once Android asks — Android never allows an app to
replace itself without your permission, so the update banner + one download is
as automatic as it gets on a free, no-Play-Store setup.

## 🔄 After you make code changes

Nothing to do manually — every push to `main` (that touches the app, Android
project, or config) triggers a fresh APK build automatically and publishes it
as the new "Latest". Install the new APK when the update banner appears (your
chat memory and creator face-print are stored on the device / in the app, so
they survive reinstalls where supported).

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


---

## 🤖 AndroidRuntime — driving a real Android device (B225, Part 13)

The computer-use runtime now speaks **adb**. A phone or emulator with USB
debugging IS a full computer-use target — real terminal, real browser, real
input, real screenshots — with **zero extra infrastructure** (no host
Chromium, no daemon, no paid service; the 512MB server stays slim).

### Activate

```bash
COMPUTER_RUNTIME=android          # select the provider
JEXI_ANDROID_SERIAL=emulator-5554 # optional: pick a specific device
# adb itself: ANDROID_ADB=/path/to/adb or ANDROID_HOME=... or on PATH
```

Attach a device (USB debugging on, or `adb connect <ip>:<port>`) and the
employees' ```browser blocks run on it: `goto` opens the real device browser
(`am start`), observation reads the real accessibility tree
(`uiautomator dump` — numbered elements with bounds), clicks tap element
centers (`input tap`), typing uses adb's real escaping (spaces → `%s`),
screenshots are real PNG bytes (`screencap`), and `execute` is a real
device shell.

### The honesty contract (unchanged, tested by `test-b225.js`)

- No adb binary → `adb not found …` — one honest `COMPUTER_BLOCKED`, never a
  round of dead actions.
- adb present but no device → `no Android device ready …` (with the
  unauthorized/offline states named if that's what `adb devices` shows).
- `screencap` returning junk → `unavailable`, never a fake image.
- The a11y tree has no DOM title → honest empty title, never a guess.
- Unknown endpoints → honest `does not implement`.

**Testing:** `test-b225.js` drives the adapter through a stub adb BINARY
(argv-precise recorder) — proving exact argv, real XML parsing, center-of-
bounds taps, PNG validation, and every honest-absence path. Production uses
the real adb only; nothing device-shaped is emulated in production code.
