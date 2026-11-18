/**
 * FollowUps.js: the weekly follow-up list.
 *
 * Once a week (Monday morning when automatic updates are on), for each row I own whose
 * follow-up is due, it drafts a follow-up as a reply in the original Gmail thread, then
 * emails me one list of everything drafted. Like first emails, nothing is ever sent for me.
 */

function weeklyFollowUps() {
  syncWithGmail(); // pick up anything sent or replied since the last sync first
  var settings = getSettings_();
  var templates = getTemplates_();
  var data = readOutreach_();
  var me = myEmail_();
  var today = now_();

  var due = rowsDueForFollowUp(data.rows, today, settings, me);
  var stale = data.rows.filter(function (r) {
    return String(r['Owner'] || '').toLowerCase() === me.toLowerCase() && isOutOfFollowUps(r, today, settings);
  });
  var unsent = data.rows.filter(function (r) {
    return String(r['Owner'] || '').toLowerCase() === me.toLowerCase() && r['Status'] === STATUS.FOLLOW_UP_DRAFTED;
  });
  var drafted = [], failed = [];

  due.forEach(function (row) {
    try {
      var url = draftFollowUp_(data, row, templates, settings);
      drafted.push({ row: row, draftUrl: url });
    } catch (err) {
      log_(data.sheet, data.headers, row._row, 'Follow-up draft failed: ' + err.message);
      failed.push({ row: row, error: err.message });
    }
  });

  if (drafted.length || failed.length || stale.length || unsent.length) {
    var html = buildDigestHtml({ drafted: drafted, failed: failed, unsent: unsent, stale: stale, sheetUrl: getSpreadsheet_().getUrl() });
    GmailApp.sendEmail(me, 'B4P outreach: ' + drafted.length + ' follow-up(s) ready to review', 'Open this email in Gmail to see the list.', {
      htmlBody: html,
      name: 'B4P Outreach'
    });
  }
  return { drafted: drafted.length, failed: failed.length, unsent: unsent.length, stale: stale.length };
}

/** Menu wrapper. */
function weeklyFollowUpsFromMenu() {
  var r = weeklyFollowUps();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    r.drafted + ' follow-up draft(s) saved. ' + (r.drafted || r.failed || r.stale || r.unsent ? 'The list was emailed to you.' : 'Nothing is due.'),
    'B4P Outreach', 10);
}

/** Drafts one follow-up as a reply in the row's thread. @return {string} link to the thread */
function draftFollowUp_(data, row, templates, settings) {
  var threadId = String(row['Gmail thread'] || '');
  if (!threadId) throw new Error('No Gmail thread recorded for this row');
  var thread = GmailApp.getThreadById(threadId);
  if (!thread) throw new Error('Gmail thread not found');
  var messages = thread.getMessages().filter(function (m) { return !m.isDraft(); });
  if (!messages.length) throw new Error('Gmail thread is empty');
  var first = messages[0];
  var lastMsg = messages[messages.length - 1];

  var template = getTemplateFor_(templates, row['Type'], 'follow-up');
  var prompt = buildDraftPrompt({
    row: row,
    template: renderTemplate_(template, row, settings),
    websiteText: fetchWebsiteText_(row['Website']),
    settings: settings,
    kind: 'follow-up',
    previousEmail: 'Subject: ' + first.getSubject() + '\n\n' + first.getPlainBody().slice(0, 3000)
  });
  var draft = draftWithClaude_(settings, prompt);

  // Reply in the same thread so the recipient sees the history. GmailApp cannot set a
  // thread on a new draft, so this uses the Gmail advanced service.
  var raw = buildRawReply({
    to: String(row['Contact email']).trim(),
    subject: replySubject(first.getSubject()),
    body: draft.body,
    inReplyTo: lastMsg.getHeader('Message-ID'),
    references: first.getHeader('References')
  });
  Gmail.Users.Drafts.create({
    message: { raw: Utilities.base64EncodeWebSafe(raw, Utilities.Charset.UTF_8), threadId: threadId }
  }, 'me');

  writeRow_(data.sheet, data.headers, row._row, { 'Status': STATUS.FOLLOW_UP_DRAFTED, 'Next follow-up': '' });
  log_(data.sheet, data.headers, row._row, 'Follow-up ' + ((Number(row['Follow-ups sent']) || 0) + 1) + ' drafted');
  return 'https://mail.google.com/mail/u/0/#all/' + threadId;
}
