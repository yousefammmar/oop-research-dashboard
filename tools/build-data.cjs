#!/usr/bin/env node
/**
 * build-data.cjs — turns export folders into what the dashboard (index.html) reads:
 *   <out>/<day>/data.js   the CSVs + summary.txt + notes, AES-256-GCM encrypted (key from the passphrase, PBKDF2)
 *   <out>/index.js        every day that has a data.js, newest first (days already in <out> are kept)
 *
 *   node tools/build-data.cjs --src <dir with YYYY-MM-DD/ folders> --out exports [--notes NOTES.md] --plain
 *   --plain: no encryption, the dashboard opens with no passphrase (anyone with the link sees the data)
 *   otherwise passphrase: env DASHBOARD_PASS, or --pass-file <file>
 *
 * Run by .github/workflows/export.yml on GitHub and by "Export data.command" on Yousef's Mac.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf(n); return i === -1 ? f : args[i + 1]; };
const src = path.resolve(opt('--src', 'export'));
const out = path.resolve(opt('--out', 'exports'));
const read = (f) => (f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const plain = args.includes('--plain');
const pass = plain ? '' : process.env.DASHBOARD_PASS || read(opt('--pass-file')).trim();
if (!plain && !pass) { console.error('build-data: no passphrase (set DASHBOARD_PASS or --pass-file, or pass --plain)'); process.exit(1); }

const FILES = { participants: 'research_participants.csv', sessions: 'research_sessions.csv', attempts: 'research_quiz_attempts.csv', summary: 'summary.txt' };
const ITERATIONS = 300000;
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const js = (day, value) => '(window.EXPORTS = window.EXPORTS || {})[' + JSON.stringify(day) + '] = ' + JSON.stringify(value) + ';\n';

function encrypt(text) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(pass, salt, ITERATIONS, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final(), c.getAuthTag()]); // WebCrypto expects the tag appended
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64'), iterations: ITERATIONS };
}

const notes = read(opt('--notes'));
const srcDays = fs.existsSync(src) ? fs.readdirSync(src).filter((d) => isDay(d) && fs.existsSync(path.join(src, d, FILES.participants))) : [];
srcDays.forEach((d) => {
  const data = { notes };
  Object.keys(FILES).forEach((k) => { data[k] = read(path.join(src, d, FILES[k])); });
  fs.mkdirSync(path.join(out, d), { recursive: true });
  fs.writeFileSync(path.join(out, d, 'data.js'), js(d, plain ? data : { enc: encrypt(JSON.stringify(data)) }));
});
const kept = fs.existsSync(out) ? fs.readdirSync(out).filter((d) => isDay(d) && fs.existsSync(path.join(out, d, 'data.js'))) : [];
const days = [...new Set(srcDays.concat(kept))].sort().reverse();
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.js'), 'window.EXPORT_DAYS = ' + JSON.stringify(days) + ';\n');
console.log('build-data: ' + (plain ? 'wrote (plain) ' : 'encrypted ') + srcDays.length + ' export(s) from ' + src + '; ' + days.length + ' listed in ' + path.join(out, 'index.js'));
