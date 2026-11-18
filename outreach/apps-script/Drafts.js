/**
 * Drafts.js: writes a personalized first email for each new row and saves it to Gmail drafts.
 *
 * Nothing is ever sent. The person running it reviews each draft in Gmail and presses Send;
 * the next sync (Sync.js) sees the sent email and updates the row.
 */

/** Menu: draft emails for every New row that is mine or unclaimed. */
function draftNewEmails() {
  var result = runFirstDrafts_();
  var msg = result.drafted + ' draft(s) saved to your Gmail drafts.';
  if (result.failed) msg += ' ' + result.failed + ' failed, see the Script log column.';
  if (result.skippedDuplicates) msg += ' ' + result.skippedDuplicates + ' skipped as possible duplicates.';
  if (result.remaining) msg += ' ' + result.remaining + ' more waiting, run it again to continue.';
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'B4P Outreach', 10);
  return result;
}

/** Menu: draft only the rows currently selected. */
function draftSelectedRows() {
  var range = SpreadsheetApp.getActiveSpreadsheet().getActiveRange();
  if (!range || range.getSheet().getName() !== SHEET_OUTREACH) {
    SpreadsheetApp.getUi().alert('Select one or more rows in the Outreach tab first.');
    return null;
  }
  var wanted = [];
  for (var r = range.getRow(); r < range.getRow() + range.getNumRows(); r++) wanted.push(r);
  return runFirstDrafts_(wanted);
}

/**
 * @param {number[]=} onlyRows limit to these sheet row numbers
 * @return {{drafted:number, failed:number, skippedDuplicates:number, remaining:number}}
 */
function runFirstDrafts_(onlyRows) {
  var settings = getSettings_();
  var templates = getTemplates_();
  var me = myEmail_();
  var max = Number(settings['Max drafts per run']) || 8;

  // Claim rows under a lock so two people running this at once never draft the same clinic.
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  var data, claimed, dupCount, remaining;
  try {
    data = readOutreach_();
    markDuplicates_(data);
    var dups = findDuplicates(data.rows);
    var candidates = data.rows.filter(function (r) { return !onlyRows || onlyRows.indexOf(r._row) !== -1; });
    dupCount = candidates.filter(function (r) {
      return (r['Status'] || STATUS.NEW) === STATUS.NEW && dups[r._row];
    }).length;
    var ready = rowsReadyToDraft(candidates, dups, me);
    claimed = ready.slice(0, max);
    remaining = ready.length - claimed.length;
    claimed.forEach(function (row) {
      if (!row['Owner']) {
        row['Owner'] = me;
        writeRow_(data.sheet, data.headers, row._row, { 'Owner': me });
      }
      if (!row['Status']) writeRow_(data.sheet, data.headers, row._row, { 'Status': STATUS.NEW });
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  var drafted = 0, failed = 0;
  claimed.forEach(function (row) {
    try {
      var template = getTemplateFor_(templates, row['Type'], 'first');
      var websiteText = fetchWebsiteText_(row['Website']);
      var prompt = buildDraftPrompt({
        row: row,
        template: renderTemplate_(template, row, settings),
        websiteText: websiteText,
        settings: settings,
        kind: 'first'
      });
      var draft = draftWithClaude_(settings, prompt);
      GmailApp.createDraft(String(row['Contact email']).trim(), draft.subject, draft.body);
      writeRow_(data.sheet, data.headers, row._row, {
        'Status': STATUS.DRAFT_READY,
        'Draft subject': draft.subject,
        'Draft created': now_()
      });
      log_(data.sheet, data.headers, row._row, 'Draft saved to ' + me + (websiteText ? '' : ' (website could not be loaded)'));
      drafted++;
    } catch (err) {
      log_(data.sheet, data.headers, row._row, 'Draft failed: ' + err.message);
      failed++;
    }
  });
  return { drafted: drafted, failed: failed, skippedDuplicates: dupCount, remaining: remaining };
}
