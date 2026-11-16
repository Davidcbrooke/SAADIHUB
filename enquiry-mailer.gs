// Template only. Get your own copy, with the desk's key filled in, from the desk:
// Emails & settings > Sending emails > Copy the mailer code.
/**
 * SAADI Enquiry Desk mailer (version 3). Sends the desk's emails from reception@saadigymnastics.co.uk,
 * reads the renewal form responses for the Term Renewals page, and adds families' emailed
 * "Change of class" / "Not continuing" requests to that spreadsheet.
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
    if (p.ping) return reply({ ok: true, from: me, left: MailApp.getRemainingDailyQuota(), v: 3 });
    // Term Renewals: read the renewal form responses (class change / non renewal) from a spreadsheet reception can open.
    if (p.sheet) {
      var ss = SpreadsheetApp.openById(p.sheet), tabs = {}, added = 0, importError = '';
      // First copy any "Change of class" / "Not continuing" emails from reception's inbox into the sheet.
      try { added = importRenewalEmails(ss); } catch (ie) { importError = String(ie.message || ie); }
      ss.getSheets().forEach(function (sh) { tabs[sh.getName()] = sh.getDataRange().getDisplayValues(); });
      return reply({ ok: true, from: me, name: ss.getName(), tabs: tabs, added: added, importError: importError, v: 3 });
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

/** Press Run on this once after pasting, so Google asks for permission to send email and read the renewal forms' spreadsheet. */
function allowSending() { SpreadsheetApp.getActiveSpreadsheet(); Logger.log('Ready to send as ' + Session.getEffectiveUser().getEmail() + '. ' + MailApp.getRemainingDailyQuota() + ' emails left today.'); }

function reply(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- emailed renewal replies -> the renewal spreadsheet ----------
   The renewal reminder's buttons open ready-written emails to reception. Each one found here is added as a row to the
   "Class change (emails)" or "Non Renewal (emails)" tab, and the email is labelled so it is only added once. */
var DONE_LABEL = 'Added to renewals sheet';
var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var CHANGE_HEAD = ['Timestamp', 'Email Address',
  "Child's Name", 'Current Class Day', 'Current Class Time', 'Current Class Group Colour',
  "Second Child's Name", 'Current Class Day (2nd Child)', 'Current Class Time (2nd Child)', 'Current Class Group Colour (2nd Child)',
  "Third Child's Name", 'Current Class Day (3rd Child)', 'Current Class Time (3rd Child)', 'Current Class Group Colour (3rd Child)',
  "Fourth Child's Name", 'Current Class Day (4th Child)', 'Current Class Time (4th Child)', 'Current Class Group Colour (4th Child)',
  'Additional Logistical Requests', 'New Class Day Request', 'New Class Time Request', 'Email Subject'];
var LEAVE_HEAD = ['Timestamp', 'Email Address', 'What is the main reason you are leaving us?', 'Child', 'Current Class', 'Email Subject'];

function importRenewalEmails(ss) {
  var label = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  var threads = GmailApp.search('newer_than:90d -label:added-to-renewals-sheet (subject:"Change of class for" OR subject:"Not continuing in")', 0, 100);
  var tz = ss.getSpreadsheetTimeZone() || 'Europe/London', change = [], leave = [];
  threads.forEach(function (t) {
    if (t.getLabels().some(function (l) { return l.getName() === DONE_LABEL; })) return;
    var done = false;
    t.getMessages().forEach(function (m) {
      if (done) return;
      var subj = m.getSubject() || '';
      if (/^\s*(re|fwd?|fw)\s*:/i.test(subj)) return;
      var isChange = /^\s*Change of class for/i.test(subj), isLeave = /^\s*Not continuing in/i.test(subj);
      if (!isChange && !isLeave) return;
      var from = m.getFrom() || '', email = ((from.match(/<([^>]+)>/) || [0, from])[1] || '').trim();
      if (!email || email.toLowerCase() === SENDER.toLowerCase()) return;
      done = true;
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
    t.addLabel(label);
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
