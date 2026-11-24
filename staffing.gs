/**
 * SAADI Hub: Staffing connector (Google Apps Script web app).
 * Reads the termly staffing sheet and Breathe HR, and gives the Hub only what the Staffing page needs:
 *   - the rota tabs (cell text, and the class column's colours),
 *   - current staff: id, names, work email and mobile (for cover requests; never shown in the Hub), job title, department (no pay, bank, address or other personal details),
 *   - time off in a date range: who, from, to, half days, "holiday" or "off", and who is covering if the note names them
 *     (never the note, the reason or sickness type).
 * The Breathe key stays in this script's properties and never reaches the Hub or anyone's browser.
 *
 * Set up (once):
 *   1. script.google.com > New project, name it "SAADI Hub Staffing", paste this file in, save.
 *   2. Project settings (cog) > Script properties > add:
 *        BREATHE_API_KEY  = the key from Breathe (Configure > Settings > Integrations > API setup)
 *        SHEET_ID         = the staffing sheet's ID (the long code in its link)
 *        TOKEN            = a long random password (the Hub's Staffing page makes one for you)
 *        QBO_CLIENT_ID / QBO_CLIENT_SECRET = QuickBooks production keys (developer.intuit.com, app "SAADI HUB"), optional
 *        QBO_OWNER_KEY = Dave's own key for QuickBooks figures (not the Hub TOKEN; the Hub never sees QuickBooks)
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
    var res = { ok: true, at: new Date().toISOString(), version: 9 };
    // cover: write the confirmed person into the rota, or close a shift so late "I can do it" taps are thanked and turned away
    if (q.action === 'write') { res.written = write_(q.sheetId || prop_('SHEET_ID'), q); return out_(res); }
    if (q.action === 'close') { P.setProperty('X:' + q.c, JSON.stringify({ by: q.by || '', at: res.at })); return out_(res); }
    if (q.action === 'reopen') { P.deleteProperty('X:' + q.c); return out_(res); }
    var owner = prop_('QBO_OWNER_KEY') && q.ownerKey === prop_('QBO_OWNER_KEY');   // QuickBooks is Dave-only: never the Hub's token
    if (q.action === 'qboDisconnect') { if (!owner) return out_({ ok: false, error: 'Owner key needed' }); res.qbo = qboDisconnect_(); return out_(res); }
    var want = q.want || ['rota', 'staff', 'off'];
    if (want.indexOf('rota') >= 0) res.rota = rota_(q.sheetId || prop_('SHEET_ID'));
    if (want.indexOf('staff') >= 0) res.staff = staff_();
    if (want.indexOf('off') >= 0) res.off = off_(q.from, q.to);
    if (want.indexOf('replies') >= 0) res.replies = replies_();
    if (owner && want.indexOf('qbo') >= 0) res.qbo = qboStatus_();
    if (want.indexOf('qboStaff') >= 0) res.qboStaff = qboStaff_(q.wageFor || []);
    if (owner && want.indexOf('qboCosts') >= 0) res.qboCosts = qboCosts_(q.from, q.to);
    return out_(res);
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

/* The "I can do it" link in a cover email: ?shift=id&who=person&name=first name&what=shift text&sig=signature (Google reserves ?c=) */
function doGet(e) {
  var q = (e && e.parameter) || {}, p = { c: q.shift, p: q.who, n: q.name, s: q.what, k: q.sig };
  if (q.qbo === 'connect') return qboConnectPage_(q);
  if (q.code && q.realmId) return qboCallback_(q);
  if (q.error && q.state) return qboPage_('QuickBooks was not connected', 'Intuit said: ' + esc_(q.error) + '. You can close this and try again from the Hub.');
  if (q.shift && q.pick) return pickPage_(q);
  if (!p.c) return out_({ ok: true, hello: 'SAADI Hub Staffing connector', version: 9 });
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
/* From a WhatsApp group message: everyone who can do the shift picks their own name, then lands on the normal "I can do it" page. */
function pickPage_(q) {
  var ok = q.sig && q.sig === sign_(q.shift + '|' + q.pick), base = ScriptApp.getService().getUrl(), body;
  if (!ok) body = '<h2>That link does not look right</h2><p>Please message reception instead.</p>';
  else if (P.getProperty('X:' + q.shift)) body = '<h2>Thank you!</h2><p>This shift has already been covered.</p>';
  else {
    var people = String(q.pick).split(',').map(function (x) { var i = x.indexOf(':'); return { id: x.slice(0, i), n: x.slice(i + 1) }; });
    body = '<h2>Can you cover?</h2><p style="color:#333">' + esc_(q.what || '') + '</p><p style="color:#333">Tap your name:</p>' +
      people.map(function (x) {
        var link = base + '?shift=' + encodeURIComponent(q.shift) + '&who=' + encodeURIComponent(x.id) + '&name=' + encodeURIComponent(x.n) + '&what=' + encodeURIComponent(q.what || '') + '&sig=' + sign_(q.shift + '|' + x.id);
        return '<a href="' + esc_(link) + '" target="_top" style="display:block;margin:8px 0;padding:12px 16px;border-radius:10px;background:#f20779;color:#fff;font-weight:700;text-decoration:none;font-size:16px">' + esc_(x.n) + '</a>';
      }).join('') + '<p style="font-size:13px;color:#888">Not on the list? This shift needs a particular position, so please message reception.</p>';
  }
  var html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:Arial,sans-serif;max-width:520px;margin:30px auto;padding:22px;border-radius:14px;border-top:8px solid #f20779;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.08)">' + body + '<p style="font-size:13px;color:#888;margin-top:16px">SAADI Gymnastics</p></div>';
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
      email: e.email || e.personal_email || '', wa: waNumber_(e.personal_mobile || e.ddi || ''), job: e.job_title || '', dept: (e.department && e.department.name) || '', leaving: e.status === 'Pending leaver' ? (e.leaving_date || 'soon') : '' };
  });
}

