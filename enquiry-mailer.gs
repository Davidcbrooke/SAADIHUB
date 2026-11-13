/**
 * SAADI Enquiry Desk: mailer.
 * Sends the desk's HTML emails from the Google account this script belongs to
 * (set it up in the reception@saadigymnastics.co.uk account so emails come from reception
 * and appear in its Sent folder).
 *
 * Setup (once, about 5 minutes):
 *  1. Signed in as reception@, go to https://script.google.com and click New project.
 *     Name it "SAADI Enquiry Desk mailer". Delete what's there and paste in this whole file.
 *  2. Choose makeKey in the function list at the top and press Run. Allow the permissions it asks for.
 *     Open View > Logs (or Execution log): copy the key it shows.
 *  3. Deploy > New deployment > type: Web app.
 *       Execute as: Me.   Who has access: Anyone.
 *     Press Deploy and copy the web app URL (ends in /exec).
 *  4. In the Enquiry Desk: Emails & settings > Sending emails. Paste the URL and the key,
 *     send yourself a test email, then press Save settings.
 *
 * "Anyone" only means the address can be reached. Nothing is sent without the key,
 * and the key is kept inside the password-protected hub.
 * Google allows about 1,500 emails a day on a Workspace account.
 */

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    var key = PropertiesService.getScriptProperties().getProperty('KEY');
    if (!key || p.token !== key) return reply({ ok: false, error: 'wrong key' });
    if (!p.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.to)) return reply({ ok: false, error: 'email address missing or not valid' });
    if (!p.subject || !p.html) return reply({ ok: false, error: 'nothing to send' });
    var opts = { htmlBody: p.html, name: p.fromName || 'SAADI Gymnastics' };
    if (p.replyTo) opts.replyTo = p.replyTo;
    GmailApp.sendEmail(p.to, p.subject, p.text || 'Please view this email in an email app that shows HTML.', opts);
    return reply({ ok: true, left: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String(err.message || err) });
  }
}

function doGet() {
  return reply({ ok: true, service: 'SAADI Enquiry Desk mailer' });
}

/** Run once to create the key. Run again to change it (then update it in the desk). */
function makeKey() {
  var key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  PropertiesService.getScriptProperties().setProperty('KEY', key);
  Logger.log('Your mailer key: ' + key);
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
