/**
 * Sheet.js: reading and writing the Outreach, Templates and Settings tabs.
 */

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOutreachSheet_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_OUTREACH);
  if (!sheet) throw new Error('No "' + SHEET_OUTREACH + '" tab. Run B4P Outreach > Set up this sheet first.');
  return sheet;
}

/** @return {{sheet, headers: string[], rows: Object[]}} */
function readOutreach_() {
  var sheet = getOutreachSheet_();
  var values = sheet.getDataRange().getValues();
  var parsed = rowsFromValues(values);
  return { sheet: sheet, headers: parsed.headers, rows: parsed.rows };
}

/** Writes the given fields of one row. Fields whose header is missing are skipped. */
function writeRow_(sheet, headers, rowNumber, fields) {
  Object.keys(fields).forEach(function (key) {
    var col = headers.indexOf(key);
    if (col === -1) return;
    sheet.getRange(rowNumber, col + 1).setValue(fields[key]);
  });
}

/** Settings tab: column A = name, column B = value. Missing names use DEFAULT_SETTINGS. */
function getSettings_() {
  var settings = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { settings[k] = DEFAULT_SETTINGS[k]; });
  var sheet = getSpreadsheet_().getSheetByName(SHEET_SETTINGS);
  if (!sheet) return settings;
  sheet.getDataRange().getValues().slice(1).forEach(function (r) {
    var key = String(r[0] || '').trim();
    if (key && r[1] !== '' && r[1] != null) settings[key] = r[1];
  });
  return settings;
}

/** Templates tab: Name | Subject | Body. @return {Object} name -> {subject, body} */
function getTemplates_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_TEMPLATES);
  if (!sheet) throw new Error('No "' + SHEET_TEMPLATES + '" tab. Run B4P Outreach > Set up this sheet first.');
  var templates = {};
  sheet.getDataRange().getValues().slice(1).forEach(function (r) {
    var name = String(r[0] || '').trim();
    if (name) templates[name] = { subject: String(r[1] || ''), body: String(r[2] || '') };
  });
  return templates;
}

function getTemplateFor_(templates, type, kind) {
  var name = templateName(type, kind);
  var t = templates[name];
  if (!t || !t.body) throw new Error('Missing template "' + name + '" in the Templates tab');
  return t;
}

/** The template as one block of text for the prompt, with row values filled in. */
function renderTemplate_(template, row, settings) {
  var values = {};
  Object.keys(row).forEach(function (k) { values[k] = row[k]; });
  values['Sender name'] = settings['Sender name'];
  values['Request link'] = settings['Request link'];
  values['Catalog link'] = settings['Catalog link'];
  return 'Subject: ' + fillTemplate(template.subject, values) + '\n\n' + fillTemplate(template.body, values);
}

function myEmail_() {
  return Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail();
}

function now_() {
  return new Date();
}

function log_(sheet, headers, rowNumber, message) {
  writeRow_(sheet, headers, rowNumber, { 'Script log': formatDate(now_()) + ' ' + message });
}
