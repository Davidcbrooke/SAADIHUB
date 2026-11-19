// Template only. Get your own copy, with the desk's key filled in, from the desk:
// Emails & settings > Sending emails > Copy the mailer code.
/**
 * SAADI Enquiry Desk mailer (version 6). Sends the desk's emails from reception@saadigymnastics.co.uk,
 * reads the renewal form responses for the Term Renewals page, and every 5 minutes moves families' emailed
 * "Change of class" / "Not continuing" requests into the "Renewal replies" folder and adds them to that spreadsheet.
 * Set up from the desk: Emails & settings > Sending emails. Don't share this code: it contains the desk's key.
 */
var KEY = 'KEY-FROM-THE-DESK';
var SENDER = 'reception@saadigymnastics.co.uk';

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.token !== KEY) return reply({ ok: false, error: 'wrong key' });
    var me = Session.getEffectiveUser().getEmail();
    if (me.toLowerCase() !== SENDER.toLowerCase()) return reply({ ok: false, from: me, error: 'this mailer is in ' + me + "'s Google account, not " + SENDER });
    if (p.ping) return reply({ ok: true, from: me, left: MailApp.getRemainingDailyQuota(), v: 6 });
    if (p.assist) return reply(assistHandle(p, me));
    // Term Renewals: read the renewal form responses (class change / non renewal) from a spreadsheet reception can open.
    if (p.sheet) {
      var ss = SpreadsheetApp.openById(p.sheet), tabs = {}, added = 0, importError = '';
      // First copy any "Change of class" / "Not continuing" emails from reception's inbox into the sheet.
      PropertiesService.getScriptProperties().setProperty('RENEWAL_SHEET', p.sheet);
      var lock = LockService.getScriptLock();
      if (lock.tryLock(20000)) {
        try { moveRenewalEmails(); added = importRenewalEmails(ss); } catch (ie) { importError = String(ie.message || ie); } finally { lock.releaseLock(); }
      }
      ss.getSheets().forEach(function (sh) { tabs[sh.getName()] = sh.getDataRange().getDisplayValues(); });
      return reply({ ok: true, from: me, name: ss.getName(), tabs: tabs, added: added, importError: importError, v: 4 });
    }
    if (!p.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.to)) return reply({ ok: false, error: 'email address missing or not valid' });
    if (!p.subject || !p.html) return reply({ ok: false, error: 'nothing to send' });
    GmailApp.sendEmail(p.to, p.subject, p.text || '', { htmlBody: p.html, name: p.fromName || 'SAADI Gymnastics', replyTo: SENDER });
    return reply({ ok: true, from: me, left: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String(err.message || err) });
  }
}

function doGet() { return reply({ ok: true, service: 'SAADI Enquiry Desk mailer' }); }

/** Press Run on this once after pasting, so Google asks for permission to send email, read and update the renewal
    spreadsheet and file the renewal emails. It also sets the 5-minute check of the inbox for renewal emails. */
function allowSending() {
  SpreadsheetApp.getActiveSpreadsheet();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });   // permission to reach the SAADI Hub (Email assistant)
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'checkRenewalEmails') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkRenewalEmails').timeBased().everyMinutes(5).create();
  Logger.log('Ready to send as ' + Session.getEffectiveUser().getEmail() + '. ' + MailApp.getRemainingDailyQuota() + ' emails left today. Renewal emails are checked every 5 minutes.');
}

function reply(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- emailed renewal replies -> "Renewal replies" folder -> the renewal spreadsheet ----------
   The renewal reminder's buttons open ready-written emails to reception. Every 5 minutes (and whenever the Term
   Renewals page reads the sheet) new ones are moved out of the inbox into the "Renewal replies" folder, then each is
   added as a row to the "Class change (emails)" or "Non Renewal (emails)" tab and marked "Renewal replies/Added to sheet". */
var FOLDER = 'Renewal replies', DONE_LABEL = 'Renewal replies/Added to sheet';
var MATCH = '(subject:"Change of class for" OR subject:"Not continuing in")';
var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var CHANGE_HEAD = ['Timestamp', 'Email Address',
  "Child's Name", 'Current Class Day', 'Current Class Time', 'Current Class Group Colour',
  "Second Child's Name", 'Current Class Day (2nd Child)', 'Current Class Time (2nd Child)', 'Current Class Group Colour (2nd Child)',
  "Third Child's Name", 'Current Class Day (3rd Child)', 'Current Class Time (3rd Child)', 'Current Class Group Colour (3rd Child)',
  "Fourth Child's Name", 'Current Class Day (4th Child)', 'Current Class Time (4th Child)', 'Current Class Group Colour (4th Child)',
  'Additional Logistical Requests', 'New Class Day Request', 'New Class Time Request', 'Email Subject'];
