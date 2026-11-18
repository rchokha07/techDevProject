/**
 * Duplicates.js: flags rows that repeat an organization someone already has.
 *
 * Runs on every edit (simple onEdit trigger) and before drafting, so a duplicate is
 * caught as soon as someone types it in, and never gets a draft.
 */

var DUPLICATE_WATCH_COLUMNS = ['Organization', 'Website', 'Contact email', 'Owner'];

/** Recomputes the "Duplicate of" column for the whole sheet. @return {number} duplicates found */
function checkDuplicates() {
  var data = readOutreach_();
  return markDuplicates_(data);
}

function markDuplicates_(data) {
  var dups = findDuplicates(data.rows);
  var col = data.headers.indexOf('Duplicate of');
  if (col === -1) return Object.keys(dups).length;
  var lastRow = data.sheet.getLastRow();
  if (lastRow < 2) return 0;
  var range = data.sheet.getRange(2, col + 1, lastRow - 1, 1);
  var current = range.getValues();
  var changed = false;
  data.rows.forEach(function (row) {
    var note = dups[row._row] ? formatDuplicateNote(dups[row._row]) : '';
    row['Duplicate of'] = note;
    if (String(current[row._row - 2][0] || '') !== note) {
      current[row._row - 2][0] = note;
      changed = true;
    }
  });
  if (changed) range.setValues(current);
  return Object.keys(dups).length;
}

/** Simple trigger: Google runs this on every edit by a person. */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_OUTREACH || e.range.getRow() === 1) return;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var touched = false;
    for (var c = e.range.getColumn(); c < e.range.getColumn() + e.range.getNumColumns(); c++) {
      if (DUPLICATE_WATCH_COLUMNS.indexOf(headers[c - 1]) !== -1) { touched = true; break; }
    }
    if (!touched) return;
    var data = readOutreach_();
    markDuplicates_(data);
    var row = e.range.getRow();
    var hit = data.rows.filter(function (r) { return r._row === row && r['Duplicate of']; })[0];
    if (hit) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        hit['Organization'] + ' is already in the sheet. ' + hit['Duplicate of'] + '. Check with them before emailing.',
        'Possible duplicate', 10);
    }
  } catch (err) {
    // Never block someone's edit because of the checker.
    console.warn('onEdit duplicate check failed: ' + err);
  }
}
