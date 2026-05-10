/**
 * apply_strings.js
 * Takes a .string_map.json and replaces all decoder call patterns
 * (e.g. `(1, c96YSn)(JR5NBN[490])`) with the actual decoded string
 * in the corresponding .deob.js file.
 *
 * Usage:
 *   node apply_strings.js <string_map.json> [deob.js]
 *
 * If deob.js is omitted, the script infers it from the map filename.
 */

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const prettier = require("prettier");

const mapFile = process.argv[2];
let deobFile = process.argv[3];

if (!mapFile) {
  console.error("Usage: node apply_strings.js <string_map.json> [deob.js]");
  process.exit(1);
}

const absMap = path.resolve(mapFile);
const mapData = JSON.parse(fs.readFileSync(absMap, "utf8"));
const meta = mapData.__meta || {};

const arrayName = meta.arrayName;
const decoderName = meta.decoderName;
const stringMap = {};
for (const [k, v] of Object.entries(mapData)) {
  if (k === "__meta") continue;
  stringMap[parseInt(k, 10)] = v;
}

const mapSize = Object.keys(stringMap).length;
console.log(`[1] Loaded string map: ${mapSize} entries`);
console.log(`    Array: "${arrayName}", Decoder: "${decoderName}"`);
if (!deobFile) {
  const base = meta.sourceFile.replace(".js", ".deob.js");
  deobFile = path.join(path.dirname(absMap), base);
}
const absDeob = path.resolve(deobFile);
console.log(`[2] Reading: ${absDeob}`);

const code = fs.readFileSync(absDeob, "utf8");
console.log(`    Size: ${(code.length / 1024).toFixed(1)} KB`);

console.log("[3] Parsing AST...");
const ast = parser.parse(code, {
  sourceType: "script",
  allowReturnOutsideFunction: true,
  errorRecovery: true,
});
function isDecoderCall(node) {
  if (node.type !== "CallExpression") return false;

  const args = node.arguments;
  if (args.length !== 1) return false;

  const arg = args[0];
  if (
    arg.type !== "MemberExpression" ||
    !arg.computed ||
    arg.property.type !== "NumericLiteral"
  )
    return false;
  if (arg.object.type !== "Identifier" || arg.object.name !== arrayName) return false;
  const callee = node.callee;
  if (callee.type === "Identifier" && callee.name === decoderName) return true;
  if (
    callee.type === "MemberExpression" &&
    callee.property.type === "Identifier" &&
    callee.property.name === decoderName
  )
    return true;
  if (
    callee.type === "SequenceExpression" &&
    callee.expressions.length === 2 &&
    callee.expressions[1].type === "Identifier" &&
    callee.expressions[1].name === decoderName
  )
    return true;
  if (
    callee.type === "SequenceExpression" &&
    callee.expressions.length === 2 &&
    callee.expressions[1].type === "MemberExpression" &&
    callee.expressions[1].property.name === decoderName
  )
    return true;

  return false;
}
console.log("[4] Replacing decoder calls...");
let replaced = 0;
let notFound = 0;

traverse(ast, {
  CallExpression(nodePath) {
    if (!isDecoderCall(nodePath.node)) return;
    const idx = nodePath.node.arguments[0].property.value;
    if (Object.prototype.hasOwnProperty.call(stringMap, idx)) {
      nodePath.replaceWith(t.stringLiteral(stringMap[idx]));
      replaced++;
    } else {
      notFound++;
    }
  },
});

console.log(`    Replaced: ${replaced}  |  Index not in map: ${notFound}`);
console.log("[5] Generating output...");

const outFile = absDeob.replace(".deob.js", ".readable.js");
const { code: generated } = generate(ast, { compact: false, concise: false });

prettier
  .format(generated, {
    parser: "babel",
    printWidth: 110,
    tabWidth: 2,
    semi: true,
    singleQuote: false,
  })
  .then((formatted) => {
    fs.writeFileSync(outFile, formatted, "utf8");
    console.log(`\n✅ Saved: ${outFile}`);
    console.log(`   Size: ${(formatted.length / 1024).toFixed(1)} KB`);
    console.log(`   Strings inlined: ${replaced}`);
  })
  .catch((err) => {
    console.warn("Prettier failed, saving unformatted:", err.message);
    fs.writeFileSync(outFile, generated, "utf8");
    console.log(`\n✅ Saved (unformatted): ${outFile}`);
  });
