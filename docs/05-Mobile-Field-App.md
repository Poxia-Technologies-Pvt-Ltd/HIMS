# Karnataka LIMS — Mobile Field App

Tender reference: Mobile / Field Application with OTG and Offline Support (requirements 53, 54, 55, 56, 57, 58).
Audience: camp and mobile-laboratory teams, hospital IT, and whoever publishes the app to the stores.

## 1. What it is

The Field app is an installable mobile application for **registering patients and collecting samples at outreach camps, mobile laboratories and remote sites**, with or without a network. It runs on **Android and iOS** from the same code:

* **Install from the browser (no store needed).** Open `https://<your LIMS address>/field` once on the phone, sign in, then choose *Add to Home screen* (Android Chrome: *Install app*). It then opens full-screen like any app and works without a network.
* **Store package (optional).** The same app is packaged for Google Play and the Apple App Store with Capacitor (section 6). It loads the hosted app, so a fix reaches every phone at once.

## 2. What a team can do

| Tab | Offline | What happens |
|---|---|---|
| **Register** | Yes | First name, last name, gender, age or birth year, mobile number and (optionally) Aadhaar number. The patient is saved on the phone with a provisional number (`OFF-yymmdd-xxxx-nnn`) and registered on the server as soon as there is a network. |
| **Collect** | Yes, from the saved list | Today's orders of the facility are saved on the phone while online (press *Refresh list*). Collecting a sample marks it collected with the real time and sends it later. |
| **Sync** | — | Shows what is waiting, sends it, and lists anything that needs a person: a patient who may already exist, or a record the server refused, with the reason. |

Orders are created at the registration/billing desk, which needs a network; the Field app then collects against them. A camp with no connectivity at all registers patients on the phone and the orders are raised when the team is back in coverage or through a connected desk.

## 3. Synchronisation and safety

* **Nothing is lost.** Every record is written to the phone's own storage first and stays until the server has accepted it.
* **No duplicates.** Each registration carries a unique reference; if a reply is lost and the phone sends it again, the server recognises it and does not create the patient twice. A probable existing patient is held for a person to decide (*Same person* / *Different person*), exactly as in the laboratory LIS Agent.
* **Oldest first.** Records are sent in the order they were made; if the network drops mid-way the rest wait.
* **Same controls as the web application.** The app uses the same sign-in (password policy, lock-out, session), the same API with the same role and facility checks, and every registration and collection is written to the audit trail by the server with the user and time. The phone holds no password. Patient data on the phone is limited to what is waiting to be sent plus today's collection list; signing out and clearing the app's data removes it.

## 4. Analyzers in the field (requirement 54)

Analyzers connect through the **LIS Agent** on a laptop (USB-to-serial or network adapters), which works offline and syncs on its own; a mobile laboratory runs the Field app on phones for registration and collection and the LIS Agent on a laptop next to the analyzers. Direct analyzer connection from an **Android phone over USB-OTG** needs a native serial plug-in and testing against each analyzer model; it is not part of this release. iOS does not allow USB serial devices to be driven by a third-party app.

## 5. Requirements for use

Android 8 or later with Chrome, or iOS 15.4 or later with Safari. Sign in once with a network. The device should have a screen lock, and users should sign out when they hand a phone over.

## 6. Publishing to the stores (for the team that holds the developer accounts)

1. In `HIMS-frontend`: `npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios` (they are only needed for packaging and are not part of the website build).
2. Edit `capacitor.config.json`: `appId`, `appName`, and `server.url` (the hosted address ending in `/field`).
3. `npx cap add android` and `npx cap add ios`, then `npx cap sync`.
4. Android: open `android/` in Android Studio, set the signing key, build an Android App Bundle, upload to Google Play (Government publisher account).
5. iOS: needs a Mac with Xcode and an Apple Developer account; `npx cap open ios`, set the team and bundle identifier, archive and upload to App Store Connect.
6. Add the app's address to the server's `ALLOWED_ORIGINS` only if you bundle the files inside the app instead of loading the hosted address (not recommended).

Store review, developer accounts and signing keys belong to the Department or its nominee.

## 7. Server settings used

The web server must serve `/field-sw.js` without long caching and allow the manifest and worker in its security policy (already in `nginx.conf.template` and `security-headers.inc.template`; redeploy the frontend image to apply).
