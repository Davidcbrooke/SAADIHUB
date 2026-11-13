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

**Once per computer:** open the app, click **Add this week's numbers**, and drag the red **Send to SAADI Hub** button onto the browser's bookmarks bar (Ctrl+Shift+B / Cmd+Shift+B shows the bar).

Each week:
1. In JustGo (MyBG), open **Class Management** for the current term.
2. Click **Send to SAADI Hub** in the bookmarks bar. A panel covers JustGo and counts the classes as they load (about 20 seconds, around 200 classes: the current term plus the Rolling Term squads). Keep the JustGo tab in front while it works.
3. When it says **All … classes are ready**, click **Open SAADI Hub**. Check the summary and press **Save week** (or **Replace this week** if the week is already saved).

The hub labels each week by its Monday, so anything saved from Monday to Sunday is "w/c" that Monday. If fewer classes come through than JustGo lists, the hub won't let you save, so run the button again.

The bookmark only reads the class list. It doesn't change anything in JustGo and doesn't read member details. If the browser blocks the new tab, allow pop-ups for mybg.british-gymnastics.org.

If the bookmark ever stops working (for example after a JustGo redesign), use **Or paste the list by hand** in the same panel: select all in JustGo, copy, and paste.

The bookmark is a small launcher that loads `justgo-sync-bookmarklet.js` from the hub each time it's clicked. To change what it does, edit that file and commit; everyone gets the change straight away, with no need to drag the button again. (Only changing the launcher itself, in `build-bookmarklet.js`, would need a new drag.)

# Enquiry Desk

`enquiry-desk.html` answers "Do you have space for a boy or girl aged X?" from the latest JustGo class numbers (the same ones the Class Capacity page saves). It sends HTML trial emails and keeps a follow-up list until each family joins. It uses the hub password, so there's nothing new to sign in to.

## Setting up the reception PC (once, about 15 minutes)

Do all of this on the reception PC, in Chrome.

1. **Open the desk:** go to https://hub.saadigymnastics.co.uk/enquiry-desk.html, type the hub password and tick **Remember on this device**. To install it as an app, click the install icon at the right of the address bar.
2. **Update the JustGo button:** open **Class Capacity > Add this week's numbers** and drag the red **Send to SAADI Hub** button onto the bookmarks bar again, replacing the old one. The new button also brings each class's JustGo booking link, so the emails link straight to the right class.
3. **Fetch the numbers and links:** in JustGo, open **Class Management**, click **Send to SAADI Hub**, then **Open SAADI Hub**, and press **Save week** (or **Replace this week**). In the desk, **Emails & settings > Booking links** should say "All … classes have links".
4. **Send emails from reception@:** sign in to Chrome's Google account as reception@saadigymnastics.co.uk. Then follow the 5 steps in the desk under **Emails & settings > Sending emails from reception@**:
   - copy the mailer code, which opens Google Apps Script;
   - paste the code and save;
   - run **allowSending** and allow the permissions;
   - deploy it as a web app (Execute as: Me; Who has access: Anyone);
   - paste the URL into the desk and press **Check and connect**.

   It must say **Sending as reception@saadigymnastics.co.uk**. The desk won't send from any other account. Emails appear in reception@'s Gmail **Sent** folder, and parents' replies come back to reception@.

The settings are saved centrally, so any other PC that opens the desk with the hub password sends from reception@ too. Until step 4 is done, **Copy email to send myself** copies the email and opens Gmail as reception@ to paste it into.

Trial classes: Recreational, Pre School, Parent and Child, Youth Gym and Adult are offered by default. Squads, Novice and Advanced aren't. Change these under **Emails & settings > Which classes to offer**.

## Every morning (reception, about 2 minutes)

The desk doesn't update itself: it shows the spaces from the last time someone pressed **Send to SAADI Hub**. The **Start of day** box at the top of the desk walks through it, and turns green once it's done:
1. Press **Open JustGo Class Management**, click **Send to SAADI Hub** on the bookmarks bar, then **Open SAADI Hub** and **Save week** / **Replace this week**. You're taken back to the desk.
2. Check JustGo for yesterday's trial and place bookings, and press **Trial booked** or **Booked a place** for each one on the **Follow-ups** tab.
3. Send the emails on the **Follow-ups** tab. Book-your-place emails go out after the trial has finished.

## How the follow-ups work

| Stage | What the desk asks you to do | When |
|---|---|---|
| Trial invite sent | Send a reminder if no trial is booked | 3 days after the invite |
| Reminder sent | Call, or close as no response | 7 days later |
| Trial booked | Send "book your place within 24 hours" | on the trial day |
| Asked to book place | Send "any questions?" if they haven't booked | 2 days later |
| Questions email sent | Call, or close as didn't join | 7 days later |

You can change all of these timings in **Emails & settings**. When a family books a trial or a place in JustGo, press **Trial booked** or **Booked a place** on the **Follow-ups** tab. The **Results** tab shows enquiries, trials and joiners by month, by source and by class, plus a log of every email sent.

The desk saves enquiries under the hub's private data area, using the same protection as the weekly numbers. It stores children's first names and ages, and parents' names, emails and phone numbers. Delete records you no longer need from the record's **Delete** button.

# Term Renewals

`term-renewals.html` shows how many children on a termly place this term have booked for next term: overall, by area (Recreational, Pre-School, Novice) and class by class. Click a class to see who has booked and who hasn't. It also sends reminder emails, from reception@, to families who haven't booked yet.

- **Where the data comes from:** the morning **Send to SAADI Hub** button. Once next term's classes are set up in JustGo, it also reads this term's and next term's class registers: each child, their parent's email, and whether the place is a trial or pay-as-you-go. It reads only; it doesn't change anything in JustGo. Press **Save week** as usual and the renewals update.
- **Which classes:** the Recreational and Pre-School terms, as with the termly renewal emails (Novice's separate term isn't read).
- **Who counts:** children on a termly place this term. Trials and pay-as-you-go places (e.g. Pre-School PAYG, Play Gym) aren't counted. A child has renewed once they're booked into any class next term.
- **Reminders:** one email per family, with a button to book each child's matching class next term (same day, time and colour). Families reminded in the last few days, and families whose class has no match next term yet, are hidden by default. Every reminder is logged, so the list shows who was reminded and when. The wording can be changed under **Change the wording**.

## Renewal form responses (class change and leaving)

The Term Renewals page reads the renewal forms' responses spreadsheet ("Spring Term 2027" in reception's shared drive: tabs Recreational, Preschool and Non Renewal) live, through the reception@ mailer. Nothing from the sheet is stored in the hub. With it, every child on a termly place is shown as **Renewed**, **Class change requested**, **Leaving** or **No response yet**:
- **Reminders** only go to families with no response.
- **Class change requests** are matched to next term's classes on the requested days and times, at the same colour level. **Space now** means there's a free place even after holding places for children who haven't renewed yet: press **Send offer** to email the booking link from reception@. **Wait** means the class only has room once renewals close (set the date under Settings on the page).
- **Leaving** lists each family's reason and scores, with averages.

Next term, change the spreadsheet under **Settings: response spreadsheet** on the page (paste its link).

The mailer must be version 2 (it reads the sheet). If the page asks for it, update the mailer once, as the steps on the page describe: copy the code from the Enquiry Desk, paste it over the old code in script.google.com, run **allowSending**, and redeploy as a **New version**.
