/* SAADI Team: server side (Firebase Functions, London).
 *
 *  Sign-in      sendCode / verifyCode: 6-digit code emailed to the address on the staff record
 *               (works inside the installed phone app, unlike email links on iPhone).
 *  Roles        custom claims {pid, role} kept in step with people/{pid}.role and status.
 *  Audit        every change to HR records is logged server-side in audit/ (clients can't write it).
 *  Breathe      nightly copy of staff, leave, sickness, patterns and allowances while both run side by side.
 *
 *  Secrets (Secret Manager): BREATHE_API_KEY, BREVO_API_KEY. Never in code or the repo.
 */
"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
setGlobalOptions({ region: "europe-west2", maxInstances: 5 });

const BREATHE_API_KEY = defineSecret("BREATHE_API_KEY");
const BREVO_API_KEY = defineSecret("BREVO_API_KEY");

const SENDER = { name: "SAADI Team", email: "reception@saadigymnastics.co.uk" };
const ROLES = ["staff", "manager", "owner"];
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const norm = e => String(e || "").trim().toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ audit */
async function audit(entry) {
  await db.collection("audit").add({ at: FV.serverTimestamp(), ...entry });
}
function changedFields(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  keys.delete("updatedAt"); keys.delete("updatedBy"); keys.delete("_h");
  return [...keys].filter(k => JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k])).sort();
}
function auditTrigger(path, kind) {
  return onDocumentWritten(path, async ev => {
    const before = ev.data.before.exists ? ev.data.before.data() : null;
    const after = ev.data.after.exists ? ev.data.after.data() : null;
    const fields = changedFields(before, after);
    if (before && after && !fields.length) return;
    await audit({
      kind, path: ev.document,
      action: !before ? "create" : !after ? "delete" : "update",
      actor: (after && after.updatedBy) || (before && before.updatedBy) || "unknown",
      personId: (after && after.personId) || (before && before.personId) || ev.params.pid || null,
      fields // names only, never values: the log mustn't become a second copy of sensitive data
    });
  });
}
exports.auditPeople = auditTrigger("people/{pid}", "person");
exports.auditPrivate = auditTrigger("people/{pid}/private/{doc}", "person-private");
exports.auditLeave = auditTrigger("leave/{id}", "leave");
exports.auditSickness = auditTrigger("sickness/{id}", "sickness");
exports.auditSicknessDetail = auditTrigger("sicknessDetail/{id}", "sickness-detail");
exports.auditConfig = auditTrigger("hrConfig/{id}", "config");

/* Owners opening sensitive things (sickness detail, contracts) log the view. Reads can't be logged by the
   database itself, so the app calls this; it's the honest best available for a static web app. */
exports.logView = onCall(async req => {
  const t = req.auth && req.auth.token;
  if (!t || !t.pid) throw new HttpsError("unauthenticated", "Sign in first.");
  const what = String((req.data && req.data.what) || "").slice(0, 200);
  const personId = String((req.data && req.data.personId) || "").slice(0, 40) || null;
  if (!what) throw new HttpsError("invalid-argument", "Nothing to log.");
  await audit({ kind: "view", action: "view", actor: req.auth.uid, actorPid: t.pid, what, personId });
  return { ok: true };
});

/* ------------------------------------------------------------------ roles */
async function claimsFor(pid) {
  const p = await db.doc(`people/${pid}`).get();
  if (!p.exists) return null;
  const d = p.data();
  if (d.status === "leaver") return null;
  return { pid, role: ROLES.includes(d.role) ? d.role : "staff" };
}
// Keep a signed-in person's role in step with their record; leavers lose access straight away.
exports.syncClaims = onDocumentWritten("people/{pid}", async ev => {
  const after = ev.data.after.exists ? ev.data.after.data() : null;
  const before = ev.data.before.exists ? ev.data.before.data() : null;
  const uid = (after && after.uid) || (before && before.uid);
  if (!uid) return;
  if (before && after && before.role === after.role && before.status === after.status && before.uid === after.uid) return;
  const c = after ? await claimsFor(ev.params.pid) : null;
  try {
    if (c) await admin.auth().setCustomUserClaims(uid, c);
    else { await admin.auth().setCustomUserClaims(uid, {}); await admin.auth().revokeRefreshTokens(uid); await admin.auth().updateUser(uid, { disabled: true }); }
  } catch (e) { logger.warn("claims", uid, e.message); }
});

/* ------------------------------------------------------------------ sign-in with a code */
async function personByEmail(email) {
  const q = await db.collection("people").where("emailLower", "==", email).limit(3).get();
  const live = q.docs.filter(d => d.data().status !== "leaver");
  return live.length === 1 ? live[0] : null;
}
async function sendMail(to, name, subject, html) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY.value(), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: SENDER, to: [{ email: to, name }], subject, htmlContent: html, tags: ["saadi-team"] })
  });
  if (!r.ok) throw new Error("Brevo " + r.status + " " + (await r.text()).slice(0, 200));
}
const codeMail = (first, code) => `<div style="font-family:Roboto,Arial,sans-serif;max-width:480px;margin:auto;color:#1d1d1f">
  <div style="height:6px;background:linear-gradient(90deg,#e94d8b 0 14.3%,#f6d32d 0 28.6%,#f39200 0 42.9%,#2f6fde 0 57.2%,#0f9d9a 0 71.5%,#3aa655 0 85.8%,#7c4bc4 0)"></div>
  <h1 style="font-family:'Roboto Condensed',Arial,sans-serif;font-weight:900;text-transform:uppercase;font-size:22px;margin:24px 0 8px">Your SAADI Team code</h1>
  <p>Hi ${first || "there"}, here's your sign-in code:</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>
  <p>Type it into the SAADI Team app. It works for 10 minutes.</p>
  <p style="color:#666;font-size:13px">If you didn't ask for this, you can ignore this email. Nobody can sign in without the code.</p>
</div>`;

