/**
 * runtime_extract.js
 * Executes obfuscated JS in a Node.js vm sandbox,
 * intercepts the string decoder, and writes a string_map.json.
 *
 * Usage:
 *   node runtime_extract.js <file.js> [decoderName] [arrayName]
 *
 * Examples:
 *   node runtime_extract.js ..\pump\content.entry.js c96YSn JR5NBN
 *   node runtime_extract.js ..\pump\popup.entry.js   GQMH_1F
 */

const vm = require("vm");
const fs = require("fs");
const path = require("path");

const inputFile = process.argv[2];
const decoderHint = process.argv[3]; // optional: known decoder name
const arrayHint = process.argv[4]; // optional: known array name

if (!inputFile) {
  console.error("Usage: node runtime_extract.js <file.js> [decoderName] [arrayName]");
  process.exit(1);
}

const absInput = path.resolve(inputFile);
const baseName = path.basename(absInput, ".js");
const outDir = path.join(__dirname, "output");
const outFile = path.join(outDir, baseName + ".string_map.json");

console.log(`[1] Loading: ${absInput}`);
const code = fs.readFileSync(absInput, "utf8");
console.log(`    Size: ${(code.length / 1024).toFixed(1)} KB`);
function makeProxy(overrides = {}) {
  const fn = function (...args) {
    return makeProxy();
  };
  Object.assign(fn, overrides);
  return new Proxy(fn, {
    get(target, key) {
      if (key === "then") return undefined; // not a thenable
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === Symbol.iterator) return undefined;
      if (key === Symbol.toStringTag) return "Object";
      if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
      return makeProxy();
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
    apply(target, thisArg, args) {
      return makeProxy();
    },
    construct(target, args) {
      return makeProxy();
    },
    has() {
      return true;
    },
    deleteProperty() {
      return true;
    },
  });
}
console.log("[2] Building sandbox...");

