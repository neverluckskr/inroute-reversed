const fs = require("fs");
const path = require("path");

const files = [
    { src: "output/bypasser.entry.v3.js", dest: "../pump/bypasser.entry.js", type: "bypasser" },
    { src: "output/content.entry.v3.js", dest: "../pump/content.entry.js", type: "content" },
    { src: "output/popup.entry.v3.js", dest: "../pump/popup.entry.js", type: "popup" }
];

for (const file of files) {
    const srcPath = path.join(__dirname, file.src);
    const destPath = path.join(__dirname, file.dest);
    
    if (!fs.existsSync(srcPath)) continue;
    
    let content = fs.readFileSync(srcPath, "utf-8");
    
    content = content.replace(/throw\s+new\s+[^;]+_GUARD_FAIL[^;]+;/g, 
        'console.log("guard bypassed");');
    
    content = content.replace(/if\s*\(\s*!window\["__SECURE__"\]\s*\)/g, 
        'if (false)');

    content = content.replace(/Performance\["now"\]/g, 'performance["now"]');
    content = content.replace(/Performance\.now/g, 'performance.now');
    
    if (file.type === "popup") {
        content = content.replace(
            /\(wcjgw_\.nJqAz3K\s*=\s*async\s+function\s+jb3COY\(\[uAuQa3C\],\s*LQn0JNs\)\s*\{/,
            `(wcjgw_.nJqAz3K = async function jb3COY([uAuQa3C], LQn0JNs) {
              return new Uint8Array([1,2,3,4]);
            }, wcjgw_.__original_nJqAz3K = async function jb3COY([uAuQa3C], LQn0JNs) {`
        );

        content = content.replace(
            /return\s*\(await\s+gQchYe4\["Fh0xrt0"\]\(uAuQa3C,\s*LQn0JNs\)\)\s*===\s*juq6SW;/,
            'return true;'
        );
    }

    if (file.type === "content" || file.type === "popup") {
        const secureStub = `
window["__SECURE__"] = {
    signAuth: async function(token, ts) {
        const data = token + "|" + ts;
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
        const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
        return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,"0")).join("");
    },
    checkAuthIntegrity: async function() { return true; },
    cryptoAvailable: function() { return true; }
};
`;
        content = secureStub + content;
    }

    fs.writeFileSync(destPath, content, "utf-8");
    console.log(`Patched ${file.type} → ${destPath}`);
}

const baseDir = path.join(__dirname, "..");
const crackedDir = path.join(baseDir, "InRoute_Cracked");

if (fs.existsSync(crackedDir)) {
    fs.rmSync(crackedDir, { recursive: true, force: true });
}
fs.mkdirSync(crackedDir, { recursive: true });

const copyRecursive = (src, dest) => {
    if (fs.statSync(src).isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const item of fs.readdirSync(src)) {
            copyRecursive(path.join(src, item), path.join(dest, item));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
};

for (const item of ["manifest.json", "popup.html", "LICENSE.txt"]) {
    const srcP = path.join(baseDir, item);
    if (fs.existsSync(srcP)) fs.copyFileSync(srcP, path.join(crackedDir, item));
}
for (const dir of ["html", "pump"]) {
    const srcP = path.join(baseDir, dir);
    if (fs.existsSync(srcP)) copyRecursive(srcP, path.join(crackedDir, dir));
}

console.log("Done.");
