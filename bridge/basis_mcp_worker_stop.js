/*
 * Basis MCP stopper v0.3
 * RUN: BASIS -> menu "Scripts" -> click "basis_mcp_worker_stop"
 * Queues a shutdown command the worker processes on its next button press
 * (Shift+1 or clicking the BasisMCP button).
 * (ASCII-only on purpose: engine sources are CP1251.)
 */
(function main() {
  var ROOT = "C:\\Users\\Public\\basis-mcp";
  var INBOX = ROOT + "\\inbox";
  var fs = require("fs");

  function ensureDirs(dirs) {
    var parts = dirs.split("\\");
    var cur = "";
    for (var i = 0; i < parts.length; i++) {
      cur = cur ? cur + "\\" + parts[i] : parts[i];
      if (cur.charAt(1) !== ":") continue;
      try { fs.mkdirSync(cur); } catch (e) { /* exists */ }
    }
  }
  ensureDirs(INBOX);

  function writeAtomic(file, text) {
    var tmp = file + ".tmp";
    fs.writeFileSync(tmp, text, "utf8");
    try { fs.unlinkSync(file); } catch (e) { /* first write */ }
    fs.renameSync(tmp, file);
  }

  var id = "s" + Date.now().toString(36);
  writeAtomic(INBOX + "\\cmd_" + id + ".json", JSON.stringify({ id: id, op: "worker_stop", params: {}, sentAt: new Date().toISOString() }, null, 2));
  alert("Stop command queued (id " + id + ").\nWorker will finish after the NEXT button click\n(click 'BasisMCP' on the parameters panel).");
})();