exports.sendCode = onCall({ secrets: [BREVO_API_KEY] }, async req => {
  const email = norm(req.data && req.data.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpsError("invalid-argument", "That doesn't look like an email address.");
  const ref = db.doc(`authCodes/${sha("e|" + email)}`);
  const now = Date.now();
  const prev = await ref.get();
  const sent = ((prev.exists && prev.data().sent) || []).filter(t => now - t < 3600e3);
  if (sent.length >= 5) throw new HttpsError("resource-exhausted", "Too many codes asked for. Try again in an hour.");
  const person = await personByEmail(email);
  // Same answer whether or not the email is on the staff list, so the form can't be used to find out who works here.
  if (!person) { await ref.set({ sent: [...sent, now] }, { merge: true }); return { ok: true }; }
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  const salt = crypto.randomBytes(8).toString("hex");
  await ref.set({ pid: person.id, hash: sha(salt + code), salt, expires: now + 10 * 60e3, tries: 0, sent: [...sent, now] });
  const p = person.data();
  await sendMail(email, `${p.firstName || ""} ${p.lastName || ""}`.trim(), `${code} is your SAADI Team code`, codeMail(p.knownAs || p.firstName, code));
  return { ok: true };
});

exports.verifyCode = onCall(async req => {
  const email = norm(req.data && req.data.email);
  const code = String((req.data && req.data.code) || "").replace(/\D/g, "");
  const ref = db.doc(`authCodes/${sha("e|" + email)}`);
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : null;
  const bad = () => new HttpsError("permission-denied", "That code isn't right, or it has run out. Ask for a new one.");
  if (!d || !d.hash || code.length !== 6) throw bad();
  if (Date.now() > d.expires || d.tries >= 5) { await ref.update({ hash: FV.delete() }); throw bad(); }
  if (sha(d.salt + code) !== d.hash) { await ref.update({ tries: FV.increment(1) }); throw bad(); }
  await ref.update({ hash: FV.delete(), salt: FV.delete() });

  const c = await claimsFor(d.pid);
  if (!c) throw new HttpsError("permission-denied", "Your staff record isn't active. Speak to Mel or Dave.");
  const uid = "p_" + d.pid;
  try { await admin.auth().getUser(uid); await admin.auth().updateUser(uid, { email, emailVerified: true, disabled: false }); }
  catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    // an older account with this email (e.g. made by the email-link option) is folded into the staff one
    try { const old = await admin.auth().getUserByEmail(email); await admin.auth().deleteUser(old.uid); } catch (x) {}
    await admin.auth().createUser({ uid, email, emailVerified: true });
  }
  await admin.auth().setCustomUserClaims(uid, c);
  await db.doc(`people/${d.pid}`).update({ uid, lastSignIn: FV.serverTimestamp(), updatedBy: "sign-in" });
  await audit({ kind: "sign-in", action: "sign-in", actor: uid, personId: d.pid });
  return { token: await admin.auth().createCustomToken(uid) };
});

/* ------------------------------------------------------------------ notifications
   Email (Brevo, from reception@) + phone push (FCM) to a person. Never includes health details. */
const HUB = "https://hub.saadigymnastics.co.uk/";
const fmtDay = s => s ? new Date(s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
const dates = (a, b) => !b || a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`;
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mailHtml = (first, heading, lines, button, url) => `<div style="font-family:Roboto,Arial,sans-serif;max-width:520px;margin:auto;color:#1d1d1f">
  <div style="height:6px;background:linear-gradient(90deg,#e94d8b 0 14.3%,#f6d32d 0 28.6%,#f39200 0 42.9%,#2f6fde 0 57.2%,#0f9d9a 0 71.5%,#3aa655 0 85.8%,#7c4bc4 0)"></div>
  <h1 style="font-family:'Roboto Condensed',Arial,sans-serif;font-weight:900;text-transform:uppercase;font-size:22px;margin:24px 0 10px">${esc(heading)}</h1>
  <p>Hi ${esc(first || "there")},</p>${lines.map(l => `<p>${l}</p>`).join("")}
  <p style="margin:24px 0"><a href="${url}" style="background:#c6152e;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:99px;display:inline-block">${esc(button)}</a></p>
  <p style="color:#888;font-size:12px">SAADI Team · SAADI Gymnastics, Redbourn</p></div>`;
const personName = p => `${p.knownAs || p.firstName || ""} ${p.lastName || ""}`.trim();

async function notify(pid, { subject, heading, lines, button, url, push }) {
  const snap = await db.doc(`people/${pid}`).get();
  if (!snap.exists) return;
  const p = snap.data();
  if (p.status === "leaver") return;
  if (p.email) {
    try { await sendMail(p.email, personName(p), subject, mailHtml(p.knownAs || p.firstName, heading, lines, button, url)); }
    catch (e) { logger.warn("mail", pid, e.message); }
  }
  const devs = await db.collection(`people/${pid}/devices`).get();
  if (devs.empty) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens: devs.docs.map(d => d.data().token),
    notification: { title: push.title, body: push.body },
    webpush: { fcmOptions: { link: url }, notification: { icon: HUB + "icon-192.png", badge: HUB + "favicon-32.png" } },
    data: { url }
  });
  // tidy away phones that have uninstalled or switched notifications off
  await Promise.all(res.responses.map((r, i) => !r.success && /registration-token-not-registered|invalid-argument|invalid-registration/.test((r.error && r.error.code) || "")
    ? devs.docs[i].ref.delete() : null));
}
async function managers() {
  const q = await db.collection("people").where("role", "in", ["manager", "owner"]).get();
  return q.docs.filter(d => d.data().status !== "leaver").map(d => d.id);
}

exports.leaveNotify = onDocumentWritten({ document: "leave/{id}", secrets: [BREVO_API_KEY] }, async ev => {
  const before = ev.data.before.exists ? ev.data.before.data() : null;
  const after = ev.data.after.exists ? ev.data.after.data() : null;
  if (!after || after.source === "breathe" || after.updatedBy === "breathe-sync") return;
  const ps = await db.doc(`people/${after.personId}`).get();
  const who = ps.exists ? personName(ps.data()) : "Someone";
  const what = after.type === "holiday" ? "holiday" : "leave";
  const when = dates(after.start, after.end);

  if (!before && after.status === "pending") {
    // new request: tell the managers (not the person asking, if they're a manager themselves)
    const ids = (await managers()).filter(id => id !== after.personId);
    await Promise.all(ids.map(id => notify(id, {
      subject: `${who} has asked for ${what}: ${when}`, heading: "Time off to approve",
      lines: [`<b>${esc(who)}</b> has asked for ${what}: <b>${esc(when)}</b>.`, after.notes ? `Their note: “${esc(after.notes)}”` : ""].filter(Boolean),
      button: "Approve or decline", url: HUB + "timeoff.html",
      push: { title: "Time off to approve", body: `${who}: ${what}, ${when}` }
    })));
    return;
  }
  if (before && before.status === "pending" && ["approved", "declined"].includes(after.status)) {
    const ok = after.status === "approved";
    await notify(after.personId, {
      subject: ok ? `Your ${what} is approved: ${when}` : `Your ${what} request wasn't approved: ${when}`,
      heading: ok ? "Approved" : "Not approved",
      lines: [ok ? `Good news: your ${what} for <b>${esc(when)}</b> is approved.` : `Sorry, your ${what} request for <b>${esc(when)}</b> wasn't approved. Have a word with Mel or Dave if you'd like to talk about it.`],
      button: "Open SAADI Team", url: HUB + "team/",
      push: { title: ok ? "Time off approved ✅" : "Time off not approved", body: `${what[0].toUpperCase() + what.slice(1)}: ${when}` }
    });
    return;
  }
  if (before && before.status === "approved" && after.status === "cancelled") {
    const ids = (await managers()).filter(id => id !== after.personId);
    await Promise.all(ids.map(id => notify(id, {
      subject: `${who} has cancelled ${what}: ${when}`, heading: "Time off cancelled",
      lines: [`<b>${esc(who)}</b> has cancelled their ${what} for <b>${esc(when)}</b>, so they're available again.`],
      button: "Open People", url: HUB + "timeoff.html",
      push: { title: "Time off cancelled", body: `${who}: ${when}` }
    })));
  }
});

