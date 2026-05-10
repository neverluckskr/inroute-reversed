const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const prettier = require("prettier");

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: node deobfuscate.js <file.js>");
  process.exit(1);
}

const absInput = path.resolve(inputFile);
const baseName = path.basename(absInput, ".js");
const outputFile = path.join(__dirname, "output", baseName + ".deob.js");

console.log(`[1/4] Reading: ${absInput}`);
const code = fs.readFileSync(absInput, "utf8");
console.log(`      Size: ${(code.length / 1024).toFixed(1)} KB`);
console.log("[2/4] Parsing AST...");
let ast;
try {
  ast = parser.parse(code, {
    sourceType: "script",
    allowReturnOutsideFunction: true,
    plugins: ["v8intrinsic"],
    errorRecovery: true,
  });
} catch (e) {
  console.error("Parse failed:", e.message);
  process.exit(1);
}
console.log("[3/4] Applying transforms...");
let hexCount = 0;
traverse(ast, {
  NumericLiteral(nodePath) {
    const raw = nodePath.node.extra && nodePath.node.extra.raw;
    if (raw && raw.startsWith("0x")) {
      nodePath.node.extra = { raw: String(nodePath.node.value), rawValue: nodePath.node.value };
      hexCount++;
    }
  },
});
console.log(`      Hex literals replaced: ${hexCount}`);
let stringArrayName = null;
let stringArray = [];

traverse(ast, {
  VariableDeclarator(nodePath) {
    const init = nodePath.node.init;
    if (!init || init.type !== "ArrayExpression") return;
    const elements = init.elements;
    if (!elements || elements.length < 10) return;
    const allStrings = elements.every(
      (el) => el && (el.type === "StringLiteral" || el.type === "TemplateLiteral")
    );
    if (!allStrings) return;
    if (elements.length > stringArray.length) {
      stringArray = elements.map((el) => (el.type === "StringLiteral" ? el.value : ""));
      stringArrayName = nodePath.node.id.name;
      console.log(`      String array: "${stringArrayName}" (${stringArray.length} entries)`);
    }
  },
});
let strReplaced = 0;
if (stringArrayName && stringArray.length > 0) {
  traverse(ast, {
    MemberExpression(nodePath) {
      const obj = nodePath.node.object;
      const prop = nodePath.node.property;
      if (
        obj.type === "Identifier" &&
        obj.name === stringArrayName &&
        nodePath.node.computed &&
        prop.type === "NumericLiteral"
      ) {
        const idx = prop.value;
        if (idx >= 0 && idx < stringArray.length) {
          nodePath.replaceWith(t.stringLiteral(stringArray[idx]));
          strReplaced++;
        }
      }
    },
  });
  console.log(`      String references replaced: ${strReplaced}`);
} else {
  console.log("      No string array found — skipping string replacement");
}
traverse(ast, {
  UnaryExpression(nodePath) {
    if (nodePath.node.operator === "void" && t.isNumericLiteral(nodePath.node.argument, { value: 0 })) {
      nodePath.replaceWith(t.identifier("undefined"));
    }
  },
});
let strDecoded = 0;
traverse(ast, {
  StringLiteral(nodePath) {
    if (nodePath.node.extra) {
      const raw = nodePath.node.extra.raw || "";
      if (raw.includes("\\x") || raw.includes("\\u")) {
        delete nodePath.node.extra.raw;
        delete nodePath.node.extra.rawValue;
        strDecoded++;
      }
    }
  },
});
console.log(`      Encoded strings decoded: ${strDecoded}`);
console.log("[4/4] Generating output...");
const { code: generated } = generate(ast, {
  comments: true,
  compact: false,
  concise: false,
  retainLines: false,
});

prettier
  .format(generated, {
    parser: "babel",
    printWidth: 100,
    tabWidth: 2,
    semi: true,
    singleQuote: false,
  })
  .then((formatted) => {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, formatted, "utf8");
    console.log(`\nDone! Output: ${outputFile}`);
    console.log(`Output size: ${(formatted.length / 1024).toFixed(1)} KB`);
  })
  .catch((err) => {
    console.warn("Prettier failed, saving unformatted:", err.message);
    fs.writeFileSync(outputFile, generated, "utf8");
    console.log(`\nDone (unformatted)! Output: ${outputFile}`);
  });
