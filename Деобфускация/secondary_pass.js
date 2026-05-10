/**
 * secondary_pass.js
 * Two-stage workflow:
 *   1. Scan a .final.js (with primary strings already inlined) for
 *      `<secondary>("ARG")` patterns — collects all args.
 *   2. Re-launch browser, hook secondary decoders, replay each arg,
 *      save results.
 *
 * Usage:
 *   node secondary_pass.js <obfuscated.js> <final.js> <secondaryDecoder1> [secondaryDecoder2...]
 *
 * Output:
 *   <baseName>.secondary.json
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const obfFile = process.argv[2];
const finalFile = process.argv[3];
const secondaries = process.argv.slice(4);

if (!obfFile || !finalFile || secondaries.length === 0) {
  console.error(
    "Usage: node secondary_pass.js <obf.js> <final.js> <secondary1> [secondary2...]"
  );
  process.exit(1);
}

const absObf = path.resolve(obfFile);
const absFinal = path.resolve(finalFile);
const baseName = path.basename(absObf, ".js");
const outDir = path.dirname(absFinal);
const outFile = path.join(outDir, baseName + ".secondary.json");

console.log(`[1] Scanning ${path.basename(absFinal)} for secondary args...`);
const finalCode = fs.readFileSync(absFinal, "utf8");

const argsBy = {};
for (const name of secondaries) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped + "\\s*\\)\\s*\\(\\s*\"([^\"]{1,80})\"", "g");
  const set = new Set();
  let m;
  while ((m = re.exec(finalCode))) set.add(m[1]);
  argsBy[name] = [...set];
  console.log(`    ${name}: ${set.size} unique args`);
}

if (Object.values(argsBy).every((a) => a.length === 0)) {
  console.error("No secondary args found.");
  process.exit(1);
}
const code = fs.readFileSync(absObf, "utf8");
const codeJson = JSON.stringify(code);

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<script>
window.chrome = {
  storage: { local:{ get:(k,cb)=>{try{cb&&cb({})}catch(_){}}, set:(v,cb)=>{try{cb&&cb()}catch(_){}}, remove:(k,cb)=>{try{cb&&cb()}catch(_){}} },
             sync: { get:(k,cb)=>{try{cb&&cb({})}catch(_){}}, set:(v,cb)=>{try{cb&&cb()}catch(_){}} }, onChanged:{addListener:()=>{}} },
  runtime:{ id:'abcdefghijklmnopabcdefghijklmnop', lastError:null, getURL:p=>'chrome-extension://abc/'+p,
            sendMessage:()=>{}, onMessage:{addListener:()=>{},removeListener:()=>{}}, onConnect:{addListener:()=>{}},
            getManifest:()=>({version:'3.0'}), connect:()=>({postMessage:()=>{},onMessage:{addListener:()=>{}},onDisconnect:{addListener:()=>{}}}) },
  tabs:{ query:(o,cb)=>{try{cb&&cb([])}catch(_){}}, sendMessage:()=>{}, onUpdated:{addListener:()=>{}}, onActivated:{addListener:()=>{}} },
  scripting:{executeScript:()=>Promise.resolve()}, action:{setIcon:()=>{},setBadgeText:()=>{}}, i18n:{getMessage:()=>''},
};
window.__captured = {};
const decoderNames = ${JSON.stringify(secondaries)};
for (const name of decoderNames) {
  Object.defineProperty(Object.prototype, name, {
    configurable:true,
    set(fn){
      Object.defineProperty(this, name, {value:fn, writable:true, configurable:true});
      if (!window.__captured[name] && typeof fn === 'function') {
        window.__captured[name] = {ctx:this, fn};
        console.log('[hook] caught ' + name);
      }
    },
  });
}
window.__execError = null;
try { eval(${codeJson}); } catch(e) { window.__execError = String(e); console.warn('[runtime] ' + String(e).slice(0,100)); }

const argsBy = ${JSON.stringify(argsBy)};
window.__resultsMap = new Map();
window.__done = false;
(async () => {
  for (const [name, args] of Object.entries(argsBy)) {
    const cap = window.__captured[name];
    if (!cap) { console.warn('[skip] not captured: ' + name); continue; }
    const innerMap = new Map();
    for (const arg of args) {
      let entry;
      try {
        const v = cap.fn.call(cap.ctx, arg);
        const ty = typeof v;
        if (ty === 'function') {
          entry = {t:'function', v:v.toString().slice(0,1500)};
        } else if (ty === 'string') {
          entry = {t:'string', v:v};
        } else if (v == null) {
          entry = {t:String(v)};
        } else if (ty === 'object') {
          let idVal = '[object]';
          try {
            if (v === window) idVal = 'window';
            else if (v === document) idVal = 'document';
            else if (v === window.crypto) idVal = 'crypto';
            else if (v === window.crypto.subtle) idVal = 'crypto.subtle';
            else if (v === window.JSON) idVal = 'JSON';
            else if (v === window.Math) idVal = 'Math';
            else if (v === window.Date) idVal = 'Date';
            else if (v === window.Object) idVal = 'Object';
            else if (v === window.Array) idVal = 'Array';
            else if (v === window.Promise) idVal = 'Promise';
            else if (v === window.chrome) idVal = 'chrome';
            else if (v === window.console) idVal = 'console';
            else if (v === window.localStorage) idVal = 'localStorage';
            else if (v === window.sessionStorage) idVal = 'sessionStorage';
            else if (v === window.navigator) idVal = 'navigator';
            else if (v === window.location) idVal = 'location';
            else if (v.constructor) idVal = '[' + (v.constructor.name || 'Object') + ']';
          } catch(_){}
          entry = {t:'object', v:idVal};
        } else {
          entry = {t:ty, v:String(v).slice(0,200)};
        }
      } catch(e) {
        entry = {t:'error', v:String(e).slice(0,100)};
      }
      innerMap.set(arg, entry);
    }
    window.__resultsMap.set(name, innerMap);
    console.log('[done] ' + name + ': ' + innerMap.size);
  }
  window.__done = true;
})();
</script></body></html>`;

const tmp = path.join(outDir, "__sec_tmp.html");
fs.writeFileSync(tmp, html, "utf8");

(async () => {
  console.log("[2] Launching Chromium...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.startsWith("[")) console.log("  browser:", t);
  });
  page.on("pageerror", (e) =>
    console.warn("  page error:", e.message.slice(0, 100))
  );

  await page.goto(`file:///${tmp.replace(/\\/g, "/")}`);
  console.log("[3] Waiting...");
  try {
    await page.waitForFunction(() => window.__done === true, { timeout: 60000 });
  } catch (_) {
    console.warn("    Timed out");
  }
  const rawEntries = await page.evaluate(() => {
    const m = window.__resultsMap;
    if (!m) return [];
    const out = [];
    m.forEach((innerMap, name) => {
      const inner = [];
      if (innerMap && typeof innerMap.forEach === "function") {
        innerMap.forEach((entry, arg) => { inner.push([arg, entry]); });
      }
      out.push([name, inner]);
    });
    return out;
  });
  console.log(`    Retrieved: ${rawEntries.length} secondary decoders`);
  const finalResults = {};
  for (const [name, inner] of rawEntries) {
    finalResults[name] = Object.fromEntries(inner);
  }
  await browser.close();
  try { fs.unlinkSync(tmp); } catch (_) {}

  fs.writeFileSync(outFile, JSON.stringify(finalResults, null, 2));
  for (const [n, m] of Object.entries(finalResults || {})) {
    const fns = Object.values(m).filter((v) => v.t === "function").length;
    const strs = Object.values(m).filter((v) => v.t === "string").length;
    const objs = Object.values(m).filter((v) => v.t === "object").length;
    console.log(
      `    ${n}: ${Object.keys(m).length} total (${strs} strings, ${fns} functions, ${objs} objects)`
    );
  }
  console.log(`\n✅ Saved: ${outFile}`);
})();