exports.sicknessNotify = onDocumentWritten({ document: "sickness/{id}", secrets: [BREVO_API_KEY] }, async ev => {
  const before = ev.data.before.exists ? ev.data.before.data() : null;
  const after = ev.data.after.exists ? ev.data.after.data() : null;
  if (before || !after || after.source !== "team") return; // only new reports made in the app
  const ps = await db.doc(`people/${after.personId}`).get();
  const who = ps.exists ? personName(ps.data()) : "Someone";
  const ids = (await managers()).filter(id => id !== after.personId);
  // dates only: what's wrong stays in sicknessDetail for owners
  await Promise.all(ids.map(id => notify(id, {
    subject: `${who} is off sick from ${fmtDay(after.start)}`, heading: "Off sick",
    lines: [`<b>${esc(who)}</b> has let us know they're not well and won't be in from <b>${esc(fmtDay(after.start))}</b>${after.end ? `, expecting to be back ${esc(fmtDay(after.end))}` : ""}.`, "Their shifts will need cover."],
    button: "Open People", url: HUB + "timeoff.html",
    push: { title: "Off sick 🤒", body: `${who} from ${fmtDay(after.start)}. Shifts need cover.` }
  })));
});

/* ------------------------------------------------------------------ welcome a new member of staff added in SAADI Team */
exports.welcomeNotify = onDocumentCreated({ document: "people/{pid}", secrets: [BREVO_API_KEY] }, async ev => {
  const p = ev.data && ev.data.data();
  if (!p || p.source !== "team" || !p.welcome || !p.email) return;
  await notify(ev.params.pid, {
    subject: "Welcome to SAADI Team", heading: "Welcome to SAADI!",
    lines: ["You've been added to <b>SAADI Team</b>, our staff app. It's where you'll see your shifts, ask for holiday, let us know if you're not well, and pick up extra shifts.",
      `To sign in, open the link below and use this email address (<b>${esc(p.email)}</b>). We'll email you a 6-digit code: there's no password.`,
      "Tip: on your phone, add it to your Home Screen so it works like an app, and switch on notifications."],
    button: "Open SAADI Team", url: HUB + "team/",
    push: { title: "Welcome to SAADI Team", body: "Your shifts, holiday and cover, all in one place." }
  });
});

/* ------------------------------------------------------------------ cover: open shifts
   Created by a manager on the rota → offered to the chosen staff; staff put their name down; the manager picks one. */
