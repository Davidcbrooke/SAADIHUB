// Template only. Get your own copy, with the desk's key filled in, from the desk:
// Emails & settings > Sending emails > Copy the mailer code.
/**
 * SAADI Enquiry Desk mailer. Sends the desk's emails from reception@saadigymnastics.co.uk.
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
    if (p.ping) return reply({ ok: true, from: me, left: MailApp.getRemainingDailyQuota() });
    if (!p.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.to)) return reply({ ok: false, error: 'email address missing or not valid' });
    if (!p.subject || !p.html) return reply({ ok: false, error: 'nothing to send' });
    GmailApp.sendEmail(p.to, p.subject, p.text || '', { htmlBody: p.html, name: p.fromName || 'SAADI Gymnastics', replyTo: SENDER });
    return reply({ ok: true, from: me, left: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String(err.message || err) });
  }
}

function doGet() { return reply({ ok: true, service: 'SAADI Enquiry Desk mailer' }); }

/** Press Run on this once after pasting, so Google asks for permission to send email. */
function allowSending() { Logger.log('Ready to send as ' + Session.getEffectiveUser().getEmail() + '. ' + MailApp.getRemainingDailyQuota() + ' emails left today.'); }

function reply(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
