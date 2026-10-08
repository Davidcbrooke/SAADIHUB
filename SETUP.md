# SAADI Class Capacity: setup

You'll need about 15 minutes. There are five steps: Firebase, the config file, GitHub Pages, Squarespace, then setting the password.

## 1. Firebase (where the weekly numbers are saved)

1. Go to https://console.firebase.google.com and choose **Add project**. Name it something like `saadi-hub`. You can skip Google Analytics.
2. **Build > Firestore Database > Create database**: choose the **europe-west2 (London)** location and **production mode**.
3. In Firestore, open the **Rules** tab. Replace everything with the contents of `firestore.rules`, then press **Publish**.
4. Go to **Project settings** (the cog icon) **> Your apps**, click the **</>** (Web) icon and register an app called `SAADI Class Capacity`. Firebase then shows a `firebaseConfig = { apiKey: ... }` block. Keep that page open.

You don't need Firebase Authentication. The app uses one shared password instead.

## 2. firebase-config.js

Open `firebase-config.js` in a text editor. Copy each value from the Firebase `firebaseConfig` block into the matching line, replacing the `PASTE...` text, then save.

The apiKey in this file is not a password. Firebase expects it to be public.

## 3. GitHub Pages (where the app lives)

1. Create a new repository, for example `SAADI-TOOLS`, and upload all the files from this folder.
2. Go to **Settings > Pages > Deploy from branch > main / root**, then Save.
3. After a minute, the app is at `https://davidcbrooke.github.io/SAADI-TOOLS/class-capacity.html`.

Never put the password itself in any of these files. They're public on GitHub.

## 4. Squarespace (the password-protected page)

Create a page, set a page password in its settings, and add a **Code** block containing:

```html
<iframe src="https://davidcbrooke.github.io/SAADI-TOOLS/class-capacity.html"
        style="width:100%;height:2600px;border:0" title="SAADI Class Capacity"></iframe>
<p><a href="https://davidcbrooke.github.io/SAADI-TOOLS/class-capacity.html" target="_blank">Open full screen / install as an app</a></p>
```

## 5. Set the password (once)

1. Open the app and click **First-time setup**.
2. Enter the password you've chosen and press **Set up**.
3. Open **Prices & settings**, check the prices, and press **Save settings**.
4. Paste this week's JustGo list in, so the history starts now.

From then on, anyone opening the app types the password. If **Remember on this device** is ticked, they only do it once per device. **Lock** in the top bar closes it again.

To change the password, go to **Prices & settings > Password**. Every device then needs the new one, and the saved weeks are kept. The password can't be recovered, so keep a note of it.

## Installing it as an app

Open the full-screen link (not the Squarespace page) on the device:
- **Windows / Mac (Chrome or Edge):** click the install icon at the right of the address bar.
- **iPhone / iPad (Safari):** tap Share, then **Add to Home Screen**.
- **Android (Chrome):** use the menu, then **Install app**.

## Weekly routine (for reception)

1. In JustGo, open the class booking list. Select all, then copy.
2. In the app, click **Add this week's numbers**, paste, check the summary line (about 125 classes across 7 days), and press **Save week**.