const nice = t => { if (!t) return "?"; let h = +t.slice(0, 2); const m = t.slice(3, 5), ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + (m !== "00" ? ":" + m : "") + ap; };
const shiftWhen = s => `${fmtDay(s.date)}, ${nice(s.start)}–${nice(s.end)}`;
const shiftWhat = s => [...new Set((s.items || []).map(x => `${x.cls} (${x.role})`))].join(", ");
exports.coverNotify = onDocumentWritten({ document: "openShifts/{id}", secrets: [BREVO_API_KEY] }, async ev => {
  const before = ev.data.before.exists ? ev.data.before.data() : null;
  const after = ev.data.after.exists ? ev.data.after.data() : null;
  if (!after) return;
  const when = shiftWhen(after), what = shiftWhat(after);
  if (!before) {
    await Promise.all((after.pids || []).map(id => notify(id, {
      subject: `Shift up for grabs: ${when}`, heading: "Can you cover a shift?",
      lines: [`There's a shift that needs cover: <b>${esc(when)}</b>.`, esc(what), after.note ? `Note: “${esc(after.note)}”` : "",
        "If you can do it, open SAADI Team and tap <b>I can do this</b>. A manager will confirm who gets it."].filter(Boolean),
      button: "See the shift", url: HUB + "team/#open",
      push: { title: "Shift up for grabs 🙋", body: `${when}: ${what}`.slice(0, 180) }
    })));
    return;
  }
  // someone new put their name down → tell the manager who sent it
  const added = Object.keys(after.applicants || {}).filter(k => !(before.applicants || {})[k]);
  if (added.length && after.status === "open" && after.createdByPid) {
    for (const pid of added) {
      const ps = await db.doc(`people/${pid}`).get(), who = ps.exists ? personName(ps.data()) : "Someone";
      await notify(after.createdByPid, {
        subject: `${who} can cover ${when}`, heading: "Cover offered",
        lines: [`<b>${esc(who)}</b> can do <b>${esc(when)}</b> (${esc(what)}).`, "Open the rota to choose who gets it."],
        button: "Choose who gets it", url: HUB + "shifts.html",
        push: { title: "Cover offered 🙋", body: `${who}: ${when}` }
      });
    }
  }
  // a manager said "not this time" to someone → let them know kindly
  if (after.status === "open") {
    const declined = Object.keys(after.applicants || {}).filter(k => after.applicants[k] && after.applicants[k].declined && !((before.applicants || {})[k] || {}).declined);
    await Promise.all(declined.map(id => notify(id, {
      subject: `Not this time: ${when}`, heading: "Thanks for offering",
      lines: [`Thanks for offering to cover <b>${esc(when)}</b>. We've gone with someone else this time, but it really helps that you offered.`],
      button: "Open SAADI Team", url: HUB + "team/",
      push: { title: "Thanks for offering", body: `${when}: we've gone with someone else this time.` }
    })));
  }
  // filled → tell the person who got it, and thank the others
  if (before.status === "open" && after.status === "filled" && after.filledBy) {
    await notify(after.filledBy, {
      subject: `It's yours: ${when}`, heading: "Shift confirmed",
      lines: [`Thanks! You're covering <b>${esc(when)}</b>: ${esc(what)}.`, "It's in My shifts in SAADI Team."],
      button: "My shifts", url: HUB + "team/",
      push: { title: "Shift confirmed ✅", body: `${when}: ${what}`.slice(0, 180) }
    });
    await Promise.all(Object.keys(after.applicants || {}).filter(k => k !== after.filledBy && !(after.applicants[k] || {}).declined).map(id => notify(id, {
      subject: `Covered: ${when}`, heading: "Thanks for offering",
      lines: [`The shift on <b>${esc(when)}</b> has been given to someone else this time. Thank you for offering: it really helps.`],
      button: "Open SAADI Team", url: HUB + "team/",
      push: { title: "Shift covered", body: `${when}: given to someone else this time. Thanks for offering!` }
    })));
  }
});

/* ------------------------------------------------------------------ documents: contracts to sign + company documents
   Files live in a private London bucket that only this server can open. Every download goes through docGet, which
   checks who is asking. Signing is done here (not in the browser) so the record of who/when/where can't be faked. */
const DOCS_BUCKET = "saadi-team-docs-643022190115";
const bucket = () => admin.storage().bucket(DOCS_BUCKET);
const sha256 = buf => crypto.createHash("sha256").update(buf).digest("hex");
const MAX_PDF = 7 * 1024 * 1024;
const londonTime = d => new Date(d).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function who(req) {
  const t = req.auth && req.auth.token;
  if (!t || !t.pid) throw new HttpsError("unauthenticated", "Sign in first.");
  return { pid: t.pid, role: t.role || "staff", uid: req.auth.uid, mgr: ["manager", "owner"].includes(t.role) };
}
function readPdf(b64) {
  const buf = Buffer.from(String(b64 || ""), "base64");
  if (buf.length < 100 || buf.slice(0, 5).toString() !== "%PDF-") throw new HttpsError("invalid-argument", "That isn't a PDF.");
  if (buf.length > MAX_PDF) throw new HttpsError("invalid-argument", "That PDF is over 7 MB. Save a smaller copy and try again.");
  return buf;
}
async function pageCount(buf) { try { const { PDFDocument } = require("pdf-lib"); return (await PDFDocument.load(buf, { ignoreEncryption: true })).getPageCount(); } catch (e) { return null; } }
async function nameOf(pid) { const s = await db.doc(`people/${pid}`).get(); return s.exists ? personName(s.data()) : ""; }
const clientInfo = req => {
  const h = (req.rawRequest && req.rawRequest.headers) || {};
  return { ip: String(h["x-forwarded-for"] || (req.rawRequest && req.rawRequest.ip) || "").split(",")[0].trim().slice(0, 60), ua: String(h["user-agent"] || "").slice(0, 220) };
};