var LEAVE_HEAD = ['Timestamp', 'Email Address', 'What is the main reason you are leaving us?', 'Child', 'Current Class', 'Email Subject'];

function labelNamed(n) { return GmailApp.getUserLabelByName(n) || GmailApp.createLabel(n); }
function hasLabel(t, n) { return t.getLabels().some(function (l) { return l.getName() === n; }); }
function isRenewalSubject(subj) { return /^\s*(Change of class for|Not continuing in)/i.test(subj || ''); }

/* Runs every 5 minutes (set up by allowSending). */
function checkRenewalEmails() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    moveRenewalEmails();
    var id = PropertiesService.getScriptProperties().getProperty('RENEWAL_SHEET');
    if (id) importRenewalEmails(SpreadsheetApp.openById(id));
  } finally { lock.releaseLock(); }
  assistantRun(false);   // Email assistant: draft replies to new emails (does nothing until it's switched on in the Hub)
}

/* New renewal emails: out of the inbox and into the folder. Only once per conversation, so if reception later
   replies and the parent answers, that answer stays in the inbox as normal. */
function moveRenewalEmails() {
  var folder = labelNamed(FOLDER), n = 0;
  GmailApp.search('in:inbox newer_than:90d ' + MATCH, 0, 100).forEach(function (t) {
    if (hasLabel(t, FOLDER) || !isRenewalSubject(t.getFirstMessageSubject())) return;
    t.addLabel(folder); t.moveToArchive(); n++;
  });
  return n;
}

/* Emails in the folder that aren't on the sheet yet. */
function importRenewalEmails(ss) {
  var folder = labelNamed(FOLDER), done = labelNamed(DONE_LABEL);
  var threads = GmailApp.search('label:renewal-replies -label:renewal-replies-added-to-sheet newer_than:90d', 0, 100);
  var tz = ss.getSpreadsheetTimeZone() || 'Europe/London', change = [], leave = [];
  threads.forEach(function (t) {
    if (hasLabel(t, DONE_LABEL)) return;
    var found = false;
    t.getMessages().forEach(function (m) {
      if (found) return;
      var subj = m.getSubject() || '';
      if (!isRenewalSubject(subj)) return;
      var isChange = /^\s*Change of class for/i.test(subj);
      var from = m.getFrom() || '', email = ((from.match(/<([^>]+)>/) || [0, from])[1] || '').trim();
      if (!email || email.toLowerCase() === SENDER.toLowerCase()) return;
      found = true;
      var body = String(m.getPlainBody() || '').replace(/\r/g, '');
      var ts = Utilities.formatDate(m.getDate(), tz, 'MM/dd/yyyy HH:mm:ss');
      var kids = kidsFrom(subj, body);
      if (isChange) {
        var wish = section(body, /Days and times that would suit us\s*:/i);
        var row = [ts, email];
        for (var i = 0; i < 4; i++) { var k = kids[i] || ['', '', '', '']; row.push(k[0], k[1], k[2], k[3]); }
        row.push(wish, daysIn(wish).join(', '), wish.replace(/\s+or\s+/gi, ', '), subj);
        change.push(row);
      } else {
        var reason = section(body, /Reason \(optional\)\s*:/i) || 'Not continuing (emailed reception)';
        (kids.length ? kids : [['', '', '', '']]).forEach(function (k) {
          leave.push([ts, email, reason, k[0], [k[1], k[2], k[4] || ''].join(' ').trim(), subj]);
        });
      }
    });
    t.addLabel(done);
  });
  addRows(ss, 'Class change (emails)', CHANGE_HEAD, change);
  addRows(ss, 'Non Renewal (emails)', LEAVE_HEAD, leave);
  return change.length + leave.length;
}

