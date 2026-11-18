/**
 * End-to-end runs of the real Apps Script code against a fake sheet, fake Gmail and fake Claude.
 * Nothing here touches a real B4P sheet, inbox or the Claude API.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, row } = require('./fakes');

const ME = 'rhea@b4p.test';

function setup(extra = {}) {
  return loadScript(Object.assign({
    me: ME,
    now: new Date('2026-11-02T15:00:00Z'),
    settings: { 'Request link': 'https://request.example/form' },
    websites: { 'https://hopeclinic.example': '<h1>Hope Clinic</h1><p>Free pediatric care in Ypsilanti.</p>' },
    claude: (req) => ({
      subject: 'Supplies for Hope Clinic',
      body: req.messages[0].content.includes('<email_kind>Follow-up') ? 'Just checking in about supplies.' : 'Hi Jo, saw your pediatric care work...'
    }),
    outreach: [
      row({ Type: 'Clinic', Organization: 'Hope Clinic', Website: 'hopeclinic.example', 'Contact name': 'Jo', 'Contact email': 'jo@hopeclinic.example', Status: 'New' }),
      row({ Type: 'Clinic', Organization: 'The Hope Clinic', 'Contact email': 'info@hopeclinic.example', Status: 'New' }),
      row({ Type: 'Clinic', Organization: 'Maya\'s Clinic', 'Contact email': 'x@mayas.example', Owner: 'maya@b4p.test', Status: 'New' }),
      row({ Type: 'Gala sponsor', Organization: 'Acme Bank', 'Contact email': 'giving@acme.example', Status: 'Replied', Owner: ME })
    ]
  }, extra));
}

test('drafting: one Gmail draft per eligible row, duplicates and other owners skipped, sheet updated', () => {
  const t = setup();
  const result = t.script.runFirstDrafts_();
  assert.deepEqual({ ...result }, { drafted: 1, failed: 0, skippedDuplicates: 1, remaining: 0 });

  assert.equal(t.gmail.drafts.length, 1);
  assert.equal(t.gmail.drafts[0].to, 'jo@hopeclinic.example');
  assert.equal(t.gmail.drafts[0].subject, 'Supplies for Hope Clinic');
  assert.equal(t.gmail.sentToMe.length, 0, 'nothing is sent');

  const hope = t.sheets.Outreach.rowObject(2);
  assert.equal(hope.Status, 'Draft ready');
  assert.equal(hope.Owner, ME, 'unclaimed row is claimed by whoever drafts it');
  assert.ok(hope['Draft created'] instanceof Date);
  assert.match(hope['Script log'], /Draft saved/);

  const dup = t.sheets.Outreach.rowObject(3);
  assert.equal(dup.Status, 'New');
  assert.equal(dup['Duplicate of'], 'Row 2: same organization name');

  assert.equal(t.sheets.Outreach.rowObject(4).Status, 'New', "Maya's row is left alone");

  // The prompt had the website, the filled template and the request link.
  const { request, headers } = t.claudeRequests[0];
  assert.equal(headers['x-api-key'], 'test-key-not-real');
  assert.match(request.messages[0].content, /Free pediatric care in Ypsilanti/);
  assert.match(request.messages[0].content, /Subject: Free supplies for Hope Clinic/);
  assert.match(request.messages[0].content, /Request: https:\/\/request.example\/form/);
});

test('drafting: a Claude error is logged on the row and the row stays New', () => {
  const t = setup({ claude: () => new Error('invalid x-api-key') });
  const result = t.script.runFirstDrafts_();
  assert.equal(result.failed, 1);
  assert.equal(t.gmail.drafts.length, 0);
  const hope = t.sheets.Outreach.rowObject(2);
  assert.equal(hope.Status, 'New');
  assert.match(hope['Script log'], /Draft failed: Claude API 500: invalid x-api-key/);
});

test('drafting respects the per-run limit', () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(row({ Type: 'Clinic', Organization: 'Clinic ' + i, 'Contact email': 'c' + i + '@c' + i + '.example' }));
  const t = setup({ outreach: rows, settings: { 'Max drafts per run': 3 } });
  const result = t.script.runFirstDrafts_();
  assert.equal(result.drafted, 3);
  assert.equal(result.remaining, 2);
});

test('sync: sending the draft marks the row Sent with dates, then a reply marks it Replied', () => {
  const t = setup();
  t.script.runFirstDrafts_();

  t.clock.now = new Date('2026-11-03T14:00:00Z');
  const thread = t.gmail.userSendsDraft(t.gmail.drafts[0].id);
  t.clock.now = new Date('2026-11-03T15:00:00Z');
  const counts = t.script.syncWithGmail();
  assert.equal(counts.sent, 1);

  let hope = t.sheets.Outreach.rowObject(2);
  assert.equal(hope.Status, 'Sent');
  assert.equal(hope['Gmail thread'], thread.getId());
  assert.equal(hope['First contacted'].toISOString(), '2026-11-03T14:00:00.000Z');
  assert.equal(hope['Last contacted'].toISOString(), '2026-11-03T14:00:00.000Z');
  assert.equal(t.script.formatDate(hope['Next follow-up']), '2026-11-10');

  t.clock.now = new Date('2026-11-05T10:00:00Z');
  t.gmail.theyReply(thread.getId(), 'Jo <jo@hopeclinic.example>', 'Yes please!');
  assert.equal(t.script.syncWithGmail().replied, 1);
  hope = t.sheets.Outreach.rowObject(2);
  assert.equal(hope.Status, 'Replied');
  assert.equal(hope['Next follow-up'], '');
});

test('weekly follow-ups: drafts a threaded reply for due rows and emails the list; sending it bumps the count', () => {
  const t = setup();
  t.script.runFirstDrafts_();
  t.clock.now = new Date('2026-11-03T14:00:00Z');
  const thread = t.gmail.userSendsDraft(t.gmail.drafts[0].id);
  t.script.syncWithGmail();

  // Not due yet on day 6.
  t.clock.now = new Date('2026-11-09T14:00:00Z');
  assert.equal(t.script.weeklyFollowUps().drafted, 0);
  assert.equal(t.gmail.sentToMe.length, 0, 'no email when nothing is due');

  // Due on day 7.
  t.clock.now = new Date('2026-11-10T14:00:00Z');
  const r = t.script.weeklyFollowUps();
  assert.equal(r.drafted, 1);
  const followUp = t.gmail.drafts[0];
  assert.equal(followUp.threadId, thread.getId());
  assert.equal(followUp.to, 'jo@hopeclinic.example');
  assert.equal(followUp.subject, 'Re: Supplies for Hope Clinic');
  assert.equal(followUp.headers['In-Reply-To'], thread.getMessages()[0].getHeader('Message-ID'));
  assert.equal(followUp.body, 'Just checking in about supplies.');
  assert.equal(t.sheets.Outreach.rowObject(2).Status, 'Follow-up drafted');

  const followPrompt = t.claudeRequests[t.claudeRequests.length - 1].request.messages[0].content;
  assert.match(followPrompt, /<previous_email>\nSubject: Supplies for Hope Clinic/);

  assert.equal(t.gmail.sentToMe.length, 1);
  const digest = t.gmail.sentToMe[0];
  assert.equal(digest.to, ME);
  assert.match(digest.subject, /1 follow-up/);
  assert.match(digest.options.htmlBody, /Hope Clinic/);
  assert.match(digest.options.htmlBody, /FAKE_TEST_SHEET/);

  // Running again the same week does not draft a second follow-up.
  assert.equal(t.script.weeklyFollowUps().drafted, 0);

  // Rhea sends the follow-up.
  t.clock.now = new Date('2026-11-11T09:00:00Z');
  t.gmail.userSendsDraft(followUp.id);
  t.script.syncWithGmail();
  const hope = t.sheets.Outreach.rowObject(2);
  assert.equal(hope.Status, 'Sent');
  assert.equal(hope['Follow-ups sent'], 1);
  assert.equal(hope['Last contacted'].toISOString(), '2026-11-11T09:00:00.000Z');
  assert.equal(t.script.formatDate(hope['Next follow-up']), '2026-11-18');
});

test('onEdit flags a duplicate as soon as someone types it and shows a warning', () => {
  const t = setup();
  const sheet = t.sheets.Outreach;
  const orgCol = sheet.data[0].indexOf('Organization') + 1;
  sheet.set(6, orgCol, 'HOPE CLINIC');
  t.script.onEdit({ range: sheet.getRange(6, orgCol) });
  assert.equal(sheet.rowObject(6)['Duplicate of'], 'Row 2: same organization name');
  assert.match(t.toasts[0].msg, /already in the sheet/);
});