// upload a PDF: a document for one person to sign, or a company document for everyone (new or a new version)
exports.docUpload = onCall({ secrets: [BREVO_API_KEY], memory: "512MiB", timeoutSeconds: 120 }, async req => {
  const me = who(req), d = req.data || {};
  if (!me.mgr) throw new HttpsError("permission-denied", "Managers only.");
  const buf = readPdf(d.pdf), title = String(d.title || "").trim().slice(0, 120);
  if (!title) throw new HttpsError("invalid-argument", "Give it a title.");
  const file = { sha256: sha256(buf), bytes: buf.length, pages: await pageCount(buf), name: String(d.fileName || "").slice(0, 120) || null };
  const byName = await nameOf(me.pid);

  if (d.kind === "sign") {
    const ps = await db.doc(`people/${d.personId}`).get();
    if (!ps.exists || ps.data().status === "leaver") throw new HttpsError("not-found", "Can't find that member of staff.");
    const ref = db.collection("signDocs").doc(), path = `sign/${ref.id}/original.pdf`;
    await bucket().file(path).save(buf, { contentType: "application/pdf", resumable: false });
    const counterBy = d.needsCounter === false ? null : (d.counterBy || (me.role === "owner" ? me.pid : null));
    await ref.set({
      personId: d.personId, personName: personName(ps.data()), title, note: String(d.note || "").slice(0, 500) || null,
      needsCounter: d.needsCounter !== false, counterBy, status: "sent", original: { path, ...file },
      sentBy: me.pid, sentByName: byName, sentAt: FV.serverTimestamp(), reminders: 0, updatedBy: me.uid, updatedAt: FV.serverTimestamp()
    });
    await notify(d.personId, {
      subject: `Please read and sign: ${title}`, heading: "A document to sign",
      lines: [`<b>${esc(title)}</b> is ready for you to read and sign in SAADI Team.`, d.note ? `Note: “${esc(d.note)}”` : "", "It only takes a minute: open it, read it, then sign with your finger or mouse."].filter(Boolean),
      button: "Read and sign", url: HUB + "team/#docs", push: { title: "A document to sign ✍️", body: title }
    });
    return { id: ref.id };
  }

  if (d.kind === "company") {
    const ref = d.replaceId ? db.doc(`companyDocs/${d.replaceId}`) : db.collection("companyDocs").doc();
    const old = d.replaceId ? await ref.get() : null;
    if (d.replaceId && !old.exists) throw new HttpsError("not-found", "Can't find that document.");
    const version = old ? (old.data().version || 1) + 1 : 1, path = `company/${ref.id}/v${version}.pdf`;
    await bucket().file(path).save(buf, { contentType: "application/pdf", resumable: false });
    await ref.set({
      title, category: String(d.category || "").slice(0, 60) || (old && old.data().category) || "Policies",
      note: String(d.note || "").slice(0, 500) || null, mustRead: d.mustRead !== false, version, file: { path, ...file },
      archived: false, publishedAt: FV.serverTimestamp(), publishedBy: me.pid, publishedByName: byName,
      source: d.source || null, updatedBy: me.uid, updatedAt: FV.serverTimestamp(), ...(old ? {} : { createdAt: FV.serverTimestamp() })
    }, { merge: true });
    if (d.notify) {
      const staff = (await db.collection("people").where("status", "in", ["current", "leaving"]).get()).docs.map(x => x.id);
      for (const id of staff) await notify(id, {
        subject: `${version > 1 ? "Updated" : "New"}: ${title}`, heading: version > 1 ? "A document has been updated" : "A new document to read",
        lines: [`<b>${esc(title)}</b> ${version > 1 ? "has been updated" : "has been added to SAADI Team"}. Please read it and tick “I've read and understood”.`, d.note ? `“${esc(d.note)}”` : ""].filter(Boolean),
        button: "Read it", url: HUB + "team/#docs", push: { title: version > 1 ? "Document updated 📄" : "New document to read 📄", body: title }
      });
    }
    return { id: ref.id, version };
  }
  throw new HttpsError("invalid-argument", "Unknown kind.");
});

// open a PDF (returned as base64). Signing documents: the person or a manager. Company documents: any member of staff.
exports.docGet = onCall({ memory: "512MiB" }, async req => {
  const me = who(req), d = req.data || {};
  let path;
  if (d.kind === "sign") {
    const ref = db.doc(`signDocs/${d.id}`), s = await ref.get();
    if (!s.exists) throw new HttpsError("not-found", "Not found.");
    const x = s.data();
    if (x.personId !== me.pid && !me.mgr) throw new HttpsError("permission-denied", "That isn't yours.");
    path = d.which === "signed" && x.final ? x.final.path : x.original.path;
    if (x.personId === me.pid && !x.viewedAt) await ref.update({ viewedAt: FV.serverTimestamp(), updatedBy: me.uid });
    if (x.personId !== me.pid) await audit({ kind: "view", action: "view", actor: me.uid, actorPid: me.pid, what: `signDoc ${d.id}`, personId: x.personId });
  } else if (d.kind === "company") {
    const s = await db.doc(`companyDocs/${d.id}`).get();
    if (!s.exists || (s.data().archived && !me.mgr)) throw new HttpsError("not-found", "Not found.");
    path = s.data().file.path;
  } else throw new HttpsError("invalid-argument", "Unknown kind.");
  const [buf] = await bucket().file(path).download();
  return { pdf: buf.toString("base64") };
});

