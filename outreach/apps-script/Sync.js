/**
 * Sync.js: reads the owner's Gmail and updates dates and status in the sheet.
 *
 * - A draft that has been sent becomes "Sent", with First/Last contacted dates and the Gmail thread.
 * - A follow-up that has been sent bumps "Follow-ups sent" and "Last contacted".
 * - A reply from the organization becomes "Replied".
 * - Every waiting row gets its "Next follow-up" date.
 *
 * Each person's sync only touches rows they own, because it can only see their own Gmail.
 * It runs hourly once automatic updates are on, and from the menu.
 */

function syncWithGmail() {
  var settings = getSettings_();
  var data = readOutreach_();
  var me = myEmail_();
  var mine = myAddresses_(me);
  var counts = { sent: 0, followUpsSent: 0, replied: 0, bounced: 0 };

  data.rows.forEach(function (row) {
    if (String(row['Owner'] || '').trim().toLowerCase() !== me.toLowerCase()) return;
    try {
      if (row['Status'] === STATUS.DRAFT_READY) {
        syncDraftReady_(data, row, mine, counts);
      }
      if (WAITING_STATUSES.indexOf(row['Status']) !== -1 && row['Gmail thread']) {
        syncThread_(data, row, mine, counts);
      }
      var next = nextFollowUpDate(row, settings);
      var nextText = next ? formatDate(next) : '';
      if (formatDate(row['Next follow-up']) !== nextText) {
        writeRow_(data.sheet, data.headers, row._row, { 'Next follow-up': next || '' });
      }
    } catch (err) {
      log_(data.sheet, data.headers, row._row, 'Sync failed: ' + err.message);
    }
  });
  return counts;
}

/** Menu wrapper that shows what changed. */
function syncWithGmailFromMenu() {
  var c = syncWithGmail();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    c.sent + ' newly sent, ' + c.followUpsSent + ' follow-ups sent, ' + c.replied + ' replies, ' + c.bounced + ' bounced.',
    'Synced with Gmail', 8);
}

function myAddresses_(me) {
  var list = [String(me).toLowerCase()];
  try {
    GmailApp.getAliases().forEach(function (a) { list.push(String(a).toLowerCase()); });
  } catch (e) { /* aliases are optional */ }
  return list;
}

function isFromMe_(message, mine) {
  var from = String(message.getFrom()).toLowerCase();
  return mine.some(function (addr) { return from.indexOf(addr) !== -1; });
}

function isBounce_(message) {
  return /mailer-daemon|postmaster/i.test(String(message.getFrom()));
}

function syncDraftReady_(data, row, mine, counts) {
  var to = String(row['Contact email']).trim().toLowerCase();
  var since = toDate(row['Draft created']) || addDays(now_(), -30);
  var query = 'in:sent to:' + to + ' after:' + formatDate(addDays(since, -1)).replace(/-/g, '/');
  var threads = GmailApp.search(query, 0, 10);
  var best = null;
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      if (m.isDraft() || !isFromMe_(m, mine)) return;
      if (String(m.getTo()).toLowerCase().indexOf(to) === -1) return;
      if (m.getDate().getTime() < since.getTime() - 60 * 1000) return;
      if (!best || m.getDate().getTime() < best.message.getDate().getTime()) best = { message: m, thread: thread };
    });
  });
  if (!best) return;
  var sentAt = best.message.getDate();
  var fields = {
    'Status': STATUS.SENT,
    'Last contacted': sentAt,
    'Gmail thread': best.thread.getId(),
    'Follow-ups sent': Number(row['Follow-ups sent']) || 0
  };
  if (!row['First contacted']) fields['First contacted'] = sentAt;
  writeRow_(data.sheet, data.headers, row._row, fields);
  Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
  log_(data.sheet, data.headers, row._row, 'First email sent');
  counts.sent++;
}

function syncThread_(data, row, mine, counts) {
  var thread = GmailApp.getThreadById(String(row['Gmail thread']));
  if (!thread) return;
  var last = toDate(row['Last contacted']) || toDate(row['First contacted']);
  var fields = {};
  var followUps = Number(row['Follow-ups sent']) || 0;
  var lastContacted = last;
  var replied = false, bounced = false;

  thread.getMessages().forEach(function (m) {
    if (m.isDraft()) return;
    var at = m.getDate();
    if (last && at.getTime() <= last.getTime() + 1000) return;
    if (isFromMe_(m, mine)) {
      followUps++;
      lastContacted = at;
    } else if (isBounce_(m)) {
      bounced = true;
    } else {
      replied = true;
    }
  });

  if (followUps !== (Number(row['Follow-ups sent']) || 0)) {
    fields['Follow-ups sent'] = followUps;
    fields['Last contacted'] = lastContacted;
    if (!replied) fields['Status'] = STATUS.SENT;
    counts.followUpsSent += followUps - (Number(row['Follow-ups sent']) || 0);
  }
  if (replied) {
    fields['Status'] = STATUS.REPLIED;
    counts.replied++;
  }
  if (Object.keys(fields).length) {
    writeRow_(data.sheet, data.headers, row._row, fields);
    Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
  }
  if (replied) log_(data.sheet, data.headers, row._row, 'They replied');
  else if (bounced) {
    log_(data.sheet, data.headers, row._row, 'Email bounced, check the address');
    counts.bounced++;
  }
}
