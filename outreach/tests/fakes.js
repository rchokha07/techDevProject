/**
 * In-memory stand-ins for the Google Apps Script services the outreach script uses.
 * Tests run the real Apps Script files against these, so no real sheet, inbox or API is touched.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT_DIR = path.join(__dirname, '..', 'apps-script');

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.cell(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.numRows; }
  getNumColumns() { return this.numCols; }
  getSheet() { return this.sheet; }
}

class FakeSheet {
  constructor(name, data) { this.name = name; this.data = data.map((r) => r.slice()); }
  cell(r, c) { const row = this.data[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ''; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) if (this.data[r - 1].some((v) => v !== '' && v != null)) return r;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => r.length)); }
  getMaxRows() { return Math.max(this.data.length, 100); }
  getRange(row, col, numRows = 1, numCols = 1) { return new FakeRange(this, row, col, numRows, numCols); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  /** Test helper: the row as an object keyed by header. */
  rowObject(r) {
    const headers = this.data[0];
    const obj = {};
    headers.forEach((h, i) => { obj[h] = this.cell(r, i + 1); });
    return obj;
  }
}

class FakeMessage {
  constructor(opts) { Object.assign(this, { draft: false, headers: {}, cc: '' }, opts); }
  getFrom() { return this.from; }
  getTo() { return this.to; }
  getDate() { return this.date; }
  isDraft() { return this.draft; }
  getSubject() { return this.subject; }
  getPlainBody() { return this.body; }
  getHeader(name) { return this.headers[name] || ''; }
}

class FakeThread {
  constructor(id, messages) { this.id = id; this.messages = messages; }
  getId() { return this.id; }
  getMessages() { return this.messages; }
}

/** One person's Gmail. */
class FakeGmail {
  constructor(me, clock) {
    this.me = me;
    this.clock = clock;
    this.drafts = [];   // { id, to, subject, body, threadId }
    this.threads = [];
    this.sentToMe = []; // digest emails
    this.nextId = 1;
  }
  // GmailApp
  createDraft(to, subject, body) {
    const d = { id: 'd' + this.nextId++, to, subject, body, threadId: null };
    this.drafts.push(d);
    return { getId: () => d.id };
  }
  search(query) {
    const to = (query.match(/to:(\S+)/) || [])[1];
    return this.threads.filter((t) => t.messages.some((m) => !m.draft && m.from.includes(this.me) && m.to.toLowerCase().includes(to)));
  }
  getThreadById(id) { return this.threads.find((t) => t.id === id) || null; }
  getAliases() { return []; }
  sendEmail(to, subject, body, options) { this.sentToMe.push({ to, subject, body, options }); }

