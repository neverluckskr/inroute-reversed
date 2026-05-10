/**
 * browser_extract.js
 * Loads the obfuscated JS in a real Chromium (via Puppeteer).
 * Intercepts the string decoder the moment it's assigned to any object
 * (using Object.prototype setter trick), then bulk-decodes all strings.
 *
 * Usage:
 *   node browser_extract.js <file.js> <decoderName> <arrayName>
 *
 * Examples:
 *   node browser_extract.js ..\pump\content.entry.js c96YSn JR5NBN
 *   node browser_extract.js ..\pump\popup.entry.js   GQMH_1F
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const inputFile = process.argv[2];
const decoderName = process.argv[3] || "c96YSn";
const arrayName = process.argv[4] || "JR5NBN";

if (!inputFile) {
  console.error("Usage: node browser_extract.js <file.js> [decoderName] [arrayName]");
  process.exit(1);
}

const absInput = path.resolve(inputFile);
const baseName = path.basename(absInput, ".js");
const outDir = path.join(__dirname, "output");
const outFile = path.join(outDir, baseName + ".string_map.json");

console.log(`[1] Loading: ${absInput}`);
const rawCode = fs.readFileSync(absInput, "utf8");
console.log(`    Size: ${(rawCode.length / 1024).toFixed(1)} KB`);
const codeJson = JSON.stringify(rawCode);

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>deob</title></head>
<body>
<script>
window.chrome = {
  storage: {
    local: {
      get:    (k,cb) => { try { cb && cb({}) } catch(_){} },
      set:    (v,cb) => { try { cb && cb()  } catch(_){} },
      remove: (k,cb) => { try { cb && cb()  } catch(_){} },
    },
    sync: {
      get: (k,cb) => { try { cb && cb({}) } catch(_){} },
      set: (v,cb) => { try { cb && cb()  } catch(_){} },
    },
    onChanged: { addListener: ()=>{} },
  },
  runtime: {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    lastError: null,
    getURL:      p  => 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/' + p,
    sendMessage: ()  => {},
    onMessage:   { addListener:()=>{}, removeListener:()=>{} },
    onConnect:   { addListener:()=>{} },
    getManifest: ()  => ({ version:'3.0.0', name:'InRoute' }),
    connect:     ()  => ({
      postMessage:   ()=>{},
      onMessage:     { addListener:()=>{} },
      onDisconnect:  { addListener:()=>{} },
    }),
  },
  tabs: {
    query:       (o,cb) => { try { cb && cb([]) } catch(_){} },
    sendMessage: ()=>{},
    onUpdated:   { addListener:()=>{} },
    onActivated: { addListener:()=>{} },
  },
  scripting: { executeScript: ()=>Promise.resolve() },
  action:     { setIcon:()=>{}, setBadgeText:()=>{}, setBadgeBackgroundColor:()=>{} },
  i18n:       { getMessage: ()=>'' },
  webRequest: {
    onBeforeRequest: { addListener:()=>{} },
    onCompleted:     { addListener:()=>{} },
  },
};
window.__capturedCtx = null;

Object.defineProperty(Object.prototype, ${JSON.stringify(decoderName)}, {
  configurable: true,
  set(fn) {
    Object.defineProperty(this, ${JSON.stringify(decoderName)}, {
      value: fn,
      writable: true,
      configurable: true,
    });
    if (!window.__capturedCtx && typeof fn === 'function') {
      window.__capturedCtx = this;
      console.log('[hook] Caught ${decoderName} on object with keys: ' +
        Object.keys(this).slice(0,10).join(','));
    }
  },
});
window.__execError = null;
try {
  eval(${codeJson});
} catch(e) {
  window.__execError = String(e);
  console.warn('[runtime] Code stopped: ' + String(e).substring(0,120));
}
window.__stringResults  = {};
window.__extractionDone = false;
window.__extractionError = null;

(function() {
  try {
    const ctx = window.__capturedCtx;
    if (!ctx) {
      window.__extractionError = 'decoder_not_captured';
      window.__extractionDone  = true;
      return;
    }

    const dec = ctx[${JSON.stringify(decoderName)}];
    const arr = ctx[${JSON.stringify(arrayName)}];

    if (typeof dec !== 'function') {
      window.__extractionError = 'decoder_not_function: ' + typeof dec;
      window.__extractionDone  = true;
      return;
    }
    if (!Array.isArray(arr)) {
      const arrKey = Object.keys(ctx).find(k => Array.isArray(ctx[k]) && ctx[k].length > 50);
      if (!arrKey) {
        window.__extractionError = 'array_not_found on ctx keys: ' + Object.keys(ctx).slice(0,15).join(',');
        window.__extractionDone  = true;
        return;
      }
      console.log('[extract] Array auto-detected as: ' + arrKey);
      window.__detectedArrayName = arrKey;
    }

    const theArray = arr || ctx[window.__detectedArrayName];
    console.log('[extract] Array length: ' + theArray.length);

    const map = {};
    let ok = 0;
    for (let i = 0; i < theArray.length; i++) {
      try {
        const v = dec(theArray[i]);
        if (typeof v === 'string') { map[i] = v; ok++; }
      } catch(_) {}
    }

    window.__stringResults  = map;
    window.__extractionDone = true;
    console.log('[extract] Done: ' + ok + ' / ' + theArray.length + ' strings decoded');
    const sample = Object.entries(map).slice(0, 8).map(([i,v]) => i+'="'+v+'"').join(', ');
    console.log('[extract] Sample: ' + sample);
  } catch(ex) {
    window.__extractionError = String(ex);
    window.__extractionDone  = true;
    console.error('[extract] Fatal: ' + String(ex));
  }
})();
</script>
</body>
</html>`;
const tmpHtml = path.join(outDir, "__browser_extract_tmp.html");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(tmpHtml, html, "utf8");
(async () => {
  console.log("[2] Launching Chromium...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      "--allow-file-access-from-files",
    ],
  });

  const page = await browser.newPage();
  page.on("console", (msg) => {
    const txt = msg.text();
    if (txt.startsWith("[")) console.log("  browser:", txt);
  });
  page.on("pageerror", (err) =>
    console.warn("  page error:", err.message.slice(0, 120))
  );

  console.log("[3] Executing code in browser...");
  await page.goto(`file:///${tmpHtml.replace(/\\/g, "/")}`);
  console.log("[4] Waiting for extraction...");
  try {
    await page.waitForFunction(() => window.__extractionDone === true, {
      timeout: 20000,
    });
  } catch (_) {
    console.warn("    Timed out waiting for extraction");
  }

  const result = await page.evaluate(() => ({
    done: window.__extractionDone,
    error: window.__extractionError,
    execError: window.__execError,
    captured: !!window.__capturedCtx,
    map: window.__stringResults,
    mapSize: Object.keys(window.__stringResults || {}).length,
  }));

  await browser.close();
  try { fs.unlinkSync(tmpHtml); } catch (_) {}

  console.log("[5] Results:");
  if (result.execError)
    console.log(`    Exec error: ${result.execError.slice(0, 120)}`);
  if (result.error)
    console.log(`    Extract error: ${result.error}`);
  console.log(`    Decoder captured: ${result.captured}`);
  console.log(`    Strings decoded: ${result.mapSize}`);

  if (result.mapSize === 0) {
    console.error("\n❌ No strings extracted.");
    process.exit(1);
  }
  const sample = Object.entries(result.map).slice(0, 10);
  console.log(
    "    Sample:",
    sample.map(([i, v]) => `[${i}]="${v}"`).join(", ")
  );
  const output = {
    __meta: {
      sourceFile: path.basename(absInput),
      arrayName,
      decoderName,
      decodedCount: result.mapSize,
      generatedAt: new Date().toISOString(),
    },
    ...result.map,
  };
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\n✅ Saved: ${outFile} (${result.mapSize} strings)`);
})();
