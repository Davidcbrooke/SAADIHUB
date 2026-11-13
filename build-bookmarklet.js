// Rebuilds the "Send to SAADI Hub" bookmark link in class-capacity.html.
// The bookmark is a small launcher: it loads justgo-sync-bookmarklet.js from the hub each time and runs it,
// so edits to that file go live without anyone dragging the button again. Run: node build-bookmarklet.js
const fs = require("fs");
new Function(fs.readFileSync(__dirname + "/justgo-sync-bookmarklet.js", "utf8")); // throws if the sync code doesn't parse
const loader = `(async()=>{try{const r=await fetch("https://hub.saadigymnastics.co.uk/justgo-sync-bookmarklet.js?"+Date.now(),{cache:"no-store"});if(!r.ok)throw 0;new Function(await r.text())()}catch(e){alert("Send to SAADI Hub couldn't load. Check the internet connection and try again.")}})()`;
new Function(loader);
const href = "javascript:" + encodeURIComponent(loader);
const file = __dirname + "/class-capacity.html";
const html = fs.readFileSync(file, "utf8");
const re = /(<a id="jgBookmarklet" class="bm" href=")[^"]*(")/;
if (!re.test(html)) throw new Error("Bookmark link not found in class-capacity.html");
fs.writeFileSync(file, html.replace(re, (_, a, b) => a + href + b));
console.log("Bookmark link updated (" + href.length + " characters).");
