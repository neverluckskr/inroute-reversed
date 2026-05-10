/**
 * apply_deep.js
 * Takes a .deep.json (from deep_extract.js) and applies ALL extracted strings
 * to a .deob.js file:
 *   - decoder(arr[N])   → string  (via primaryViaArray)
 *   - decoder(N)        → string  (via primaryDirect)
 *   - secondary(STR)    → result  (functions inlined as { ...code... })
 *
 * Usage:
 *   node apply_deep.js <deep.json> <deob.js>
 */

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const prettier = require("prettier");

const deepFile = process.argv[2];
const deobFile = process.argv[3];

if (!deepFile || !deobFile) {
  console.error("Usage: node apply_deep.js <deep.json> <deob.js>");
  process.exit(1);
}

const deep = JSON.parse(fs.readFileSync(path.resolve(deepFile), "utf8"));
const meta = deep.meta || {};
const decoderName = meta.decoderName;
const arrayName = meta.arrayName;
const secondaryNames = meta.secondaryDecoders || [];

console.log(`[1] Deep map: decoder=${decoderName}, array=${arrayName}`);
console.log(
  `    primaryDirect: ${Object.keys(deep.primaryDirect || {}).length}, ` +
    `primaryViaArray: ${Object.keys(deep.primaryViaArray || {}).length}, ` +
    `secondary: [${Object.keys(deep.secondary || {}).join(", ")}]`
);

const code = fs.readFileSync(path.resolve(deobFile), "utf8");
console.log(`[2] Reading: ${deobFile} (${(code.length / 1024).toFixed(0)} KB)`);

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
  if (
    callee.type === "SequenceExpression" &&
    callee.expressions.length === 2
  ) {
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

const directMap = {};
for (const [k, v] of Object.entries(deep.primaryDirect || {})) {
  if (v && v.t === "string") directMap[+k] = v.v;
}
const viaArrayMap = {};
for (const [k, v] of Object.entries(deep.primaryViaArray || {})) {
  if (v && v.t === "string") viaArrayMap[+k] = v.v;
}
const secondaryStringMap = {}; // {name: {arg: string}}
const secondaryFnReport = []; // [{name, arg, body}]
for (const [name, m] of Object.entries(deep.secondary || {})) {
  secondaryStringMap[name] = {};
  for (const [arg, val] of Object.entries(m)) {
    if (val && val.t === "string") secondaryStringMap[name][arg] = val.v;
    else if (val && val.t === "function")
      secondaryFnReport.push({ name, arg, body: val.v });
  }
}

console.log("[3] Replacing in AST...");
let nDirect = 0;
let nViaArray = 0;
const nSecondary = {};
secondaryNames.forEach((n) => (nSecondary[n] = 0));

traverse(ast, {
  CallExpression(p) {
    if (p.node.arguments.length !== 1) return;
    const arg = p.node.arguments[0];
    if (
      arg.type === "MemberExpression" &&
      arg.computed &&
      arg.property.type === "NumericLiteral" &&
      calleeMatches(p.node.callee, decoderName)
    ) {
      let arrIdent = null;
      if (arg.object.type === "Identifier") arrIdent = arg.object.name;
      else if (
        arg.object.type === "MemberExpression" &&
        arg.object.property.type === "Identifier"
      )
        arrIdent = arg.object.property.name;
      if (arrIdent === arrayName) {
        const idx = arg.property.value;
        if (Object.prototype.hasOwnProperty.call(viaArrayMap, idx)) {
          p.replaceWith(t.stringLiteral(viaArrayMap[idx]));
          nViaArray++;
          return;
        }
      }
    }
    if (arg.type === "NumericLiteral" && calleeMatches(p.node.callee, decoderName)) {
      const idx = arg.value;
      if (Object.prototype.hasOwnProperty.call(directMap, idx)) {
        p.replaceWith(t.stringLiteral(directMap[idx]));
        nDirect++;
        return;
      }
    }
    if (arg.type === "StringLiteral") {
      for (const name of secondaryNames) {
        if (!calleeMatches(p.node.callee, name)) continue;
        const map = secondaryStringMap[name];
        if (map && Object.prototype.hasOwnProperty.call(map, arg.value)) {
          p.replaceWith(t.stringLiteral(map[arg.value]));
          nSecondary[name]++;
        }
        break;
      }
    }
  },
});

console.log(`    decoder(arr[N])  replaced: ${nViaArray}`);
console.log(`    decoder(N)       replaced: ${nDirect}`);
for (const [n, c] of Object.entries(nSecondary)) {
  console.log(`    ${n}(STR)       replaced: ${c}`);
}
console.log("[4] Generating...");
const outFile = path
  .resolve(deobFile)
  .replace(".deob.js", ".final.js")
  .replace(".readable.js", ".final.js");

const { code: generated } = generate(ast, { compact: false, concise: false });

prettier
  .format(generated, {
    parser: "babel",
    printWidth: 110,
    tabWidth: 2,
    semi: true,
  })
  .then((formatted) => {
    fs.writeFileSync(outFile, formatted, "utf8");
    console.log(`\n✅ Saved: ${outFile} (${(formatted.length / 1024).toFixed(0)} KB)`);
    if (secondaryFnReport.length > 0) {
      const reportFile = outFile.replace(".final.js", ".secondary_fns.txt");
      const txt = secondaryFnReport
        .map((r) => `// ${r.name}("${r.arg}") →\n${r.body}\n`)
        .join("\n" + "─".repeat(80) + "\n");
      fs.writeFileSync(reportFile, txt, "utf8");
      console.log(`   Secondary fn bodies: ${reportFile} (${secondaryFnReport.length} entries)`);
    }
  })
  .catch((err) => {
    console.warn("Prettier failed, saving unformatted:", err.message);
    fs.writeFileSync(outFile, generated, "utf8");
  });
