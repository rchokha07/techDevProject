# B4P outreach sheet

One Google Sheet for clinic outreach and gala sponsor outreach, replacing the outreach tracker and the agenda doc.

For every row, a script reads the organization's website, has Claude rewrite B4P's template into a personalized email, and saves it to **your Gmail drafts**. You review it and press Send yourself; the script never sends outreach for you. After that, the sheet keeps itself up to date:

| Problem | What the sheet does |
| --- | --- |
| Looking up each org and rewriting the template | Claude reads the org's website and your notes and writes a draft from the template, in your Gmail drafts |
| Updating the tracker by hand | An hourly sync reads your Gmail: when you send, the row becomes **Sent** with the date; when they answer, it becomes **Replied** |
| Contacting someone another member already reached | Every edit is checked against the whole sheet (same name, same email, same website or email domain). Duplicates are shaded red, say who has the original row, and never get a draft |
| Forgetting to follow up | Every Monday, each follow-up that's due (7 days, at most 2 by default) is drafted as a reply in the original Gmail thread, and you get one email listing them |
| Generic emails | Drafts mention specific, real details from the org's site and your Notes column, and Claude is told never to invent facts |

## How a row moves

```
New ──(Draft emails)──▶ Draft ready ──(you send it in Gmail)──▶ Sent ──(7 days, no reply)──▶ Follow-up drafted
                                                                  ▲                                 │
                                                                  └──────(you send the follow-up)───┘
Sent / Follow-up drafted ──(they reply)──▶ Replied ──▶ Confirmed | Not interested   (you set these)
```

You only ever change **Status** by hand for the end states (Confirmed, Not interested, No response, Do not contact) or to reset a row to New.

## The sheet

**Outreach** tab, one row per organization:

| Column | Who fills it |
| --- | --- |
| Type (Clinic / Gala sponsor), Organization, Website, Contact name, Contact email, Location, Notes | You |
| Owner | You, or the script fills in whoever drafts the row first. The sync and follow-ups only touch rows you own, since they read your Gmail |
| Status | Script, except end states |
| Duplicate of, Draft subject, Draft created, First contacted, Last contacted, Follow-ups sent, Next follow-up, Gmail thread, Script log | Script |

**Templates** tab: `Clinic first email`, `Clinic follow-up`, `Gala sponsor first email`, `Gala sponsor follow-up`. Use `{{Column name}}` placeholders, plus `{{Sender name}}`, `{{Request link}}` and `{{Catalog link}}` from Settings. Paste B4P's real templates over the starter ones.

**Settings** tab: follow-up timing, max drafts per run, the Claude model (default `claude-opus-5-5`) and effort, the sender name, the "About B4P" blurb Claude uses, and the request and catalog links.

## Setup (once, about 15 minutes)

1. Create a new Google Sheet (or use a copy of the tracker) and open **Extensions > Apps Script**.
2. Copy every file in [`apps-script/`](apps-script/) into the project, including `appsscript.json` (turn on **Project Settings > Show "appsscript.json"** to see it). Or use [clasp](https://github.com/google/clasp): copy `.clasp.json.example` to `.clasp.json`, put in the script ID, and run `npx @google/clasp push`.
3. Reload the sheet. A **B4P Outreach** menu appears. Run **Set up this sheet** and accept the permissions.
4. Run **Set Claude API key** and paste a key from the [Claude Console](https://platform.claude.com/). It is kept in the script's properties, never in the sheet or this repo.
5. Fill in **Settings** and replace the starter **Templates** with the real ones.
6. Move existing contacts in: paste the outreach tracker rows and the gala sponsors from the agenda doc into the Outreach tab, with Type set, the right Status, and the Owner. Then run **Check for duplicates**.

Each member who sends outreach then runs **Turn on automatic updates for me** once. That installs an hourly Gmail sync and the Monday 9 AM follow-up run in their own account.

## Day to day

1. Add rows (Type, Organization, Website, Contact email, any Notes). If a row turns red, someone already has that org; the Duplicate of column says who.
2. **B4P Outreach > Draft emails for new rows** (or select rows and use **Draft emails for selected rows**). Up to 8 per run, so it stays under Google's 6-minute limit.
3. Open Gmail drafts, edit if needed, send.
4. Mondays: check the "B4P outreach: follow-ups ready" email and send the drafts it lists.

## Notes and limits

- Emails go out from whoever runs the script. If B4P sets up a shared outreach inbox, have that account run it.
- Claude reads only the website's home page. If a site blocks the script, the draft says so in Script log and is written from your Notes instead.
- Each draft is one Claude API call (a few cents or less with the default model and low effort).
- Website text is treated as untrusted; Claude is told to ignore any instructions in it, and every email is reviewed by a person before it's sent.
- Duplicate matching ignores shared domains like gmail.com and umich.edu, so two people at Gmail aren't flagged.

## Code layout

| File | What it does |
| --- | --- |
| `apps-script/Core.js` | Plain logic with no Google services: duplicate matching, follow-up dates, prompt and API request building, response parsing, the digest email. Unit tested |
| `apps-script/Sheet.js` | Reading and writing the three tabs |
| `apps-script/Claude.js` | Calls the Claude Messages API with `UrlFetchApp` and loads websites |
| `apps-script/Drafts.js` | First drafts |
| `apps-script/Sync.js` | Gmail sync: sent, follow-up sent, replied, bounced, next follow-up date |
| `apps-script/FollowUps.js` | Weekly follow-up drafts and the digest email |
| `apps-script/Duplicates.js` | Duplicate check and the `onEdit` warning |
| `apps-script/Menu.js` | Menu, sheet setup, triggers, API key |

## Tests

```
cd outreach
npm test
```

`tests/core.test.js` covers the logic. `tests/flow.test.js` runs the real Apps Script files against an in-memory fake sheet, fake Gmail and fake Claude: drafting, duplicates, claiming, the per-run limit, the send and reply sync, threaded follow-ups and the digest. Tests never touch a real sheet, inbox or the Claude API.
