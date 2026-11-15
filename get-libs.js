'use strict';
/* Run once on the server (needs internet): node get-libs.js
   Downloads the document viewers into public/vendor so the vault works without internet access. */
const https = require('https'), fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'public', 'vendor'); fs.mkdirSync(dir, { recursive: true });
const base = 'https://cdnjs.cloudflare.com/ajax/libs/';
const libs = { 'jszip.min.js': 'jszip/3.10.1/jszip.min.js', 'xlsx.full.min.js': 'xlsx/0.18.5/xlsx.full.min.js', 'mammoth.browser.min.js': 'mammoth/1.6.0/mammoth.browser.min.js',
  'pdf.min.js': 'pdf.js/3.11.174/pdf.min.js', 'pdf.worker.min.js': 'pdf.js/3.11.174/pdf.worker.min.js', 'pdf-lib.min.js': 'pdf-lib/1.17.1/pdf-lib.min.js' };
function get(url, dest) { return new Promise((resolve, reject) => { https.get(url, res => {
  if (res.statusCode !== 200) { res.resume(); return reject(new Error(url + ' answered ' + res.statusCode)); }
  const ws = fs.createWriteStream(dest); res.pipe(ws); ws.on('finish', resolve); ws.on('error', reject); }).on('error', reject); }); }
(async () => { for (const [name, rel] of Object.entries(libs)) { process.stdout.write('Downloading ' + name + ' … '); await get(base + rel, path.join(dir, name)); console.log('done'); }
  console.log('All viewers saved to public/vendor.'); })().catch(e => { console.error('\nDownload failed: ' + e.message); process.exit(1); });