const sandbox = {
  Array,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  TypeError,
  RangeError,
  SyntaxError,
  ReferenceError,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Symbol,
  Proxy,
  Reflect,
  Promise,
  JSON,
  Math,
  Date,
  Function,
  BigInt,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  NaN,
  Infinity,
  undefined,
  encodeURIComponent,
  decodeURIComponent,
  encodeURI,
  decodeURI,
  escape,
  unescape,
  setTimeout(fn, delay, ...args) {
    try {
      if (typeof fn === "function") fn(...args);
    } catch (_) {}
    return 0;
  },
  clearTimeout() {},
  setInterval() {
    return 0;
  },
  clearInterval() {},
  queueMicrotask(fn) {
    try {
      if (typeof fn === "function") fn();
    } catch (_) {}
  },
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  console,
  document: makeProxy({
    readyState: "complete",
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => makeProxy({ style: makeProxy() }),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: makeProxy({ style: makeProxy() }),
    head: makeProxy(),
    documentElement: makeProxy({ style: makeProxy() }),
  }),
  navigator: makeProxy({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
    language: "uk-UA",
    languages: ["uk", "ru", "en"],
    onLine: true,
  }),
  location: makeProxy({
    href: "https://naurok.ua/",
    hostname: "naurok.ua",
    pathname: "/",
    protocol: "https:",
    search: "",
    hash: "",
  }),
  history: makeProxy(),
  screen: makeProxy({ width: 1920, height: 1080 }),
  localStorage: makeProxy({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
  sessionStorage: makeProxy({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
  performance: makeProxy({ now: () => Date.now(), mark: () => {}, measure: () => {} }),
  crypto: makeProxy({ getRandomValues: (arr) => arr, randomUUID: () => "mock-uuid" }),
  fetch: () => Promise.resolve(makeProxy({ json: () => Promise.resolve({}) })),
  XMLHttpRequest: function () {
    return makeProxy();
  },
  WebSocket: function () {
    return makeProxy();
  },
  MutationObserver: function () {
    return makeProxy({ observe: () => {}, disconnect: () => {} });
  },
  IntersectionObserver: function () {
    return makeProxy();
  },
  ResizeObserver: function () {
    return makeProxy();
  },
  CustomEvent: function () {
    return makeProxy();
  },
  Event: function () {
    return makeProxy();
  },
  EventTarget: function () {
    return makeProxy();
  },
  Node: makeProxy(),
  Element: makeProxy(),
  HTMLElement: makeProxy(),
  chrome: makeProxy({
    storage: makeProxy({
      local: makeProxy({
        get: (keys, cb) => cb && cb({}),
        set: (items, cb) => cb && cb(),
        remove: (keys, cb) => cb && cb(),
      }),
      sync: makeProxy({
        get: (keys, cb) => cb && cb({}),
        set: (items, cb) => cb && cb(),
      }),
    }),
    runtime: makeProxy({
      id: "mockextensionid123",
      lastError: null,
      getURL: (p) => `chrome-extension://mockextensionid123/${p}`,
      sendMessage: () => {},
      onMessage: makeProxy({ addListener: () => {}, removeListener: () => {} }),
      onConnect: makeProxy({ addListener: () => {} }),
      getManifest: () => ({ version: "1.0.0" }),
    }),
    tabs: makeProxy({
      query: (opts, cb) => cb && cb([]),
      sendMessage: () => {},
      onUpdated: makeProxy({ addListener: () => {} }),
      onActivated: makeProxy({ addListener: () => {} }),
    }),
    scripting: makeProxy({ executeScript: () => Promise.resolve() }),
    action: makeProxy({ setIcon: () => {}, setBadgeText: () => {} }),
    i18n: makeProxy({ getMessage: () => "" }),
  }),
  Telegram: makeProxy(),
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.global = sandbox;
sandbox.top = sandbox;
sandbox.frames = sandbox;

vm.createContext(sandbox);
console.log("[3] Executing in sandbox (timeout: 8s)...");
let execError = null;
try {
  vm.runInContext(code, sandbox, { timeout: 8000 });
  console.log("    Execution completed normally");
} catch (e) {
  execError = e.message.slice(0, 120);
  console.log(`    Execution stopped: ${execError}`);
}
console.log("[4] Detecting decoder and string array...");
const knownBuiltins = new Set([
  "Array", "Object", "String", "Number", "Boolean", "RegExp", "Error",
  "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Proxy", "Reflect",
  "Promise", "JSON", "Math", "Date", "Function", "BigInt", "console",
  "window", "self", "globalThis", "global", "top", "frames",
  "document", "navigator", "location", "history", "screen", "performance",
  "crypto", "fetch", "chrome", "localStorage", "sessionStorage",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "encodeURI", "decodeURI", "escape", "unescape",
  "atob", "btoa", "queueMicrotask", "Telegram", "XMLHttpRequest",
  "WebSocket", "MutationObserver", "IntersectionObserver", "ResizeObserver",
  "CustomEvent", "Event", "EventTarget", "Node", "Element", "HTMLElement",
  "NaN", "Infinity", "undefined", "TypeError", "RangeError", "SyntaxError",
  "ReferenceError",
]);

const runtimeGlobals = Object.keys(sandbox).filter((k) => !knownBuiltins.has(k));
console.log(`    New globals after execution: ${runtimeGlobals.length}`);
let foundArrayName = arrayHint;
let foundArray = null;

if (!foundArrayName) {
  for (const name of runtimeGlobals) {
    const val = sandbox[name];
    if (!Array.isArray(val) || val.length < 50) continue;
    const strCount = val.filter((v) => typeof v === "string").length;
    if (strCount / val.length > 0.3) {
      if (!foundArray || val.length > foundArray.length) {
        foundArrayName = name;
        foundArray = val;
      }
    }
  }
} else {
  foundArray = sandbox[foundArrayName];
}
let foundDecoderName = decoderHint;
let foundDecoder = null;

if (!foundDecoderName) {
  for (const name of runtimeGlobals) {
    const val = sandbox[name];
    if (typeof val !== "function") continue;
    if (!foundArray) break;
    try {
      const testResult = val(foundArray[0]);
      if (typeof testResult === "string" && testResult.length > 0 && testResult.length < 200) {
        foundDecoderName = name;
        foundDecoder = val;
        break;
      }
    } catch (_) {}
  }
} else {
  foundDecoder = sandbox[foundDecoderName];
}

if (!foundArray) {
  console.error(`❌ String array not found. Runtime globals: ${runtimeGlobals.slice(0, 20).join(", ")}`);
  process.exit(1);
}
if (!foundDecoder) {
  console.error(
    `❌ Decoder function not found. Try: node runtime_extract.js <file> <decoderName> <arrayName>`
  );
  console.log(`   Runtime globals: ${runtimeGlobals.slice(0, 30).join(", ")}`);
  process.exit(1);
}

console.log(`    Array: "${foundArrayName}" (${foundArray.length} entries)`);
console.log(`    Decoder: "${foundDecoderName}"`);
console.log("[5] Extracting strings...");

const stringMap = {}; // index → decoded string
let successCount = 0;
let errorCount = 0;

for (let i = 0; i < foundArray.length; i++) {
  try {
    const raw = foundArray[i];
    const decoded = foundDecoder(raw);
    if (typeof decoded === "string") {
      stringMap[i] = decoded;
      successCount++;
    }
  } catch (_) {
    errorCount++;
  }
}

console.log(`    Decoded: ${successCount} strings, ${errorCount} skipped`);
if (successCount > 0) {
  const sample = Object.entries(stringMap).slice(0, 8);
  console.log("    Sample:", sample.map(([i, v]) => `[${i}]="${v}"`).join(", "));
}
const meta = {
  __meta: {
    sourceFile: path.basename(absInput),
    arrayName: foundArrayName,
    decoderName: foundDecoderName,
    arrayLength: foundArray.length,
    decodedCount: successCount,
    generatedAt: new Date().toISOString(),
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ ...meta, ...stringMap }, null, 2));
console.log(`\n✅ Saved: ${outFile}`);
console.log(`   Total strings: ${successCount} / ${foundArray.length}`);
