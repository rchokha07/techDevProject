/**
 * Menu.js: the "B4P Outreach" menu, first-time setup and triggers.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('B4P Outreach')
    .addItem('Draft emails for new rows', 'draftNewEmails')
    .addItem('Draft emails for selected rows', 'draftSelectedRows')
    .addItem('Check for duplicates', 'checkDuplicatesFromMenu')
    .addItem('Sync with my Gmail now', 'syncWithGmailFromMenu')
    .addItem('Draft my follow-ups now', 'weeklyFollowUpsFromMenu')
    .addSeparator()
    .addItem('Turn on automatic updates for me', 'installMyTriggers')
    .addItem('Turn off automatic updates for me', 'removeMyTriggers')
    .addSeparator()
    .addItem('Set up this sheet', 'setUpSheet')
    .addItem('Set Claude API key', 'setApiKey')
    .addToUi();
}

function checkDuplicatesFromMenu() {
  var n = checkDuplicates();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    n ? n + ' possible duplicate(s). See the "Duplicate of" column.' : 'No duplicates found.', 'B4P Outreach', 8);
}

function setApiKey() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Claude API key', 'Paste the B4P Claude API key. It is stored in the script\'s properties, not in the sheet.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var key = res.getResponseText().trim();
  if (!key) return;
  PropertiesService.getScriptProperties().setProperty(API_KEY_PROPERTY, key);
  ui.alert('Saved.');
}

/**
 * Each person turns this on for themselves, because the hourly sync and weekly follow-ups
 * read and draft in the Gmail of whoever installed the trigger.
 */
function installMyTriggers() {
  removeMyTriggers();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('syncWithGmail').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('weeklyFollowUps').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  ss.toast('Your sheet rows will sync with your Gmail every hour, and your follow-ups will be drafted every Monday morning.', 'Automatic updates on', 10);
}

function removeMyTriggers() {
  var handlers = ['syncWithGmail', 'weeklyFollowUps'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
}

var DEFAULT_TEMPLATES = [
  ['Clinic first email', 'Free medical supplies for {{Organization}}',
    'Hi {{Contact name}},\n\n' +
    'My name is {{Sender name}} and I\'m with Blueprints for Pangaea, a student nonprofit at the University of Michigan. ' +
    'We collect surplus medical supplies from Michigan Medicine and donate them, at no cost, to clinics like {{Organization}}.\n\n' +
    'You can see what we have right now here: {{Catalog link}}\n' +
    'If anything would help, you can request it here: {{Request link}}\n\n' +
    'Happy to answer any questions.\n\nBest,\n{{Sender name}}\nBlueprints for Pangaea'],
  ['Clinic follow-up', 'Re: Free medical supplies for {{Organization}}',
    'Hi {{Contact name}},\n\nJust following up on my note about free surplus medical supplies for {{Organization}}. ' +
    'Requests take a few minutes: {{Request link}}\n\nBest,\n{{Sender name}}'],
  ['Gala sponsor first email', 'Sponsoring the Blueprints for Pangaea gala',
    'Hi {{Contact name}},\n\n' +
    'I\'m {{Sender name}} from Blueprints for Pangaea, a University of Michigan student nonprofit that sends surplus medical supplies to clinics in Michigan and around the world. ' +
    'We\'re hosting our annual gala and would love for {{Organization}} to be a sponsor.\n\n' +
    'Could I send over our sponsorship tiers?\n\nBest,\n{{Sender name}}\nBlueprints for Pangaea'],
  ['Gala sponsor follow-up', 'Re: Sponsoring the Blueprints for Pangaea gala',
    'Hi {{Contact name}},\n\nFollowing up on sponsoring the B4P gala. I\'d be glad to send details or set up a quick call.\n\nBest,\n{{Sender name}}']
];

/** Creates any missing tabs, headers, dropdowns and defaults. Safe to run again: it never deletes data. */
function setUpSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var outreach = ss.getSheetByName(SHEET_OUTREACH) || ss.insertSheet(SHEET_OUTREACH, 0);
  var lastCol = Math.max(outreach.getLastColumn(), 1);
  var existing = outreach.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(String);
  var missing = COLUMNS.filter(function (c) { return existing.indexOf(c) === -1; });
  if (missing.length) {
    outreach.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  var headers = outreach.getRange(1, 1, 1, outreach.getLastColumn()).getValues()[0].map(String);
  outreach.setFrozenRows(1);
  outreach.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#EEF3FF');

  var rows = Math.max(outreach.getMaxRows() - 1, 1);
  setDropdown_(outreach, headers, 'Type', rows, [TYPES.CLINIC, TYPES.GALA]);
  setDropdown_(outreach, headers, 'Status', rows, Object.keys(STATUS).map(function (k) { return STATUS[k]; }));

  // Shade any row the checker marks as a duplicate.
  var dupCol = headers.indexOf('Duplicate of') + 1;
  if (dupCol > 0) {
    var letter = columnLetter_(dupCol);
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + letter + '2<>""')
      .setBackground('#FDECEA')
      .setRanges([outreach.getRange(2, 1, rows, headers.length)])
      .build();
    var rules = outreach.getConditionalFormatRules().filter(function (r) {
      var c = r.getBooleanCondition();
      return !(c && c.getCriteriaValues().join('').indexOf('$' + letter + '2<>""') !== -1);
    });
    rules.push(rule);
    outreach.setConditionalFormatRules(rules);
  }

  var templates = ss.getSheetByName(SHEET_TEMPLATES);
  if (!templates) {
    templates = ss.insertSheet(SHEET_TEMPLATES);
    templates.getRange(1, 1, 1, 3).setValues([['Name', 'Subject', 'Body']]).setFontWeight('bold');
    templates.getRange(2, 1, DEFAULT_TEMPLATES.length, 3).setValues(DEFAULT_TEMPLATES);
    templates.setColumnWidth(3, 600);
    templates.getRange(2, 3, DEFAULT_TEMPLATES.length, 1).setWrap(true);
  }

  var settings = ss.getSheetByName(SHEET_SETTINGS);
  if (!settings) {
    settings = ss.insertSheet(SHEET_SETTINGS);
    settings.getRange(1, 1, 1, 2).setValues([['Setting', 'Value']]).setFontWeight('bold');
    var defaults = Object.keys(DEFAULT_SETTINGS).map(function (k) { return [k, DEFAULT_SETTINGS[k]]; });
    settings.getRange(2, 1, defaults.length, 2).setValues(defaults);
    settings.setColumnWidth(2, 500);
  }
  ss.toast('Sheet is ready. Next: set the Claude API key, fill in Settings, and edit the Templates.', 'B4P Outreach', 10);
}

function setDropdown_(sheet, headers, name, rows, values) {
  var col = headers.indexOf(name) + 1;
  if (!col) return;
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  sheet.getRange(2, col, rows, 1).setDataValidation(rule);
}

function columnLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
