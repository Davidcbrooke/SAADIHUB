/**
 * SAADI Hub: Staffing connector (Google Apps Script web app).
 * Reads the termly staffing sheet and Breathe HR, and gives the Hub only what the Staffing page needs:
 *   - the rota tabs (cell text, and the class column's colours),
 *   - current staff: id, names, work email (for cover requests), job title, department (no pay, bank, address or other personal details),
 *   - time off in a date range: who, from, to, half days, and "holiday" or "off" (never the reason or sickness type).
 * The Breathe key stays in this script's properties and never reaches the Hub or anyone's browser.
 *
 * Set up (once):
 *   1. script.google.com > New project, name it "SAADI Hub Staffing", paste this file in, save.
 *   2. Project settings (cog) > Script properties > add:
 *        BREATHE_API_KEY  = the key from Breathe (Configure > Settings > Integrations > API setup)
 *        SHEET_ID         = the staffing sheet's ID (the long code in its link)
 *        TOKEN            = a long random password (the Hub's Staffing page makes one for you)
 *   3. Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone". Copy the Web app URL into the Hub.
 * Each new term: change SHEET_ID to the new term's sheet (or paste the new link into the Hub's Staffing settings).
 */
var P = PropertiesService.getScriptProperties();
/* A property's value with any stray spaces, line breaks, quotes or a leading "=" removed (easy to paste by mistake). */
function prop_(name) { return String(P.getProperty(name) || '').replace(/^[\s"'=]+|[\s"']+$/g, ''); }

function doPost(e) {
  try {
    var q = JSON.parse(e.postData.contents || '{}');
    if (!q.token || q.token !== prop_('TOKEN')) return out_({ ok: false, error: 'Wrong token' });
    var res = { ok: true, at: new Date().toISOString(), version: 3 };
    // cover: write the confirmed person into the rota, or close a shift so late "I can do it" taps are thanked and turned away
    if (q.action === 'write') { res.written = write_(q.sheetId || prop_('SHEET_ID'), q); return out_(res); }
    if (q.action === 'close') { P.setProperty('X:' + q.c, JSON.stringify({ by: q.by || '', at: res.at })); return out_(res); }
    if (q.action === 'reopen') { P.deleteProperty('X:' + q.c); return out_(res); }
    var want = q.want || ['rota', 'staff', 'off'];
    if (want.indexOf('rota') >= 0) res.rota = rota_(q.sheetId || prop_('SHEET_ID'));
    if (want.indexOf('staff') >= 0) res.staff = staff_();
    if (want.indexOf('off') >= 0) res.off = off_(q.from, q.to);
    if (want.indexOf('replies') >= 0) res.replies = replies_();
    return out_(res);
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

/* The "I can do it" link in a cover email: ?c=shift&p=person&n=first name&s=shift text&k=signature */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.c) return out_({ ok: true, hello: 'SAADI Hub Staffing connector', version: 3 });
  var ok = p.k && p.k === sign_(p.c + '|' + p.p);
  var msg, head;
  if (!ok) { head = 'That link doesn\'t look right'; msg = 'Please reply to the email instead and reception will sort it out.'; }
  else if (P.getProperty('X:' + p.c)) { head = 'Thank you, ' + (p.n || '') + '!'; msg = 'This shift has already been covered, so you\'re not needed this time. Thanks for offering.'; }
  else {
    var key = 'R:' + p.c, list = JSON.parse(P.getProperty(key) || '[]');
    if (!list.some(function (x) { return String(x.p) === String(p.p); })) list.push({ p: p.p, n: p.n || '', at: new Date().toISOString() });
    P.setProperty(key, JSON.stringify(list));
    head = 'Thanks, ' + (p.n || '') + '!';
    msg = 'You\'ve said you can cover <b>' + esc_(p.s || 'this shift') + '</b>. Reception will confirm by email. It isn\'t yours until they do, as someone else may have said yes first.';
  }
  var html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>SAADI cover</title>' +
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:40px auto;padding:24px;border-radius:14px;border-top:8px solid #f20779;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.08)">' +
    '<h2 style="margin:0 0 10px;color:#1d1a1f">' + esc_(head) + '</h2><p style="font-size:16px;line-height:1.5;color:#333;margin:0">' + msg + '</p>' +
    '<p style="font-size:13px;color:#888;margin:18px 0 0">SAADI Gymnastics</p></div>';
  return HtmlService.createHtmlOutput(html).setTitle('SAADI cover').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function esc_(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function sign_(msg) {
  var b = Utilities.computeHmacSha256Signature(msg, prop_('TOKEN'));
  return b.map(function (x) { return ('0' + ((x + 256) % 256).toString(16)).slice(-2); }).join('').slice(0, 20);
}
function replies_() {
  var all = P.getProperties(), out = {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('R:') === 0) (out[k.slice(2)] = out[k.slice(2)] || {}).yes = JSON.parse(all[k] || '[]');
    if (k.indexOf('X:') === 0) (out[k.slice(2)] = out[k.slice(2)] || {}).closed = JSON.parse(all[k] || '{}');
  });
  return out;
}
/* Put the cover person's name in the rota cell, but only if the cell still says what the Hub saw (nobody has changed it since). */
function write_(id, q) {
  var sh = SpreadsheetApp.openById(id).getSheetByName(q.tab);
  if (!sh) throw new Error('No tab called ' + q.tab);
  var cell = sh.getRange(q.row + 1, q.col + 1), now = String(cell.getDisplayValue()).trim();
  if (now !== String(q.expect || '').trim()) throw new Error('The rota cell has changed since the Hub read it (it now says "' + now + '"). Refresh and try again.');
  cell.setValue(q.value);
  if (q.note) cell.setNote(q.note);
  return { tab: q.tab, row: q.row + 1, col: q.col + 1, value: q.value };
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function rota_(id) {
  if (!id) throw new Error('No staffing sheet set (SHEET_ID)');
  var ss = SpreadsheetApp.openById(id);
  return { title: ss.getName(), tabs: ss.getSheets().map(function (sh) {
    var n = sh.getLastRow(), m = sh.getLastColumn();
    if (!n || !m) return { name: sh.getName(), values: [], bg: [] };
    return {
      name: sh.getName(),
      values: sh.getRange(1, 1, n, m).getDisplayValues(),
      bg: sh.getRange(1, 3, n, 1).getBackgrounds().map(function (r) { return r[0]; })
    };
  }) };
}

function breathe_(path) {
  var key = prop_('BREATHE_API_KEY');
  if (!key) throw new Error('No Breathe key set (BREATHE_API_KEY)');
  var all = [], page = 1;
  while (page <= 30) {
    var url = 'https://api.breathehr.com/v1/' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'per_page=100&page=' + page;
    var r = UrlFetchApp.fetch(url, { headers: { 'X-API-KEY': key }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Breathe said ' + r.getResponseCode() + ' for ' + path.split('?')[0] + (r.getResponseCode() === 401 ? ' (the key in Script properties is ' + key.length + ' characters; a Breathe key is usually 48)' : ''));
    var j = JSON.parse(r.getContentText()), k = Object.keys(j).filter(function (x) { return Array.isArray(j[x]); })[0];
    var items = k ? j[k] : [];
    all = all.concat(items);
    if (items.length < 100) break;
    page++;
  }
  return all;
}

function staff_() {
  return breathe_('employees').filter(function (e) { return e.status !== 'Ex-employee'; }).map(function (e) {
    return { id: e.id, first: e.first_name || '', last: e.last_name || '', known: e.known_as || '',
      email: e.email || e.personal_email || '', job: e.job_title || '', dept: (e.department && e.department.name) || '', leaving: e.status === 'Pending leaver' ? (e.leaving_date || 'soon') : '' };
  });
}

function off_(from, to) {
  var tz = 'Europe/London', today = new Date();
  from = from || Utilities.formatDate(new Date(today.getTime() - 7 * 864e5), tz, 'yyyy-MM-dd');
  to = to || Utilities.formatDate(new Date(today.getTime() + 60 * 864e5), tz, 'yyyy-MM-dd');
  var q = '?start_date=' + from + '&end_date=' + to, list = [];
  breathe_('absences' + q).forEach(function (a) {
    if (a.cancelled) return;
    var end = a.end_date || a.start_date;
    if (end < from || a.start_date > to) return;
    list.push({ emp: a.employee && a.employee.id, start: a.start_date, end: end, halfStart: !!a.half_start, halfEnd: !!a.half_end,
      kind: /holiday|annual/i.test(a.type || '') ? 'holiday' : 'off' });
  });
  breathe_('sicknesses' + q).forEach(function (s) {
    var end = s.end_date || to;   // still off if no end date yet
    if (end < from || s.start_date > to) return;
    list.push({ emp: s.employee && s.employee.id, start: s.start_date, end: end, halfStart: !!s.half_start, halfEnd: !!s.half_end, kind: 'off' });
  });
  return list;
}