/* A UK mobile for a wa.me link: digits only, 07... -> 447... (only mobiles; landlines can't take WhatsApp messages from staff phones) */
function waNumber_(n) {
  var d = String(n || '').replace(/[^0-9+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  if (/^07\d{9}$/.test(d)) d = '44' + d.slice(1);
  else if (/^7\d{9}$/.test(d)) d = '44' + d;
  if (/^447\d{9}$/.test(d)) return d;                                   // UK mobile
  return (/^(?!44)[1-9]\d{9,14}$/.test(d)) ? d : '';                     // another country's number, as entered
}

/* Staff named in a note: full name, known-as + surname, first name + surname initial ("Grace K"),
   or a first name on its own when only one current member of staff has it. Not the person who is off. */
function coverIn_(note, people, self) {
  var t = ' ' + String(note || '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  var firsts = {};
  people.forEach(function (p) { [p.first, p.known].forEach(function (f) { f = String(f || '').toLowerCase(); if (f) firsts[f] = (firsts[f] || 0) + 1; }); });
  var hit = [];
  people.forEach(function (p) {
    if (String(p.id) === String(self)) return;
    var last = String(p.last || '').toLowerCase(), forms = [];
    [p.first, p.known].forEach(function (f) { f = String(f || '').toLowerCase(); if (!f) return;
      if (last) { forms.push(f + ' ' + last); forms.push(f + ' ' + last.charAt(0)); }
      if (firsts[f] === 1 && f.length > 2) forms.push(f); });
    if (forms.some(function (x) { return t.indexOf(' ' + x + ' ') >= 0; })) hit.push(p.id);
  });
  return hit.slice(0, 3);
}

function off_(from, to) {
  var tz = 'Europe/London', today = new Date();
  from = from || Utilities.formatDate(new Date(today.getTime() - 7 * 864e5), tz, 'yyyy-MM-dd');
  to = to || Utilities.formatDate(new Date(today.getTime() + 60 * 864e5), tz, 'yyyy-MM-dd');
  var q = '?start_date=' + from + '&end_date=' + to, list = [], people = null;
  breathe_('absences' + q).forEach(function (a) {
    if (a.cancelled) return;
    var end = a.end_date || a.start_date;
    if (end < from || a.start_date > to) return;
    var item = { emp: a.employee && a.employee.id, start: a.start_date, end: end, halfStart: !!a.half_start, halfEnd: !!a.half_end,
      kind: /holiday|annual/i.test(a.type || '') ? 'holiday' : 'off' };
    // Who's covering, from the absence note ("Bailey covering me", "Covered by Alicia Hood", "covered 9-1 by Grace K").
    // Only the matched staff ids leave this script, never the note itself (notes often give private reasons).
    if (/cover/i.test(a.notes || '')) {
      people = people || staff_();
      var c = coverIn_(a.notes, people, item.emp);
      if (c.length) { item.cover = c; item.coverPart = /\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\s*(?:-|–|to|till|until)\s*\d/i.test(a.notes); }
    }
    list.push(item);
  });
  breathe_('sicknesses' + q).forEach(function (s) {
    var end = s.end_date || to;   // still off if no end date yet
    if (end < from || s.start_date > to) return;
    list.push({ emp: s.employee && s.employee.id, start: s.start_date, end: end, halfStart: !!s.half_start, halfEnd: !!s.half_end, kind: 'off' });
  });
  return list;
}

/* ---------------- QuickBooks Online (read only, accounting scope) ----------------
 * Owner only: every QuickBooks request needs QBO_OWNER_KEY (kept in C:\NGL\credentials\.env, never in the Hub).
 * Connect by opening <web app url>?qbo=connect&sig=<QBO_OWNER_KEY>. Intuit sends the browser back here with a code,
 * which is swapped for tokens kept only in this script's properties. Access tokens last an hour and are renewed
 * automatically; the refresh token rolls on as long as it's used at least every 100 days.
 * Errors are logged with Intuit's intuit_tid (QBO_LOG, last 50) so Intuit support can trace them.
 */
var QBO_REDIRECT = 'https://script.google.com/macros/s/AKfycbz0Z9rRzE2sGUliJy36kw0he1dvdi4IZYp1L8FY_kcMGBRzxvyNNax9hrxbiN6umzAEsw/exec';
var QBO_API = 'https://quickbooks.api.intuit.com/v3/company/';
function qboRedirect_() { return prop_('QBO_REDIRECT') || QBO_REDIRECT; }
function qboDiscovery_() {
  var c = CacheService.getScriptCache(), hit = c.get('qboDisc');
  if (hit) return JSON.parse(hit);
  var r = UrlFetchApp.fetch('https://developer.api.intuit.com/.well-known/openid_configuration', { muteHttpExceptions: true });
  var d = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : {};
  d = { auth: d.authorization_endpoint || 'https://appcenter.intuit.com/connect/oauth2',
        token: d.token_endpoint || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
        revoke: d.revocation_endpoint || 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke' };
  c.put('qboDisc', JSON.stringify(d), 21600);
  return d;
}
function qboTid_(r) { var h = r.getHeaders(); return h['intuit_tid'] || h['Intuit_tid'] || h['INTUIT_TID'] || ''; }
function qboLog_(what, code, tid, detail) {
  var log = JSON.parse(P.getProperty('QBO_LOG') || '[]');
  log.unshift({ at: new Date().toISOString(), what: what, code: code, intuit_tid: tid || '', detail: String(detail || '').slice(0, 300) });
  P.setProperty('QBO_LOG', JSON.stringify(log.slice(0, 50)));
}
function qboPage_(head, msg) {
  var html = '<!doctype html><title>SAADI Hub: QuickBooks</title><div style="font-family:Arial,sans-serif;max-width:520px;margin:40px auto;padding:24px;border-radius:14px;border-top:8px solid #2ca01c;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.08)">' +
    '<h2 style="margin:0 0 10px;color:#1d1a1f">' + esc_(head) + '</h2><p style="font-size:16px;line-height:1.5;color:#333;margin:0">' + msg + '</p><p style="font-size:13px;color:#888;margin:18px 0 0">SAADI Business Hub</p></div>';
  return HtmlService.createHtmlOutput(html).setTitle('SAADI Hub: QuickBooks').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
/* Step 1: the Hub opens ?qbo=connect&sig=... (signed with the Hub token, so only the Hub can start a connection). */
function qboConnectPage_(q) {
  if (!prop_('QBO_OWNER_KEY') || q.sig !== prop_('QBO_OWNER_KEY')) return qboPage_('That link does not look right', 'Please start again from the Staffing page in the Hub.');
  if (!prop_('QBO_CLIENT_ID') || !prop_('QBO_CLIENT_SECRET')) return qboPage_('QuickBooks keys missing', 'Add QBO_CLIENT_ID and QBO_CLIENT_SECRET to this script\'s properties first.');
  var state = Utilities.getUuid();
  CacheService.getScriptCache().put('qboState:' + state, '1', 900);   // CSRF check, valid 15 minutes
  var url = qboDiscovery_().auth + '?client_id=' + encodeURIComponent(prop_('QBO_CLIENT_ID')) + '&response_type=code&scope=' +
    encodeURIComponent('com.intuit.quickbooks.accounting') + '&redirect_uri=' + encodeURIComponent(qboRedirect_()) + '&state=' + state;
  return qboPage_('Connect QuickBooks', 'Sign in as the QuickBooks admin and choose <b>SAADI Gymnastics</b>. The Hub can only read the accounts; it cannot change anything.<br><br>' +
    '<a href="' + esc_(url) + '" target="_top" style="display:inline-block;padding:12px 22px;background:#2ca01c;color:#fff;font-weight:700;text-decoration:none;border-radius:999px">Connect to QuickBooks</a>');
}
/* Step 2: Intuit sends the browser back with ?code=...&realmId=...&state=... */
function qboCallback_(q) {
  var c = CacheService.getScriptCache();
  if (!q.state || !c.get('qboState:' + q.state)) return qboPage_('That did not work', 'The connection link had expired or did not come from the Hub. Please start again from the Staffing page.');
  c.remove('qboState:' + q.state);
  try {
    qboTokens_({ grant_type: 'authorization_code', code: q.code, redirect_uri: qboRedirect_() });
    P.setProperty('QBO_REALM_ID', String(q.realmId));
    var co = qboGet_('companyinfo/' + q.realmId);
    var name = co && co.CompanyInfo ? co.CompanyInfo.CompanyName : '';
    P.setProperty('QBO_COMPANY', name);
    return qboPage_('QuickBooks connected', 'The Hub is now connected to <b>' + esc_(name || 'your QuickBooks company') + '</b> (read only). You can close this tab.');
  } catch (err) {
    return qboPage_('QuickBooks was not connected', esc_(String(err.message || err)));
  }
}
function qboTokens_(form) {
  var auth = Utilities.base64Encode(prop_('QBO_CLIENT_ID') + ':' + prop_('QBO_CLIENT_SECRET'));
  var r = UrlFetchApp.fetch(qboDiscovery_().token, { method: 'post', payload: form, muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' } });
  var code = r.getResponseCode(), j = {};
  try { j = JSON.parse(r.getContentText()); } catch (e) {}
  if (code !== 200) {
    qboLog_('token ' + form.grant_type, code, qboTid_(r), j.error || r.getContentText());
    if (j.error === 'invalid_grant') { ['QBO_REFRESH', 'QBO_ACCESS', 'QBO_ACCESS_EXP'].forEach(function (k) { P.deleteProperty(k); }); throw new Error('QuickBooks needs reconnecting (access expired or was removed).'); }
    throw new Error('QuickBooks sign-in failed (' + code + (j.error ? ', ' + j.error : '') + ')');
  }
  P.setProperty('QBO_ACCESS', j.access_token);
  P.setProperty('QBO_ACCESS_EXP', String(Date.now() + (Number(j.expires_in || 3600) - 120) * 1000));
  if (j.refresh_token) P.setProperty('QBO_REFRESH', j.refresh_token);
  P.setProperty('QBO_REFRESHED', new Date().toISOString());
  return j.access_token;
}
function qboAccess_(force) {
  if (!force && P.getProperty('QBO_ACCESS') && Number(P.getProperty('QBO_ACCESS_EXP') || 0) > Date.now()) return P.getProperty('QBO_ACCESS');
  if (!P.getProperty('QBO_REFRESH')) throw new Error('QuickBooks is not connected yet.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { return qboTokens_({ grant_type: 'refresh_token', refresh_token: P.getProperty('QBO_REFRESH') }); }
  finally { lock.releaseLock(); }
}
/* GET from the Accounting API; on an expired token, renew once and retry. */
function qboGet_(path) {
  var realm = P.getProperty('QBO_REALM_ID'); if (!realm) throw new Error('QuickBooks is not connected yet.');
  for (var attempt = 0; attempt < 2; attempt++) {
    var url = QBO_API + realm + '/' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'minorversion=75';
    var r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + qboAccess_(attempt > 0), Accept: 'application/json' }, muteHttpExceptions: true });
    var code = r.getResponseCode();
    if (code === 401 && attempt === 0) continue;
    if (code !== 200) { var tid = qboTid_(r); qboLog_('GET ' + path.split('?')[0], code, tid, r.getContentText()); throw new Error('QuickBooks said ' + code + ' for ' + path.split('?')[0] + (tid ? ' (ref ' + tid + ')' : '')); }
    return JSON.parse(r.getContentText());
  }
}
function qboStatus_() {
  var s = { keys: !!(prop_('QBO_CLIENT_ID') && prop_('QBO_CLIENT_SECRET')), connected: !!(P.getProperty('QBO_REFRESH') && P.getProperty('QBO_REALM_ID')),
            company: P.getProperty('QBO_COMPANY') || '', lastRenewed: P.getProperty('QBO_REFRESHED') || '' };
  var log = JSON.parse(P.getProperty('QBO_LOG') || '[]'); if (log.length) s.lastError = log[0];
  return s;
}
function qboDisconnect_() {
  var t = P.getProperty('QBO_REFRESH');
  if (t) {
    var auth = Utilities.base64Encode(prop_('QBO_CLIENT_ID') + ':' + prop_('QBO_CLIENT_SECRET'));
    UrlFetchApp.fetch(qboDiscovery_().revoke, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ token: t }), muteHttpExceptions: true, headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' } });
  }
  ['QBO_REFRESH', 'QBO_ACCESS', 'QBO_ACCESS_EXP', 'QBO_REALM_ID', 'QBO_COMPANY'].forEach(function (k) { P.deleteProperty(k); });
  return qboStatus_();
}
/* Staff costs for a date range from the Profit and Loss report: income total and every wage-type line. Totals only. */
function qboCosts_(from, to) {
  var rep = qboGet_('reports/ProfitAndLoss?start_date=' + from + '&end_date=' + to + '&accounting_method=Accrual');
  var lines = [], income = null, expenses = null;
  (function walk(rows) {
    (rows || []).forEach(function (r) {
      if (r.Summary && r.group === 'Income') income = Number(r.Summary.ColData[1].value || 0);
      if (r.Summary && r.group === 'Expenses') expenses = Number(r.Summary.ColData[1].value || 0);
      if (r.ColData && /wage|salar|payroll|pension|national insurance|\bni\b|staff|coach|employ/i.test(r.ColData[0].value || '') && !/welfare|training|uniform|recruit/i.test(r.ColData[0].value || ''))
        lines.push({ account: r.ColData[0].value, amount: Number(r.ColData[1].value || 0) });
      if (r.Rows) walk(r.Rows.Row);
    });
  })(rep.Rows && rep.Rows.Row);
  var staff = lines.reduce(function (a, b) { return a + b.amount; }, 0);
  return { from: from, to: to, currency: (rep.Header && rep.Header.Currency) || 'GBP', income: income, expenses: expenses, staffCosts: Math.round(staff * 100) / 100, lines: lines };
}

/* Staff from QuickBooks: correct name, date of birth, phone for everyone; hourly rate ONLY for the ids the Hub has
 * ticked (wageFor). No bank, NI number, address or salary details are read. */
function qboStaff_(wageFor) {
  var want = {}; (wageFor || []).forEach(function (id) { want[String(id)] = 1; });
  var out = [], start = 1;
  while (start < 5000) {
    var j = qboGet_('query?query=' + encodeURIComponent('select * from Employee startposition ' + start + ' maxresults 500'));
    var list = (j.QueryResponse && j.QueryResponse.Employee) || [];
    list.forEach(function (e) {
      var o = { id: e.Id, active: e.Active !== false, first: e.GivenName || '', middle: e.MiddleName || '', last: e.FamilyName || '',
                display: e.DisplayName || '', dob: e.BirthDate || '',
                phone: (e.Mobile && e.Mobile.FreeFormNumber) || (e.PrimaryPhone && e.PrimaryPhone.FreeFormNumber) || '',
                email: (e.PrimaryEmailAddr && e.PrimaryEmailAddr.Address) || '', hired: e.HiredDate || '', released: e.ReleasedDate || '',
                hasRate: e.BillRate != null && Number(e.BillRate) > 0 };
      if (want[String(e.Id)] && o.hasRate) o.hourly = Number(e.BillRate);
      out.push(o);
    });
    if (list.length < 500) break;
    start += 500;
  }
  return out;
}