/* Children named in the subject ("...: Mia Smith and Tom Smith"), with their class from the "This term:" line. */
function kidsFrom(subj, body) {
  var who = subj.split(':').slice(1).join(':').trim();
  var names = who && !/^my child$/i.test(who) ? who.split(/\s+and\s+|\s*,\s*|\s*&\s*/).filter(String) : [];
  var line = (body.match(/This term\s*:\s*([^\n]*)/i) || [])[1] || '', segs = [];
  line.split(/\s*;\s*/).forEach(function (s) {
    var m = s.match(/^\s*([^:]+?)\s*:\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\S+)\s*(.*)$/i);
    if (m) segs.push({ first: m[1].trim(), day: m[2], time: m[3], cls: m[4].trim() });
  });
  if (!names.length) names = segs.map(function (s) { return s.first; });
  return names.map(function (n, i) {
    var f = n.split(/\s+/)[0].toLowerCase();
    var s = segs.filter(function (x) { return x.first.toLowerCase() === f; })[0] || (names.length === segs.length ? segs[i] : null) || {};
    var col = ((s.cls || '').match(/\b(orange|yellow|blue|red|green|purple|pink)\b/i) || [])[1] || '';
    return [n, s.day || '', s.time || '', col ? col.charAt(0).toUpperCase() + col.slice(1).toLowerCase() : '', s.cls || ''];
  });
}

/* What the parent wrote after a label, up to their sign-off. */
function section(body, re) {
  var m = body.match(re);
  if (!m) return '';
  var rest = body.slice(m.index + m[0].length).split('\n'), out = [];
  for (var i = 0; i < rest.length; i++) {
    var l = rest[i];
    if (/^\s*(thank you|thanks|many thanks|kind regards|best wishes|regards)\b/i.test(l) || /^\s*>/.test(l) || /^On .+wrote:\s*$/.test(l)) break;
    out.push(l.trim());
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function daysIn(text) {
  var found = [];
  (String(text).match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*/gi) || []).forEach(function (w) {
    var d = DAYS.filter(function (x) { return x.slice(0, 3).toLowerCase() === w.slice(0, 3).toLowerCase(); })[0];
    if (d && found.indexOf(d) < 0) found.push(d);
  });
  return found;
}

function addRows(ss, name, head, rows) {
  if (!rows.length) return;
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); sh.setFrozenRows(1); }
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
}



/* ---------- Email assistant (version 6) ----------
   Every 5 minutes (with the renewal check) new emails in this inbox are copied to the Email assistant's own section
   of the SAADI Hub database as "waiting for Claude". Once an hour Claude (Dave's scheduled job) reads them there and
   writes the drafts back; this script then adds each draft to Gmail with a label. Staff check, edit and press Send on
   the Hub's Email Assistant page. Claude never has this script's key, so it can never send. Switched on from the Hub. */
var AS = { ready: 'Assistant/Ready', person: 'Assistant/Needs a person', sent: 'Assistant/Sent', done: 'Assistant/Done', skipped: 'Assistant/Skipped' };
var AS_MAX_NEW = 15;
var AS_AUTO = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|newsletter|bounce|@(.*\.)?(justgo|stripe|squarespace|google|facebookmail|instagram|linkedin|paypal|gocardless|xero|quickbooks|intuit|canva|brevo|sendinblue|mailchimp)\.)/i;

function asProps() { return PropertiesService.getScriptProperties(); }
function asProp(k) { return asProps().getProperty(k) || ''; }
function asOn() { return asProp('ASSIST_ON') === '1' && !!asProp('ASSIST_DATA'); }

/* Requests from the Hub (already checked against the desk's key in doPost). */
function assistHandle(p, me) {
  var props = asProps();
  if (p.assist === 'connect') {
    if (!p.dataKey || String(p.dataKey).length < 20 || !p.project) return { ok: false, error: 'missing Hub details' };
    props.setProperties({ ASSIST_DATA: String(p.dataKey), ASSIST_PROJECT: String(p.project), ASSIST_ON: p.on === false ? '0' : '1' });
    asLabels();
    return { ok: true, from: me, v: 6, on: p.on !== false };
  }
  if (p.assist === 'status') return { ok: true, from: me, v: 6, on: asOn(), lastRun: asProp('ASSIST_LAST_RUN'), lastError: asProp('ASSIST_LAST_ERROR') };
  if (p.assist === 'run') { var n = assistantRun(true); return { ok: true, collected: n, lastError: asProp('ASSIST_LAST_ERROR') }; }
  if (p.assist === 'send') return assistSend(p.threadId, p.body, p.by);
  if (p.assist === 'done') return assistFinish(p.threadId, AS.done, true, p.by);
  if (p.assist === 'skip') return assistFinish(p.threadId, AS.skipped, false, p.by);
  return { ok: false, error: 'unknown assistant request' };
}