// sign: the member of staff first, then the counter-signer (an owner or manager). Seals the PDF when done.
const winAnsi = s => String(s == null ? "" : s).replace(/[^\x20-\x7E -ÿ–—‘’“”•]/g, "?");
async function sealPdf(orig, x, id) {
  const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
  const pdf = await PDFDocument.load(orig, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const grey = rgb(0.4, 0.4, 0.42), ink = rgb(0.11, 0.11, 0.12), red = rgb(0.776, 0.082, 0.18);
  const n = pdf.getPageCount();
  pdf.getPages().forEach((pg, i) => pg.drawText(winAnsi(`Signed electronically in SAADI Team · ref ${id} · page ${i + 1} of ${n + 1}`), { x: 24, y: 10, size: 7, font, color: grey }));
  const pg = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const line = (t, o = {}) => { pg.drawText(winAnsi(t), { x: o.x || 50, y, size: o.size || 10, font: o.bold ? bold : font, color: o.color || ink }); y -= o.gap || (o.size || 10) + 6; };
  const wrap = (t, w, o = {}) => { const words = winAnsi(t).split(" "); let cur = ""; words.forEach(wd => { const tryT = cur ? cur + " " + wd : wd; if (font.widthOfTextAtSize(tryT, o.size || 10) > w) { line(cur, o); cur = wd; } else cur = tryT; }); if (cur) line(cur, o); };
  pg.drawRectangle({ x: 0, y: 826, width: 595.28, height: 16, color: red });
  line("SIGNING CERTIFICATE", { size: 20, bold: true, gap: 26 });
  line(x.title, { size: 13, bold: true, gap: 18 });
  line(`Reference: ${id}`, { color: grey });
  line(`Original document fingerprint (SHA-256): ${x.original.sha256.slice(0, 32)}`, { color: grey, size: 8.5, gap: 11 });
  line(x.original.sha256.slice(32), { color: grey, size: 8.5, x: 228, gap: 22 });
  const signer = async (label, s) => {
    line(label, { bold: true, size: 12, gap: 16 });
    const png = await pdf.embedPng(Buffer.from(s.png.split(",")[1], "base64"));
    const sc = Math.min(220 / png.width, 70 / png.height);
    pg.drawRectangle({ x: 50, y: y - 78, width: 240, height: 84, borderColor: rgb(0.85, 0.85, 0.87), borderWidth: 1 });
    pg.drawImage(png, { x: 60, y: y - 74, width: png.width * sc, height: png.height * sc });
    const yy = y; y -= 2;
    [["Name typed", s.name], ["Signed", londonTime(s.at) + " (UK time)"], ["Email", s.email || ""], ["IP address", s.ip || "not recorded"]].forEach(([k, v]) => {
      pg.drawText(winAnsi(k), { x: 305, y, size: 8.5, font, color: grey }); pg.drawText(winAnsi(v), { x: 370, y, size: 9, font, color: ink }); y -= 14; });
    pg.drawText(winAnsi("Device"), { x: 305, y, size: 8.5, font, color: grey });
    const ua = winAnsi(s.ua || ""); pg.drawText(ua.slice(0, 48), { x: 370, y, size: 7, font, color: grey }); y -= 9; pg.drawText(ua.slice(48, 96), { x: 370, y, size: 7, font, color: grey });
    y = Math.min(y, yy - 84) - 22;
  };
  await signer(`Signed by ${x.personName}`, x.signed);
  if (x.counter) await signer(`Counter-signed for SAADI Gymnastics by ${x.counter.name}`, x.counter);
  line("History", { bold: true, size: 12, gap: 16 });
  const ev = [[x.sentAt, `Sent for signing by ${x.sentByName || "SAADI"}`], [x.viewedAt, `First opened by ${x.personName}`], [x.signed && x.signed.at, `Signed by ${x.signed && x.signed.name}`], [x.counter && x.counter.at, `Counter-signed by ${x.counter && x.counter.name}`]];
  ev.filter(e => e[0]).forEach(([t, w]) => line(`${londonTime(t && t.toDate ? t.toDate() : t)}   ${w}`, { size: 9.5 }));
  y -= 10;
  wrap("This certificate is part of the document. Both people agreed to sign electronically, which has the same effect as signing on paper (Electronic Communications Act 2000). The fingerprint above proves the document wasn't changed after it was sent for signing: the server checked it before each signature.", 495, { size: 8.5, color: grey, gap: 12 });
  return Buffer.from(await pdf.save());
}
exports.signDoc = onCall({ secrets: [BREVO_API_KEY], memory: "1GiB", timeoutSeconds: 120 }, async req => {
  const me = who(req), d = req.data || {};
  const name = String(d.name || "").trim().replace(/\s+/g, " ");
  if (!d.consent) throw new HttpsError("failed-precondition", "Tick the box to agree to sign electronically.");
  if (name.length < 3 || name.length > 80) throw new HttpsError("invalid-argument", "Type your full name.");
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(d.png || "")) || d.png.length > 400000) throw new HttpsError("invalid-argument", "Draw your signature first.");
  const ref = db.doc(`signDocs/${d.id}`), s = await ref.get();
  if (!s.exists) throw new HttpsError("not-found", "Not found.");
  const x = s.data();
  let stage;
  if (x.status === "sent" && x.personId === me.pid) stage = "signed";
  else if (x.status === "signed" && me.mgr && (!x.counterBy || x.counterBy === me.pid)) stage = "counter";
  else throw new HttpsError("failed-precondition", x.status === "complete" ? "This is already signed." : x.status === "withdrawn" ? "This document was withdrawn." : "It isn't your turn to sign this.");
  // the file must be exactly what was sent
  const [orig] = await bucket().file(x.original.path).download();
  if (sha256(orig) !== x.original.sha256) { logger.error("signDoc hash mismatch", d.id); throw new HttpsError("data-loss", "The document has changed since it was sent. Ask for it to be sent again."); }
  const ps = await db.doc(`people/${me.pid}`).get();
  const rec = { pid: me.pid, name, png: d.png, email: ps.exists ? ps.data().email || null : null, at: new Date().toISOString(), ...clientInfo(req) };
  const after = { ...x, [stage]: rec };
  const upd = { [stage]: rec, updatedBy: me.uid, updatedAt: FV.serverTimestamp() };
  if (stage === "counter" || !x.needsCounter) {
    const sealed = await sealPdf(orig, after, d.id), path = `sign/${d.id}/signed.pdf`;
    await bucket().file(path).save(sealed, { contentType: "application/pdf", resumable: false });
    Object.assign(upd, { status: "complete", final: { path, sha256: sha256(sealed), bytes: sealed.length }, completedAt: FV.serverTimestamp() });
  } else upd.status = "signed";
  await ref.update(upd);
  await audit({ kind: "sign", action: stage, actor: me.uid, actorPid: me.pid, personId: x.personId, what: `signDoc ${d.id}` });

  if (upd.status === "signed") {
    const to = x.counterBy ? [x.counterBy] : (await db.collection("people").where("role", "==", "owner").get()).docs.filter(p => p.data().status !== "leaver").map(p => p.id);
    await Promise.all(to.map(id => notify(id, {
      subject: `${x.personName} has signed: ${x.title}`, heading: "Ready to counter-sign",
      lines: [`<b>${esc(x.personName)}</b> has signed <b>${esc(x.title)}</b>. It needs your signature to finish it.`],
      button: "Counter-sign", url: HUB + "documents.html", push: { title: "Ready to counter-sign ✍️", body: `${x.personName}: ${x.title}` }
    })));
  } else {
    await Promise.all([...new Set([x.personId, x.counter ? x.counter.pid : null, stage === "counter" ? me.pid : null, x.sentBy].filter(Boolean))].map(id => notify(id, {
      subject: `Signed: ${x.title}`, heading: "All signed",
      lines: [`<b>${esc(x.title)}</b> is now signed by everyone. The signed copy, with its signing certificate, is in SAADI Team to download and keep.`],
      button: "Open SAADI Team", url: id === x.personId ? HUB + "team/#docs" : HUB + "documents.html", push: { title: "All signed ✅", body: x.title }
    })));
  }
  return { status: upd.status };
});

