/**
 * Claude.js: calls the Claude Messages API and loads websites.
 *
 * Apps Script has no Anthropic SDK, so this uses UrlFetchApp against the REST API.
 * The API key lives in Script Properties (B4P Outreach > Set Claude API key), never in the sheet or repo.
 */

var CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_API_VERSION = '2026-10-21';
var CLAUDE_BETAS = ['server-side-fallback-2026-07-01'];
var API_KEY_PROPERTY = 'ANTHROPIC_API_KEY';

function getApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
  if (!key) throw new Error('No Claude API key yet. Run B4P Outreach > Set Claude API key.');
  return key;
}

/** Asks Claude for a draft. @return {{subject: string, body: string}} */
function draftWithClaude_(settings, promptText) {
  var request = buildClaudeRequest(settings, promptText);
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getApiKey_(),
      'anthropic-version': CLAUDE_API_VERSION,
      'anthropic-beta': CLAUDE_BETAS.join(',')
    },
    payload: JSON.stringify(request),
    muteHttpExceptions: true
  };
  var lastError;
  for (var attempt = 0; attempt < 3; attempt++) {
    var res = UrlFetchApp.fetch(CLAUDE_URL, options);
    var code = res.getResponseCode();
    var body;
    try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
    // 429 (rate limit), 529 (overloaded) and 5xx are worth a retry; 4xx are not.
    if (code === 429 || code >= 500) {
      lastError = new Error('Claude API ' + code + ': ' + ((body && body.error && body.error.message) || 'busy'));
      Utilities.sleep(2000 * Math.pow(2, attempt));
      continue;
    }
    if (code >= 400) {
      throw new Error('Claude API ' + code + ': ' + ((body && body.error && body.error.message) || res.getContentText().slice(0, 200)));
    }
    return parseClaudeResponse(body);
  }
  throw lastError;
}

/** Visible text of a website's home page, or '' if it cannot be loaded. */
function fetchWebsiteText_(url) {
  if (!url) return '';
  var full = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  try {
    var res = UrlFetchApp.fetch(full, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; B4P-Outreach/1.0)' }
    });
    if (res.getResponseCode() >= 400) return '';
    return htmlToText(res.getContentText(), 6000);
  } catch (e) {
    return '';
  }
}
