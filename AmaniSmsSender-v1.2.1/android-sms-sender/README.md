# Amani SMS Sender (Android)

A small app for the school phone. It asks the Amani Exams website for waiting messages (parents' login details) and
sends each one as a normal SMS from the phone's SIM card, slowly, then tells the website whether it worked.

> **Not yet compiled or tested on a phone.** The website side is tested (see `guardians/tests.py`). This app was written
> carefully but could not be built in the place where it was written. Build it, try it with ONE message to your own
> number first, and send me any error you see in Android Studio.

## Build
1. Install **Android Studio**, choose *Open*, and select this folder (`android-sms-sender`). Let it finish "Gradle sync".
2. *Build > Build Bundle(s) / APK(s) > Build APK(s)*. The file is `app/build/outputs/apk/debug/app-debug.apk`.
3. Copy the APK to the school phone, open it, allow "install unknown apps" for your file manager, install.

## What is new in 1.2.1 (steadier connection)
- **Waits for the internet** instead of failing: no internet on the phone = one log line, then it carries on the moment the network is back.
- **Smart retries**: 5, 10, 20, 40, 80 then 120 seconds between tries (not a fixed 30 s), starting again after one success; it wakes early when the internet returns. The log is not flooded.
- **Results are never lost**: each "sent / failed / delivered" result is saved on the phone and removed only when the website confirms, even if the app is closed in between.
- **No stale connections** (a common cause of "unexpected end of stream" after Wi-Fi/data switches) and a 60 s read time so a sleeping free-hosting server can wake up. 429 and 5xx answers are treated as "try later".
- **Plain-words errors** with the technical reason inside the opened log line, and an "Online / last contact" line on the Sending card.

## What is new in 1.2
- **Animated log**: each line slides in at the top; tap a line and it opens smoothly to show the full text, time, type, job number, a "what to do" hint, and *Copy this line*. *Copy all* and *Clear* sit in the log header.
- **PIN lock** for the server address and pairing code: set a 4 to 8 digit PIN, and both fields become uneditable (the pairing code is also hidden) until the PIN is entered on the animated PIN pad. The padlock opens and closes. It locks again after 3 minutes without typing or when the app was away for over a minute. Wrong tries shake the dots; after 5 wrong tries the app makes you wait. Forgot it? Clear the app's storage in Android Settings and enter the address and a new pairing code.
- **New look**: cards, a progress bar for the readiness checklist, a pulsing status dot, press feedback on buttons, animated screen entry. Black, white and grey only; no new colours.
- **Launcher icon** from the supplied picture (adaptive icon for Android 8+).

## What is new in 1.1
- **Footer** on every screen: "© <year> Amani Girls Secondary School. All rights reserved."
- **About** screen (link in the footer): the app, its version and the developer (Kratos, phone, e-mail with Call / Email buttons).
- **"Is this phone ready?" checklist** with a *Fix the first problem* button: SMS permission, SIM card, "keep permissions" (Android removes
  the SMS permission of apps that are not opened for some months), battery, notifications.
- **Safer SMS permission handling**: explains why before asking; if Android will not ask again, opens the app settings; if Android removes
  the permission while sending, the app **stops and notifies** instead of marking every waiting message "failed" (they stay in the queue).
  No SIM card = the app waits and pulls nothing.
- **Server address is checked**: https is required for the school website (plain http only for a computer on your own Wi-Fi), because the
  pairing code lets whoever has it send SMS as the school.
- **Pairing code is stored encrypted** (AES-256 with a key held in the Android Keystore). A code saved by version 1.0 is encrypted
  automatically the first time version 1.1 runs. If the phone's Keystore is broken the app still works and says so in the log.
- Fixes: the app could crash on Android 8 and 9 (button text), and a stop right after starting could upset Android.

## Set up the phone (once)
1. Use a phone with the SIM that has an **SMS bundle**. On a dual-SIM phone, set that SIM as the default for SMS
   (Settings > SIM / Mobile network > SMS).
2. On the website: **Parents > Phone**: write the school web address, press *Create pairing code*, copy the code.
3. In the app: type the **server address** (the website address, for example `https://amani-exams.co.tz`) and the
   **pairing code**, press *Save and check the connection*. The log should say "Connected".
4. Press *Fix the first problem* again and again until every line in "Is this phone ready?" has a tick (SMS permission, keep permissions,
   battery). On Tecno, Infinix, itel, Xiaomi, Samsung and Huawei phones also allow **Autostart / Run in background** for the app and lock it
   in the recent-apps list.
5. Press *Start sending*.

## Sending
On the website: **Parents > Send > Check who will get a message > Queue**. The phone sends them one by one
(about 8 seconds apart, and a 3-minute rest after every 30; change this in Parents > Phone). The website shows
queued, sent, delivered or failed for every parent.

## Good to know
- Keep the phone **charged, with a signal, and the app running** (a notification shows while it works).
- If the phone is switched off, nothing is lost: messages simply wait in the queue.
- A message is never sent twice: the app remembers what it sent.
- Testing on your own Wi-Fi over plain `http://` works (the manifest allows it). For real use put the website behind
  **https** and set `usesCleartextTraffic="false"` in `AndroidManifest.xml`.
- Anyone who has the pairing code can send SMS as the school (on the phone it is stored encrypted). Remove a lost phone with *Parents > Phone > Remove*.