exports.auditSignDocs = auditTrigger("signDocs/{id}", "sign-doc");
exports.auditCompanyDocs = auditTrigger("companyDocs/{id}", "company-doc");

// gentle chasers at 10am: unsigned after 3 days (every 2 days, 3 times max); counter-signature waiting 2 days
exports.docReminders = onSchedule({ schedule: "0 10 * * *", timeZone: "Europe/London", secrets: [BREVO_API_KEY] }, async () => {
  const now = Date.now(), day = 864e5;
  const q = await db.collection("signDocs").where("status", "in", ["sent", "signed"]).get();
  for (const s of q.docs) {
    const x = s.data(), sent = x.sentAt && x.sentAt.toMillis(), last = x.lastReminder ? x.lastReminder.toMillis() : 0;
    if ((x.reminders || 0) >= 3 || now - last < 2 * day) continue;
    if (x.status === "sent" && sent && now - sent > 3 * day) {
      await notify(x.personId, { subject: `Reminder: please sign ${x.title}`, heading: "Still to sign",
        lines: [`<b>${esc(x.title)}</b> is waiting for your signature in SAADI Team.`], button: "Read and sign", url: HUB + "team/#docs",
        push: { title: "Still to sign ✍️", body: x.title } });
    } else if (x.status === "signed" && x.signed && now - Date.parse(x.signed.at) > 2 * day) {
      const to = x.counterBy ? [x.counterBy] : [x.sentBy];
      await Promise.all(to.map(id => notify(id, { subject: `Reminder: counter-sign ${x.title} (${x.personName})`, heading: "Waiting for you",
        lines: [`<b>${esc(x.personName)}</b> signed <b>${esc(x.title)}</b>. It needs your signature to finish.`], button: "Counter-sign", url: HUB + "documents.html",
        push: { title: "Waiting for your signature", body: `${x.personName}: ${x.title}` } })));
    } else continue;
    await s.ref.update({ reminders: FV.increment(1), lastReminder: FV.serverTimestamp(), updatedBy: "reminder" });
  }
  // company documents: one weekly nudge (Mondays) listing what each person hasn't read, if switched on
  const cfg = (await db.doc("hrConfig/companyDocs").get()).data() || {};
  if (!cfg.weeklyReminder || new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long" }) !== "Monday") return;
  const docs = (await db.collection("companyDocs").where("archived", "==", false).get()).docs.filter(d => d.data().mustRead);
  const acks = {};
  for (const d of docs) (await d.ref.collection("acks").get()).docs.forEach(a => { if (a.data().version === d.data().version) (acks[a.id] = acks[a.id] || new Set()).add(d.id); });
  const staff = (await db.collection("people").where("status", "in", ["current", "leaving"]).get()).docs;
  for (const p of staff) {
    const todo = docs.filter(d => !(acks[p.id] && acks[p.id].has(d.id)));
    if (!todo.length) continue;
    await notify(p.id, { subject: `${todo.length} SAADI document${todo.length > 1 ? "s" : ""} to read`, heading: "Documents to read",
      lines: ["Please read these in SAADI Team and tick “I've read and understood”:", todo.slice(0, 12).map(d => `• ${esc(d.data().title)}`).join("<br>")],
      button: "Read them", url: HUB + "team/#docs", push: { title: "Documents to read 📄", body: `${todo.length} waiting for you` } });
  }
});

/* ------------------------------------------------------------------ Breathe copy */
async function breathe(path, key) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch("https://api.breathehr.com/v1/" + path, { headers: { "X-API-KEY": key, accept: "application/json" } });
    if (r.status === 429) { await sleep(15000); continue; }
    if (!r.ok) throw new Error(`Breathe ${path}: ${r.status}`);
    return r.json();
  }
  throw new Error(`Breathe ${path}: still rate-limited`);
}
async function breatheAll(ep, key) {
  const out = [];
  for (let page = 1; page < 200; page++) {
    const d = await breathe(`${ep}?per_page=100&page=${page}`, key);
    const items = Object.values(d).find(Array.isArray) || [];
    out.push(...items);
    if (items.length < 100) break;
    await sleep(1200);
  }
  return out;
}
const nm = v => (v && typeof v === "object" ? v.name || v.title || null : v || null);
const idOf = v => (v && typeof v === "object" ? v.id : v) || null;
const day = v => (v ? String(v).slice(0, 10) : null);
const clean = o => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? null : v)));
const status = s => (/ex-employee/i.test(s || "") ? "leaver" : /pending leaver/i.test(s || "") ? "leaving" : "current");

// First run only: who runs SAADI Team. Editable afterwards on Hub › People.
const FIRST_ROLES = { owner: ["david brooke", "melanie sach"], manager: ["derek trotter"] };

