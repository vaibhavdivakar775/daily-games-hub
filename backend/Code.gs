// Daily Games Hub — leaderboard backend (Google Apps Script, free).
// Setup: see README.md → "Turn on the shared leaderboard".
// Stores one row per (group, name, date, game) in a sheet called "results".

const SHEET = 'results';
const COLS = ['group', 'name', 'date', 'game', 'value', 'label', 'puzzle', 'ts'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(COLS);
    sh.getRange('A:H').setNumberFormat('@'); // keep dates as plain text
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function norm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v);
}

function findRow_(data, r) {
  for (let i = 1; i < data.length; i++) {
    const d = data[i];
    if (String(d[0]).toLowerCase() === String(r.group).toLowerCase() &&
        String(d[1]).toLowerCase() === String(r.name).toLowerCase() &&
        norm_(d[2]) === r.date && d[3] === r.game) return i + 1; // 1-based sheet row
  }
  return -1;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    const r = body.row;
    const sh = sheet_();
    const data = sh.getDataRange().getValues();
    const at = findRow_(data, r);
    if (body.action === 'remove') {
      if (at > 0) sh.deleteRow(at);
    } else {
      const values = [[r.group, r.name, r.date, r.game, r.value, r.label, r.puzzle || '', r.ts || Date.now()]];
      if (at > 0) sh.getRange(at, 1, 1, COLS.length).setValues(values);
      else sh.getRange(sh.getLastRow() + 1, 1, 1, COLS.length).setNumberFormat('@').setValues(values);
    }
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const group = String(e.parameter.group || '').toLowerCase();
  const from = e.parameter.from || '0000-00-00';
  const to = e.parameter.to || '9999-99-99';
  const data = sheet_().getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const d = data[i];
    const date = norm_(d[2]);
    if (String(d[0]).toLowerCase() !== group || date < from || date > to) continue;
    rows.push({ group: d[0], name: d[1], date: date, game: d[3], value: Number(d[4]), label: String(d[5]), puzzle: String(d[6]) });
  }
  return json_({ rows: rows });
}