  // Gmail advanced service: Gmail.Users.Drafts.create
  createApiDraft(resource) {
    const raw = Buffer.from(resource.message.raw, 'base64url').toString('utf8');
    const [head, ...rest] = raw.split('\r\n\r\n');
    const headers = Object.fromEntries(head.split('\r\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
    const d = { id: 'd' + this.nextId++, to: headers.To, subject: headers.Subject, body: rest.join('\r\n\r\n'), threadId: resource.message.threadId, headers };
    this.drafts.push(d);
    return { id: d.id, message: { id: 'm' + d.id, threadId: d.threadId } };
  }

  // Test helpers: what a person or the other side does in Gmail.
  userSendsDraft(draftId) {
    const i = this.drafts.findIndex((d) => d.id === draftId);
    const d = this.drafts.splice(i, 1)[0];
    const msg = new FakeMessage({
      from: 'Rhea <' + this.me + '>', to: d.to, subject: d.subject, body: d.body,
      date: new Date(this.clock.now), headers: { 'Message-ID': '<' + d.id + '@mail.gmail.com>' }
    });
    let thread = d.threadId && this.getThreadById(d.threadId);
    if (!thread) { thread = new FakeThread('t' + this.nextId++, []); this.threads.push(thread); }
    thread.messages.push(msg);
    return thread;
  }
  theyReply(threadId, from, body) {
    const thread = this.getThreadById(threadId);
    thread.messages.push(new FakeMessage({ from, to: this.me, subject: 'Re: hi', body, date: new Date(this.clock.now), headers: { 'Message-ID': '<r' + this.nextId++ + '@x>' } }));
  }
}

/**
 * Builds a sandbox with the real Apps Script code loaded.
 * @param {Object} opts { outreach: 2D array, me, now: Date, websites: {url: html}, claude: (request) => {subject, body} | Error }
 */
function loadScript(opts) {
  const clock = { now: opts.now || new Date('2026-11-02T15:00:00Z') };
  const gmail = new FakeGmail(opts.me || 'rhea@b4p.test', clock);
  const claudeRequests = [];
  const fetched = [];
  const properties = { ANTHROPIC_API_KEY: 'test-key-not-real' };
  const toasts = [];

  const { COLUMNS, DEFAULT_SETTINGS } = require(path.join(SCRIPT_DIR, 'Core.js'));
  const settingsRows = [['Setting', 'Value']].concat(
    Object.entries(Object.assign({}, DEFAULT_SETTINGS, { 'Sender name': 'Rhea' }, opts.settings || {})));
  const sheets = {
    Outreach: new FakeSheet('Outreach', [COLUMNS].concat(opts.outreach || [])),
    Templates: new FakeSheet('Templates', [['Name', 'Subject', 'Body'],
      ['Clinic first email', 'Free supplies for {{Organization}}', 'Hi {{Contact name}}, B4P has free supplies. Request: {{Request link}}'],
      ['Clinic follow-up', 'Re: Free supplies', 'Hi {{Contact name}}, following up.'],
      ['Gala sponsor first email', 'Sponsor our gala', 'Hi {{Contact name}}, would {{Organization}} sponsor our gala?'],
      ['Gala sponsor follow-up', 'Re: Sponsor our gala', 'Hi {{Contact name}}, following up on the gala.']]),
    Settings: new FakeSheet('Settings', settingsRows)
  };
  const spreadsheet = {
    getSheetByName: (n) => sheets[n] || null,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/FAKE_TEST_SHEET/edit',
    toast: (msg, title) => toasts.push({ msg, title }),
    getActiveRange: () => opts.activeRange ? opts.activeRange(sheets) : null
  };

  const sandbox = {
    console,
    Buffer,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush: () => {},
      getUi: () => ({ alert: () => {} })
    },
    GmailApp: gmail,
    Gmail: { Users: { Drafts: { create: (resource, user) => gmail.createApiDraft(resource) } } },
    Session: { getEffectiveUser: () => ({ getEmail: () => gmail.me }), getActiveUser: () => ({ getEmail: () => gmail.me }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => properties[k] || null, setProperty: (k, v) => { properties[k] = v; } }) },
    LockService: { getDocumentLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      sleep: () => {},
      Charset: { UTF_8: 'utf8' },
      base64Encode: (s) => Buffer.from(s, 'utf8').toString('base64'),
      base64EncodeWebSafe: (s) => Buffer.from(s, 'utf8').toString('base64url')
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        fetched.push(url);
        if (url === 'https://api.anthropic.com/v1/messages') {
          const request = JSON.parse(options.payload);
          claudeRequests.push({ request, headers: options.headers });
          const out = opts.claude ? opts.claude(request) : { subject: 'Hello', body: 'Personalized body' };
          if (out instanceof Error) return response(500, { type: 'error', error: { message: out.message } });
          return response(200, {
            type: 'message', role: 'assistant', model: request.model, stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify(out) }]
          });
        }
        const html = (opts.websites || {})[url];
        return html == null ? textResponse(404, 'not found') : textResponse(200, html);
      }
    }
  };
  vm.createContext(sandbox);
  fs.readdirSync(SCRIPT_DIR).filter((f) => f.endsWith('.js')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(SCRIPT_DIR, f), 'utf8'), sandbox, { filename: f });
  });
  // Control the script's clock.
  sandbox.now_ = () => new Date(clock.now);

  return { script: sandbox, sheets, gmail, clock, claudeRequests, fetched, toasts };
}

function response(code, json) { return textResponse(code, JSON.stringify(json)); }
function textResponse(code, text) { return { getResponseCode: () => code, getContentText: () => text }; }

/** Builds an Outreach row array from an object keyed by header. */
function row(fields) {
  const { COLUMNS } = require(path.join(SCRIPT_DIR, 'Core.js'));
  return COLUMNS.map((c) => (fields[c] !== undefined ? fields[c] : ''));
}

module.exports = { loadScript, row };
