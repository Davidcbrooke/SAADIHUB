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
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
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
      button: "Approve or decline", url: HUB + "people.html",
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
      button: "Open People", url: HUB + "people.html",
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
    button: "Open People", url: HUB + "people.html",
    push: { title: "Off sick 🤒", body: `${who} from ${fmtDay(after.start)}. Shifts need cover.` }
  })));
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
  for (const e of emps) {
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
    personId: "b" + idOf(a.employee), type: a.type === "Holiday" ? "holiday" : "other",
    start: day(a.start_date), end: day(a.end_date), halfStart: !!a.half_start, halfStartPm: a.half_start_am_pm === "pm",
    halfEnd: !!a.half_end, halfEndPm: a.half_end_am_pm === "pm", units: a.work_units != null ? Number(a.work_units) : null,
    deducted: a.deducted != null ? Number(a.deducted) : null, status: a.cancelled ? "cancelled" : "approved",
    reason: nm(a.leave_reason), notes: a.notes || null
  });
  // Approved requests are already in absences; bring across the ones still waiting or turned down.
  for (const q of requests) if (q.status !== "approved") put(`leave/br${q.id}`, {
    personId: "b" + idOf(q.employee), type: q.type === "Holiday" ? "holiday" : "other",
    start: day(q.start_date), end: day(q.end_date), halfStart: !!q.half_start, halfStartPm: q.half_start_am_pm === "pm",
    halfEnd: !!q.half_end, halfEndPm: q.half_end_am_pm === "pm", deducted: q.deducted != null ? Number(q.deducted) : null,
    status: q.cancelled ? "cancelled" : q.status === "denied" ? "declined" : "pending", reason: nm(q.reason), notes: q.notes || null
  });
  for (const s of sick) {
    put(`sickness/bs${s.id}`, {
      personId: "b" + idOf(s.employee), start: day(s.start_date), end: day(s.end_date),
      halfStart: !!s.half_start, halfEnd: !!s.half_end, deducted: s.deducted != null ? Number(s.deducted) : null,
      status: s.status === "closed" ? "closed" : "open"
    });
    // Health details: owners only (special category data)
    put(`sicknessDetail/bs${s.id}`, { personId: "b" + idOf(s.employee), type: nm(s.company_sicknesstype), reason: s.reason || null, reviewNotes: s.review_notes || null });
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
