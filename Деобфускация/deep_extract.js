/**
 * deep_extract.js
 * Comprehensive runtime analysis: hooks every decoder, Function ctor,
 * eval, crypto.subtle, fetch, XHR, WebSocket — runs the obfuscated code
 * in real Chromium, dumps everything to JSON.
 *
 * Usage:
 *   node deep_extract.js <file.js> <decoderName> <arrayName> [secondaryDecoders...]
 *
 * Examples:
 *   node deep_extract.js ..\pump\content.entry.js c96YSn JR5NBN qFNLim0 OsnYUr1
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const inputFile = process.argv[2];
const decoderName = process.argv[3] || "c96YSn";
const arrayName = process.argv[4] || "JR5NBN";
const extraDecoders = process.argv.slice(5); // ["qFNLim0", "OsnYUr1", ...]

if (!inputFile) {
  console.error(
    "Usage: node deep_extract.js <file.js> <decoder> <array> [secondaryDecoders...]"
  );
  process.exit(1);
}

const absInput = path.resolve(inputFile);
const baseName = path.basename(absInput, ".js");
const outDir = path.join(__dirname, "output");
fs.mkdirSync(outDir, { recursive: true });

console.log(`[1] Loading: ${absInput}`);
const rawCode = fs.readFileSync(absInput, "utf8");
console.log(`    Size: ${(rawCode.length / 1024).toFixed(1)} KB`);
console.log(
  `    Decoder: ${decoderName}, Array: ${arrayName}, Secondary: [${extraDecoders.join(
    ", "
  )}]`
);

const codeJson = JSON.stringify(rawCode);
const decodersAll = [decoderName, ...extraDecoders];
const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<script>
window.chrome = {
  storage: {
    local: { get:(k,cb)=>{try{cb&&cb({})}catch(_){}}, set:(v,cb)=>{try{cb&&cb()}catch(_){}}, remove:(k,cb)=>{try{cb&&cb()}catch(_){}} },
    sync:  { get:(k,cb)=>{try{cb&&cb({})}catch(_){}}, set:(v,cb)=>{try{cb&&cb()}catch(_){}} },
    onChanged:{ addListener:()=>{} },
  },
  runtime: {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    lastError: null,
    getURL: p => 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'+p,
    sendMessage: ()=>{},
    onMessage:  { addListener:()=>{}, removeListener:()=>{} },
    onConnect:  { addListener:()=>{} },
    getManifest:()=> ({version:'3.0.0', name:'InRoute'}),
    connect:    ()=> ({postMessage:()=>{}, onMessage:{addListener:()=>{}}, onDisconnect:{addListener:()=>{}}}),
  },
  tabs: {
    query:(o,cb)=>{try{cb&&cb([])}catch(_){}},
    sendMessage:()=>{},
    onUpdated:  { addListener:()=>{} },
    onActivated:{ addListener:()=>{} },
  },
  scripting: { executeScript: ()=>Promise.resolve() },
  action:    { setIcon:()=>{}, setBadgeText:()=>{}, setBadgeBackgroundColor:()=>{} },
  i18n:      { getMessage:()=>'' },
};
window.__capture = {
  contexts:    {},   // decoderName -> ctx object
  decoders:    {},   // decoderName -> fn
  funcCtorCalls: [], // [{args, source, retString}]
  evalCalls:     [], // [code]
  cryptoCalls:   [], // [{op, args}]
  fetchCalls:    [], // [{url, opts}]
  xhrCalls:      [], // [{method, url, headers, body}]
  wsCalls:       [], // [url]
  decoderArgs: {},   // decoderName -> Set of seen args (deduped)
  errors:      [],
};
const decoderNames = ${JSON.stringify(decodersAll)};
for (const name of decoderNames) {
  Object.defineProperty(Object.prototype, name, {
    configurable: true,
    set(fn) {
      Object.defineProperty(this, name, {value:fn, writable:true, configurable:true});
      if (!window.__capture.contexts[name] && typeof fn === 'function') {
        window.__capture.contexts[name] = this;
        window.__capture.decoders[name] = fn;
        console.log('[hook] caught ' + name);
      }
    },
  });
}
const _OrigFunction = Function;
window.Function = new Proxy(_OrigFunction, {
  construct(target, args) {
    try {
      const src = args.join(',');
      window.__capture.funcCtorCalls.push({
        args: args.map(a => String(a).slice(0, 500)),
        sourceLen: src.length,
      });
    } catch(_){}
    return Reflect.construct(target, args);
  },
  apply(target, thisArg, args) {
    return Reflect.apply(target, thisArg, args);
  },
});
const _origEval = window.eval;
window.eval = function(code) {
  try {
    if (typeof code === 'string' && code.length > 0) {
      window.__capture.evalCalls.push(String(code).slice(0, 1000));
    }
  } catch(_){}
  return _origEval.call(this, code);
};
if (window.crypto && window.crypto.subtle) {
  const subtle = window.crypto.subtle;
  const ops = ['importKey','exportKey','generateKey','deriveKey','deriveBits',
               'encrypt','decrypt','sign','verify','digest','wrapKey','unwrapKey'];
  for (const op of ops) {
    if (typeof subtle[op] !== 'function') continue;
    const orig = subtle[op].bind(subtle);
    subtle[op] = function(...args) {
      try {
        window.__capture.cryptoCalls.push({
          op,
          argSummary: args.map(a => {
            if (a == null) return String(a);
            if (typeof a === 'string') return a.slice(0,100);
            if (a instanceof ArrayBuffer || ArrayBuffer.isView(a))
              return 'bytes(' + (a.byteLength||a.buffer?.byteLength||0) + ')';
            try { return JSON.stringify(a).slice(0,200); } catch(_) { return typeof a; }
          }),
        });
      } catch(_){}
      return orig(...args);
    };
  }
}
const _origFetch = window.fetch;
window.fetch = function(url, opts) {
  try {
    window.__capture.fetchCalls.push({
      url: String(url).slice(0, 500),
      method: (opts && opts.method) || 'GET',
      headers: opts && opts.headers ? JSON.parse(JSON.stringify(opts.headers||{})) : {},
      bodyPreview: opts && opts.body ? String(opts.body).slice(0, 500) : null,
    });
  } catch(_){}
  if (_origFetch) return _origFetch.call(this, url, opts);
  return Promise.resolve({ json: ()=>Promise.resolve({}), text:()=>Promise.resolve('') });
};

const _OrigXHR = window.XMLHttpRequest;
window.XMLHttpRequest = function() {
  const xhr = new _OrigXHR();
  const log = { method:'', url:'', headers:{}, body:null };
  const _open = xhr.open.bind(xhr);
  xhr.open = function(method, url) {
    log.method = method; log.url = String(url).slice(0,500);
    return _open.apply(xhr, arguments);
  };
  const _setReq = xhr.setRequestHeader.bind(xhr);
  xhr.setRequestHeader = function(k, v) {
    log.headers[k] = String(v).slice(0,200);
    return _setReq(k, v);
  };
  const _send = xhr.send.bind(xhr);
  xhr.send = function(body) {
    log.body = body ? String(body).slice(0,500) : null;
    window.__capture.xhrCalls.push(log);
    return _send(body);
  };
  return xhr;
};

const _OrigWS = window.WebSocket;
if (_OrigWS) {
  window.WebSocket = function(url, ...rest) {
    try { window.__capture.wsCalls.push(String(url).slice(0,500)); } catch(_){}
    return new _OrigWS(url, ...rest);
  };
}
window.__execError = null;
try {
  eval(${codeJson});
  console.log('[runtime] code executed');
} catch(e) {
  window.__execError = String(e);
  console.warn('[runtime] code stopped: ' + String(e).slice(0,120));
}
window.__extractionDone = false;
window.__results = null;

(async function extract() {
  try {
    const cap = window.__capture;
    const primary = cap.decoders[${JSON.stringify(decoderName)}];
    const primaryCtx = cap.contexts[${JSON.stringify(decoderName)}];

    const out = {
      meta: {
        sourceFile: ${JSON.stringify(path.basename(absInput))},
        decoderName: ${JSON.stringify(decoderName)},
        arrayName: ${JSON.stringify(arrayName)},
        secondaryDecoders: ${JSON.stringify(extraDecoders)},
        execError: window.__execError,
        generatedAt: new Date().toISOString(),
      },
      primaryArray: null,         // full JR5NBN dump
      primaryDirect: {},          // dec(n) for n = 0..4000  → {type, value}
      primaryViaArray: {},        // dec(arr[n]) for n in array → {type, value}
      secondary: {},              // {decoderName: {arg: result}}
      funcCtorCalls: cap.funcCtorCalls,
      evalCalls: cap.evalCalls,
      cryptoCalls: cap.cryptoCalls,
      fetchCalls: cap.fetchCalls,
      xhrCalls: cap.xhrCalls,
      wsCalls: cap.wsCalls,
    };
    if (primaryCtx) {
      const arr = primaryCtx[${JSON.stringify(arrayName)}];
      if (Array.isArray(arr)) {
        console.log('[dump] primaryArray length: ' + arr.length);
        out.primaryArray = arr.map(v => {
          if (v == null) return {t:'null'};
          const ty = typeof v;
          if (ty === 'string') return {t:'string', v:v};
          if (ty === 'number') return {t:'number', v:v};
          if (ty === 'boolean') return {t:'boolean', v:v};
          if (ty === 'function') return {t:'function', v:v.toString().slice(0,500)};
          try { return {t:ty, v:JSON.stringify(v).slice(0,200)}; }
          catch(_) { return {t:ty, v:'[unserializable]'}; }
        });
      }
    }
    if (primary) {
      console.log('[extract] running dec(0..4000) ...');
      let okStr = 0, okFn = 0, okOther = 0;
      for (let n = 0; n < 4000; n++) {
        try {
          const v = primary(n);
          const ty = typeof v;
          if (ty === 'string') {
            out.primaryDirect[n] = {t:'string', v};
            okStr++;
          } else if (ty === 'function') {
            out.primaryDirect[n] = {t:'function', v: v.toString().slice(0, 800)};
            okFn++;
          } else if (v != null) {
            try { out.primaryDirect[n] = {t:ty, v:JSON.stringify(v).slice(0,200)}; }
            catch(_) { out.primaryDirect[n] = {t:ty, v:String(v).slice(0,200)}; }
            okOther++;
          }
        } catch(_){}
      }
      console.log('[extract] direct: ' + okStr + ' strings, ' + okFn + ' fns, ' + okOther + ' other');
      if (out.primaryArray) {
        const arr = primaryCtx[${JSON.stringify(arrayName)}];
        for (let i = 0; i < arr.length; i++) {
          try {
            const v = primary(arr[i]);
            const ty = typeof v;
            if (ty === 'string') out.primaryViaArray[i] = {t:'string', v};
            else if (ty === 'function') out.primaryViaArray[i] = {t:'function', v:v.toString().slice(0,800)};
            else if (v != null) out.primaryViaArray[i] = {t:ty, v:String(v).slice(0,200)};
          } catch(_){}
        }
        console.log('[extract] via-array: ' + Object.keys(out.primaryViaArray).length);
      }
    }
    for (const name of ${JSON.stringify(extraDecoders)}) {
      const fn = cap.decoders[name];
      const ctx = cap.contexts[name];
      if (!fn) { console.warn('[secondary] not captured: ' + name); continue; }
      console.log('[secondary] scanning args for ' + name + ' ...');
      const argRegex = new RegExp(name.replace(/[$.]/g,'\\\\$&') + '\\\\)\\\\("([^"]{1,40})"', 'g');
      const seenArgs = new Set();
      let m;
      const codeText = ${codeJson};
      while ((m = argRegex.exec(codeText))) seenArgs.add(m[1]);
      console.log('[secondary] ' + name + ' unique args from source: ' + seenArgs.size);

      const map = {};
      for (const arg of seenArgs) {
        try {
          const v = fn.call(ctx, arg);
          const ty = typeof v;
          if (ty === 'function') map[arg] = {t:'function', v:v.toString().slice(0,800)};
          else if (ty === 'string') map[arg] = {t:'string', v};
          else if (v != null) {
            try { map[arg] = {t:ty, v:JSON.stringify(v).slice(0,200)}; }
            catch(_) { map[arg] = {t:ty, v:String(v).slice(0,200)}; }
          } else map[arg] = {t:String(v)};
        } catch(_){}
      }
      out.secondary[name] = map;
      console.log('[secondary] ' + name + ' resolved: ' + Object.keys(map).length);
    }

    window.__results = out;
    window.__extractionDone = true;
    console.log('[done] extraction complete');
  } catch(ex) {
    window.__execError = (window.__execError||'') + ' | extract: ' + String(ex);
    window.__extractionDone = true;
    console.error('[fatal] ' + ex);
  }
})();
</script>
</body></html>`;
const tmpHtml = path.join(outDir, "__deep_extract_tmp.html");
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

  console.log("[3] Executing in browser...");
  await page.goto(`file:///${tmpHtml.replace(/\\/g, "/")}`);

  console.log("[4] Waiting for extraction (max 60s)...");
  try {
    await page.waitForFunction(() => window.__extractionDone === true, {
      timeout: 60000,
    });
  } catch (_) {
    console.warn("    Timed out");
  }

  const results = await page.evaluate(() => window.__results);
  await browser.close();
  try { fs.unlinkSync(tmpHtml); } catch (_) {}

  if (!results) {
    console.error("❌ No results");
    process.exit(1);
  }

  const outFile = path.join(outDir, baseName + ".deep.json");
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log("\n[5] Summary:");
  console.log(`    primary array entries:    ${results.primaryArray ? results.primaryArray.length : 0}`);
  console.log(`    primary direct hits:      ${Object.keys(results.primaryDirect).length}`);
  console.log(`    primary via-array hits:   ${Object.keys(results.primaryViaArray).length}`);
  for (const [name, map] of Object.entries(results.secondary)) {
    console.log(`    secondary ${name}: ${Object.keys(map).length} resolved`);
  }
  console.log(`    Function() ctor calls:    ${results.funcCtorCalls.length}`);
  console.log(`    eval() calls:             ${results.evalCalls.length}`);
  console.log(`    crypto.subtle calls:      ${results.cryptoCalls.length}`);
  console.log(`    fetch() calls:            ${results.fetchCalls.length}`);
  console.log(`    XHR calls:                ${results.xhrCalls.length}`);
  console.log(`    WebSocket calls:          ${results.wsCalls.length}`);
  console.log(`\n✅ Saved: ${outFile}`);
  console.log(`   Size: ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
})();
