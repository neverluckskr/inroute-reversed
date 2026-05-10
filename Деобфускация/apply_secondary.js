/**
 * apply_secondary.js
 * Replaces secondary-decoder calls with the actual global identifiers.
 *   (1, OsnYUr1)("xkTDz84")    → fetch
 *   (1, OsnYUr1)("o59juPu")    → chrome
 *   (1, OsnYUr1)("ScolMkJ")    → Error
 *   (1, qFNLim0)("kEeHmw")     → "<inlined string>"  (when result is string)
 *
 * For function/object returns, we emit a bare Identifier with the global name.
 * For string returns, we emit a StringLiteral.
 *
 * Usage:
 *   node apply_secondary.js <secondary.json> <final.js>
 */

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const prettier = require("prettier");

const secFile = process.argv[2];
const finalFile = process.argv[3];

if (!secFile || !finalFile) {
  console.error("Usage: node apply_secondary.js <secondary.json> <final.js>");
  process.exit(1);
}

const sec = JSON.parse(fs.readFileSync(path.resolve(secFile), "utf8"));
console.log(`[1] Secondary entries:`);
for (const [n, m] of Object.entries(sec)) {
  console.log(`    ${n}: ${Object.keys(m).length} entries`);
}
function objectVtoName(v) {
  if (!v) return null;
  const direct = [
    "window","document","crypto","JSON","Math","Date","Object","Array",
    "Promise","chrome","console","localStorage","sessionStorage",
    "navigator","location",
  ];
  if (direct.includes(v)) return v;
  const m = v.match(/^\[([A-Za-z][A-Za-z0-9_]*)\]$/);
  if (m) return m[1]; // e.g. [Promise] → Promise (already a global), [Performance] etc.
  return null;
}

function fnVtoName(v) {
  const m = v && v.match(/^function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
  return m ? m[1] : null;
}

const code = fs.readFileSync(path.resolve(finalFile), "utf8");
console.log(`[2] Reading: ${finalFile} (${(code.length / 1024).toFixed(0)} KB)`);

const ast = parser.parse(code, {
  sourceType: "script",
  allowReturnOutsideFunction: true,
  errorRecovery: true,
});

function calleeMatches(callee, name) {
  if (!callee) return false;
  if (callee.type === "Identifier" && callee.name === name) return true;
  if (
    callee.type === "MemberExpression" &&
    callee.property.type === "Identifier" &&
    callee.property.name === name
  )
    return true;
  if (callee.type === "SequenceExpression" && callee.expressions.length === 2) {
    const last = callee.expressions[1];
    if (last.type === "Identifier" && last.name === name) return true;
    if (
      last.type === "MemberExpression" &&
      last.property.type === "Identifier" &&
      last.property.name === name
    )
      return true;
  }
  return false;
}

const counts = {};
let totalReplaced = 0;

traverse(ast, {
  CallExpression(p) {
    if (p.node.arguments.length !== 1) return;
    const arg = p.node.arguments[0];
    if (arg.type !== "StringLiteral") return;

    for (const [decoderName, map] of Object.entries(sec)) {
      if (!calleeMatches(p.node.callee, decoderName)) continue;
      const entry = map[arg.value];
      if (!entry) return;

      let replacement = null;
      if (entry.t === "string") {
        replacement = t.stringLiteral(entry.v);
      } else if (entry.t === "function") {
        const name = fnVtoName(entry.v);
        if (name) replacement = t.identifier(name);
      } else if (entry.t === "object") {
        const name = objectVtoName(entry.v);
        if (name) replacement = t.identifier(name);
      } else if (entry.t === "boolean") {
        replacement = t.booleanLiteral(entry.v === true || entry.v === "true");
      } else if (entry.t === "null" || entry.t === "undefined") {
        replacement = t.identifier(entry.t);
      }

      if (replacement) {
        p.replaceWith(replacement);
        counts[decoderName] = (counts[decoderName] || 0) + 1;
        totalReplaced++;
      }
      return;
    }
  },
});

console.log(`[3] Replaced:`);
for (const [n, c] of Object.entries(counts)) {
  console.log(`    ${n}: ${c}`);
}
console.log(`    total: ${totalReplaced}`);

const outFile = path.resolve(finalFile).replace(".final.js", ".v2.js");
const { code: generated } = generate(ast, { compact: false, concise: false });

prettier
  .format(generated, { parser: "babel", printWidth: 110, tabWidth: 2, semi: true })
  .then((formatted) => {
    fs.writeFileSync(outFile, formatted, "utf8");
    console.log(`\n✅ Saved: ${outFile} (${(formatted.length / 1024).toFixed(0)} KB)`);
  })
  .catch((err) => {
    console.warn("Prettier failed:", err.message);
    fs.writeFileSync(outFile, generated, "utf8");
  });
