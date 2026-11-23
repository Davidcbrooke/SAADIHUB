/**
 * SAADI Hub: Staffing connector (Google Apps Script web app).
 * Reads the termly staffing sheet and Breathe HR, and gives the Hub only what the Staffing page needs:
 *   - the rota tabs (cell text, and the class column's colours),
 *   - current staff: id, names, job title, department (no pay, bank, address or other personal details),
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

function doPost(e) {
  try {
    var q = JSON.parse(e.postData.contents || '{}');
    if (!q.token || q.token !== P.getProperty('TOKEN')) return out_({ ok: false, error: 'Wrong token' });
    var want = q.want || ['rota', 'staff', 'off'];
    var res = { ok: true, at: new Date().toISOString(), version: 1 };
    if (want.indexOf('rota') >= 0) res.rota = rota_(q.sheetId || P.getProperty('SHEET_ID'));
    if (want.indexOf('staff') >= 0) res.staff = staff_();
    if (want.indexOf('off') >= 0) res.off = off_(q.from, q.to);
    return out_(res);
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}
function doGet() { return out_({ ok: true, hello: 'SAADI Hub Staffing connector', version: 1 }); }
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
  var key = P.getProperty('BREATHE_API_KEY');
  if (!key) throw new Error('No Breathe key set (BREATHE_API_KEY)');
  var all = [], page = 1;
  while (page <= 30) {
    var url = 'https://api.breathehr.com/v1/' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'per_page=100&page=' + page;
    var r = UrlFetchApp.fetch(url, { headers: { 'X-API-KEY': key }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Breathe said ' + r.getResponseCode() + ' for ' + path.split('?')[0]);
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
      job: e.job_title || '', dept: (e.department && e.department.name) || '', leaving: e.status === 'Pending leaver' ? (e.leaving_date || 'soon') : '' };
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
