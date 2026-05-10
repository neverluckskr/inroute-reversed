/**
 * apply_array.js
 * Inlines remaining direct `arr[N]` (and `NS.arr[N]`) accesses with the
 * primitive values from deep.json's primaryArray dump.
 *
 * Usage:
 *   node apply_array.js <deep.json> <v2.js>
 */

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const prettier = require("prettier");

const deepFile = process.argv[2];
const inFile = process.argv[3];
if (!deepFile || !inFile) {
  console.error("Usage: node apply_array.js <deep.json> <v2.js>");
  process.exit(1);
}

const deep = JSON.parse(fs.readFileSync(path.resolve(deepFile), "utf8"));
const arrayName = deep.meta.arrayName;
const arrEntries = deep.primaryArray || [];

console.log(`[1] Array "${arrayName}": ${arrEntries.length} entries`);

const code = fs.readFileSync(path.resolve(inFile), "utf8");
console.log(`[2] Reading: ${inFile} (${(code.length / 1024).toFixed(0)} KB)`);

const ast = parser.parse(code, {
  sourceType: "script",
  allowReturnOutsideFunction: true,
  errorRecovery: true,
});

let nReplaced = 0;
let nSkipped = 0;

traverse(ast, {
  MemberExpression(p) {
    const node = p.node;
    if (!node.computed) return;
    if (node.property.type !== "NumericLiteral") return;
    let isMatch = false;
    if (node.object.type === "Identifier" && node.object.name === arrayName) {
      isMatch = true;
    } else if (
      node.object.type === "MemberExpression" &&
      !node.object.computed &&
      node.object.property.type === "Identifier" &&
      node.object.property.name === arrayName
    ) {
      isMatch = true;
    }
    if (!isMatch) return;

    const idx = node.property.value;
    const entry = arrEntries[idx];
    if (!entry) {
      nSkipped++;
      return;
    }

    let replacement = null;
    if (entry.t === "string") replacement = t.stringLiteral(entry.v);
    else if (entry.t === "number")
      replacement = entry.v < 0
        ? t.unaryExpression("-", t.numericLiteral(-entry.v))
        : t.numericLiteral(entry.v);
    else if (entry.t === "boolean") replacement = t.booleanLiteral(entry.v);
    else if (entry.t === "null") replacement = t.nullLiteral();

    if (replacement) {
      p.replaceWith(replacement);
      nReplaced++;
    } else {
      nSkipped++;
    }
  },
});

console.log(`[3] Inlined: ${nReplaced}, skipped (non-primitive): ${nSkipped}`);

const outFile = path.resolve(inFile).replace(".v2.js", ".v3.js");
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