async function runBreatheSync(key) {
  const started = Date.now();
  const [emps, absences, requests, sick, patterns, allowances] = [
    await breatheAll("employees", key), await breatheAll("absences", key), await breatheAll("leave_requests", key),
    await breatheAll("sicknesses", key), await breatheAll("working_patterns", key), await breatheAll("holiday_allowances", key)
  ];
  const writes = [];
  const put = (path, data) => writes.push({ path, data: clean({ ...data, source: "breathe", updatedBy: "breathe-sync" }) });

  const existingPeople = new Map((await db.collection("people").get()).docs.map(d => [d.id, d.data()]));
  // people added in SAADI Team (source "team") who are later added to Breathe too: link by email instead of making a duplicate
  const teamByEmail = new Map([...existingPeople].filter(([, p]) => p.source === "team" && p.emailLower).map(([id, p]) => [p.emailLower, id]));
  const alias = new Map();
  const pidOf = id => alias.get(String(id)) || "b" + id;
  for (const e of emps) {
    const linked = teamByEmail.get(norm(e.email));
    if (linked && !existingPeople.has("b" + e.id)) { alias.set(String(e.id), linked); writes.push({ path: `people/${linked}`, data: { breatheId: e.id } }); continue; }
    const pid = "b" + e.id, old = existingPeople.get(pid) || {};
    const full = `${e.first_name || ""} ${e.last_name || ""}`.trim().toLowerCase();
    const role = old.role || (FIRST_ROLES.owner.includes(full) ? "owner" : FIRST_ROLES.manager.includes(full) ? "manager" : "staff");
    put(`people/${pid}`, {
      breatheId: e.id, firstName: e.first_name, lastName: e.last_name, knownAs: e.known_as || null,
      email: e.email || null, emailLower: norm(e.email) || null, jobTitle: e.job_title || null,
      department: nm(e.department), division: nm(e.division), location: nm(e.location),
      status: status(e.status), joinDate: day(e.join_date), leavingDate: day(e.leaving_date), role,
      lineManagerId: idOf(e.line_manager) ? "b" + idOf(e.line_manager) : null,
      holidayApproverId: idOf(e.holiday_approver) ? "b" + idOf(e.holiday_approver) : null,
      patternId: idOf(e.working_pattern) ? String(idOf(e.working_pattern)) : null,
      allowanceId: idOf(e.holiday_allowance) ? String(idOf(e.holiday_allowance)) : null,
      contractType: e.contract_type || null, fullOrPartTime: e.full_or_part_time || null,
      hoursPerWeek: e.total_working_hours != null ? Number(e.total_working_hours) : null
    });
    // Personal details the person and managers need (data minimisation: no NI, bank, salary, ethnicity, gender).
    put(`people/${pid}/private/personal`, {
      personId: pid, dob: day(e.dob), personalMobile: e.personal_mobile || null, personalEmail: e.personal_email || null,
      address: [e.address1, e.address2, e.address3, e.city, e.county, e.postcode].filter(Boolean).join(", ") || null
    });
  }
  for (const a of absences) put(`leave/ba${a.id}`, {
    personId: pidOf(idOf(a.employee)), type: a.type === "Holiday" ? "holiday" : "other",
    start: day(a.start_date), end: day(a.end_date), halfStart: !!a.half_start, halfStartPm: a.half_start_am_pm === "pm",
    halfEnd: !!a.half_end, halfEndPm: a.half_end_am_pm === "pm", units: a.work_units != null ? Number(a.work_units) : null,
    deducted: a.deducted != null ? Number(a.deducted) : null, status: a.cancelled ? "cancelled" : "approved",
    reason: nm(a.leave_reason), notes: a.notes || null
  });
  // Approved requests are already in absences; bring across the ones still waiting or turned down.
  for (const q of requests) if (q.status !== "approved") put(`leave/br${q.id}`, {
    personId: pidOf(idOf(q.employee)), type: q.type === "Holiday" ? "holiday" : "other",
    start: day(q.start_date), end: day(q.end_date), halfStart: !!q.half_start, halfStartPm: q.half_start_am_pm === "pm",
    halfEnd: !!q.half_end, halfEndPm: q.half_end_am_pm === "pm", deducted: q.deducted != null ? Number(q.deducted) : null,
    status: q.cancelled ? "cancelled" : q.status === "denied" ? "declined" : "pending", reason: nm(q.reason), notes: q.notes || null
  });
  for (const s of sick) {
    put(`sickness/bs${s.id}`, {
      personId: pidOf(idOf(s.employee)), start: day(s.start_date), end: day(s.end_date),
      halfStart: !!s.half_start, halfEnd: !!s.half_end, deducted: s.deducted != null ? Number(s.deducted) : null,
      status: s.status === "closed" ? "closed" : "open"
    });
    // Health details: owners only (special category data)
    put(`sicknessDetail/bs${s.id}`, { personId: pidOf(idOf(s.employee)), type: nm(s.company_sicknesstype), reason: s.reason || null, reviewNotes: s.review_notes || null });
  }
  for (const w of patterns) {
    const days = {};
    for (const d of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) days[d] = { on: !!w[d], hours: w[d + "_hr"] != null ? Number(w[d + "_hr"]) : null };
    put(`patterns/${w.id}`, { name: w.name, days, totalHours: w.total_hours != null ? Number(w.total_hours) : null, isDefault: !!w.default });
  }
  for (const h of allowances) put(`allowances/${h.id}`, {
    name: h.name, amount: h.amount != null ? Number(h.amount) : null, units: h.units || null,
    carryover: !!h.carryover_allowed, byService: !!h.depends_on_service
  });

  // Only write what changed, so the audit log and costs only reflect real changes.
  const refs = writes.map(w => db.doc(w.path));
  const current = new Map();
  for (let i = 0; i < refs.length; i += 300) (await db.getAll(...refs.slice(i, i + 300))).forEach(s => s.exists && current.set(s.ref.path, s.data()._h));
  const bw = db.bulkWriter();
  let changed = 0;
  for (const w of writes) {
    const h = sha(JSON.stringify(w.data));
    if (current.get(w.path) === h) continue;
    changed++;
    bw.set(db.doc(w.path), { ...w.data, _h: h, updatedAt: FV.serverTimestamp() }, { merge: true });
  }
  await bw.close();
  const summary = { people: emps.length, leave: absences.length, requests: requests.length, sickness: sick.length,
    patterns: patterns.length, allowances: allowances.length, changed, seconds: Math.round((Date.now() - started) / 1000) };
  await db.doc("hrConfig/breatheSync").set({ lastRun: FV.serverTimestamp(), ...summary, updatedBy: "breathe-sync" });
  logger.info("Breathe sync", summary);
  return summary;
}
exports.breatheNightly = onSchedule({ schedule: "30 2 * * *", timeZone: "Europe/London", secrets: [BREATHE_API_KEY], timeoutSeconds: 1800, memory: "512MiB" },
  () => runBreatheSync(BREATHE_API_KEY.value()).then(() => undefined));
exports.breatheSyncNow = onCall({ secrets: [BREATHE_API_KEY], timeoutSeconds: 1800, memory: "512MiB" }, async req => {
  if (!req.auth || req.auth.token.role !== "owner") throw new HttpsError("permission-denied", "Owners only.");
  return runBreatheSync(BREATHE_API_KEY.value());
});