function asLabels() { Object.keys(AS).forEach(function (k) { labelNamed(AS[k]); }); }
function asMine(m) { return String(m.getFrom()).toLowerCase().indexOf(SENDER.toLowerCase()) > -1; }
function asLastIncoming(t) { var ms = t.getMessages(); for (var i = ms.length - 1; i >= 0; i--) if (!asMine(ms[i])) return ms[i]; return null; }
function asDraftFor(threadId) {
  var ds = GmailApp.getDrafts();
  for (var i = 0; i < ds.length; i++) { var m = ds[i].getMessage(); if (m && m.getThread().getId() === threadId) return ds[i]; }
  return null;
}

/* ---- the Hub's database (Firestore REST; the path is only known to the Hub and this script) ---- */
function fsBase() { return 'https://firestore.googleapis.com/v1/projects/' + asProp('ASSIST_PROJECT') + '/databases/(default)/documents/data/' + asProp('ASSIST_DATA') + '/'; }
function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsVal) } };
  if (typeof v === 'object') { var f = {}; Object.keys(v).forEach(function (k) { f[k] = fsVal(v[k]); }); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function fsPlain(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('mapValue' in v) { var o = {}, f = v.mapValue.fields || {}; Object.keys(f).forEach(function (k) { o[k] = fsPlain(f[k]); }); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsPlain);
  return null;
}
function fsDoc(raw) { var o = {}, f = raw.fields || {}; Object.keys(f).forEach(function (k) { o[k] = fsPlain(f[k]); }); o._id = String(raw.name || '').split('/').pop(); return o; }
function fsSet(path, obj) {
  var fields = {}; Object.keys(obj).forEach(function (k) { fields[k] = fsVal(obj[k]); });
  var mask = Object.keys(obj).map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); }).join('&');
  var r = UrlFetchApp.fetch(fsBase() + path + '?' + mask, { method: 'patch', contentType: 'application/json', payload: JSON.stringify({ fields: fields }), muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('Hub database ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
}
function fsGet(path) {
  var r = UrlFetchApp.fetch(fsBase() + path, { muteHttpExceptions: true });
  return r.getResponseCode() === 200 ? fsDoc(JSON.parse(r.getContentText())) : null;
}
function fsDel(path) { UrlFetchApp.fetch(fsBase() + path, { method: 'delete', muteHttpExceptions: true }); }
function fsList(col) {
  var out = [], token = '';
  do {
    var r = UrlFetchApp.fetch(fsBase() + col + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) break;
    var j = JSON.parse(r.getContentText());
    (j.documents || []).forEach(function (d) { out.push(fsDoc(d)); });
    token = j.nextPageToken || '';
  } while (token);
  return out;
}

/* ---- every 5 minutes: copy new emails to the Hub ---- */
function assistantRun(manual) {
  if (!asOn()) return 0;
  var added = 0, lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return 0;
  try {
    var seen = JSON.parse(asProp('ASSIST_SEEN') || '[]');
    var threads = GmailApp.search('in:inbox newer_than:3d -category:promotions -category:social', 0, 40);
    for (var i = 0; i < threads.length && added < AS_MAX_NEW; i++) {
      var t = threads[i], ms = t.getMessages(), last = ms[ms.length - 1];
      if (asMine(last)) continue;                                   // reception already replied
      if (seen.indexOf(last.getId()) > -1) continue;               // already copied
      seen.push(last.getId());
      if (isRenewalSubject(t.getFirstMessageSubject()) || AS_AUTO.test(last.getFrom())) continue;
      var convo = ms.slice(-4).map(function (m) {
        return 'From: ' + m.getFrom() + '\nDate: ' + Utilities.formatDate(m.getDate(), 'Europe/London', 'EEE d MMM yyyy HH:mm') + '\n\n' + String(m.getPlainBody() || '').slice(0, 3500);
      }).join('\n\n-----\n\n');
      t.removeLabel(labelNamed(AS.ready)).removeLabel(labelNamed(AS.person));
      fsSet('emailAssist/' + t.getId(), {
        threadId: t.getId(), status: 'new', needsPerson: false, summary: '', reason: '', draft: '',
        from: last.getFrom(), subject: t.getFirstMessageSubject(), date: last.getDate().getTime(),
        text: String(last.getPlainBody() || '').slice(0, 6000), convo: convo, count: ms.length,
        attachments: last.getAttachments().map(function (a) { return a.getName(); }), addedAt: Date.now()
      });
      added++;
    }
    asGmailDrafts();
    asProps().setProperty('ASSIST_SEEN', JSON.stringify(seen.slice(-500)));
    asProps().setProperty('ASSIST_LAST_RUN', new Date().toISOString());
    asProps().deleteProperty('ASSIST_LAST_ERROR');
    if (new Date().getMinutes() < 5) asTidy();                      // once an hour: drop finished items older than 30 days
  } catch (err) {
    asProps().setProperty('ASSIST_LAST_ERROR', new Date().toISOString() + ' ' + String(err.message || err).slice(0, 300));
    if (manual) throw err;
  } finally { lock.releaseLock(); }
  return added;
}
/* Claude's drafts (written to the Hub) also go into Gmail as a draft reply, with a label. */
function asGmailDrafts() {
  fsList('emailAssist').forEach(function (d) {
    if (d.status !== 'waiting' || d.inGmail || !d.draft) return;
    var t = GmailApp.getThreadById(String(d.threadId));
    if (t) {
      var inc = asLastIncoming(t), old = asDraftFor(t.getId());
      if (old) old.deleteDraft();
      if (inc) inc.createDraftReply(String(d.draft));
      t.addLabel(labelNamed(d.needsPerson ? AS.person : AS.ready));
    }
    fsSet('emailAssist/' + d._id, { inGmail: true, convo: '' });
  });
}
function asTidy() {
  var cut = Date.now() - 30 * 864e5;
  fsList('emailAssist').forEach(function (d) {
    if (d._id !== '_config' && ['sent', 'done', 'skipped', 'ignored'].indexOf(d.status) > -1 && (d.doneAt || d.addedAt || 0) < cut) fsDel('emailAssist/' + d._id);
  });
}

/* ---- buttons on the Hub page ---- */
function asThread(threadId) {
  var cur = fsGet('emailAssist/' + String(threadId || ''));
  if (!cur || ['new', 'waiting'].indexOf(cur.status) < 0) throw new Error('That email is no longer waiting in the Email assistant.');
  var t = GmailApp.getThreadById(String(threadId));
  if (!t) throw new Error('That email has gone (deleted or moved).');
  return t;
}
function asHtml(text) {
  return '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</div>';
}
function assistSend(threadId, text, by) {
  var t = asThread(threadId);
  text = String(text || '').replace(/\r/g, '').trim();
  if (!text) return { ok: false, error: 'The reply is empty.' };
  var inc = asLastIncoming(t);
  if (!inc) return { ok: false, error: 'There is no message to reply to.' };
  inc.reply(text, { htmlBody: asHtml(text), name: 'SAADI Gymnastics' });
  var d = asDraftFor(t.getId()); if (d) d.deleteDraft();
  t.removeLabel(labelNamed(AS.ready)).removeLabel(labelNamed(AS.person)).addLabel(labelNamed(AS.sent));
  t.markRead(); t.moveToArchive();
  fsSet('emailAssist/' + t.getId(), { status: 'sent', text: '', convo: '', draft: '', doneBy: String(by || ''), doneAt: Date.now() });
  return { ok: true };
}
/* Done: archive it, no reply. Skip: leave it in the inbox (with any draft) to deal with in Gmail. */
function assistFinish(threadId, to, archive, by) {
  var t = asThread(threadId);
  t.removeLabel(labelNamed(AS.ready)).removeLabel(labelNamed(AS.person)).addLabel(labelNamed(to));
  if (archive) { var d = asDraftFor(t.getId()); if (d) d.deleteDraft(); t.markRead(); t.moveToArchive(); }
  fsSet('emailAssist/' + t.getId(), { status: archive ? 'done' : 'skipped', text: '', convo: '', draft: '', doneBy: String(by || ''), doneAt: Date.now() });
  return { ok: true };
}
