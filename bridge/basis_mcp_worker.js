/*
 * Basis MCP worker v0.3  (old-API, BASIS 2022)
 * ASCII-only on purpose: the engine reads sources in CP1251.
 *
 * HOW LIVENESS WORKS (documented old-API mechanism):
 * - The script creates a button on the parameters panel (NewButtonInput).
 *   BASIS auto-binds hotkeys to buttons: the first button is Shift+1.
 * - The script ends at the "input stage": BASIS keeps the script session
 *   alive and calls the GLOBAL function $input(id) when the button is pressed.
 * - Each button press runs the whole command queue (pump) using the live
 *   script context - so object-creating commands work in this mode.
 *
 * INSTALL: copy to the BASIS scripts folder, e.g.
 *   C:\Users\<user>\Documents\Bazis2022\Scripts\basis_mcp_worker.js
 * RUN: open a model -> menu "Scripts" -> click "basis_mcp_worker"
 *      -> click OK on the alert. Now every agent command list is executed
 *      by pressing Shift+1 (or clicking the BasisMCP button).
 * STOP: just close BASIS, or run script "basis_mcp_worker_stop"
 *      (it writes a shutdown queue entry processed at next press).
 *
 * EXCHANGE DIR: C:\Users\Public\basis-mcp (inbox / outbox / states / log)
 */

var BASIS_MCP_VERSION = "0.5.5";
var BASIS_MCP_ROOT = "C:\\Users\\Public\\basis-mcp";
var BASIS_MCP_INBOX = BASIS_MCP_ROOT + "\\inbox";
var BASIS_MCP_OUTBOX = BASIS_MCP_ROOT + "\\outbox";
var BASIS_MCP_STATES = BASIS_MCP_ROOT + "\\states";
var BASIS_MCP_LOG = BASIS_MCP_ROOT + "\\log\\worker.log";

var BASIS_MCP_BUTTON = null;
var BASIS_MCP_BUTT_INPUT = null;
var BASIS_MCP_FURNITURE = null;
var BASIS_MCP_LAST_MOVE_PUMP = 0;
var BASIS_MCP_TIMER = null;
var BASIS_MCP_TICKS = 0;
var BASIS_MCP_PROCESSED = 0;
var BASIS_MCP_STOP_REQUESTED = false;

/* ------------------------------ helpers ------------------------------ */

function basisMcpF() {
  try { return require("fs"); } catch (e) { return null; }
}

function basisMcpEnsureDirs(dirs) {
  var fs = basisMcpF();
  var parts = dirs.split("\\");
  var cur = "";
  for (var i = 0; i < parts.length; i++) {
    cur = cur ? cur + "\\" + parts[i] : parts[i];
    if (cur.charAt(1) !== ":") continue;
    try { fs.mkdirSync(cur); } catch (e) { /* exists */ }
  }
}

function basisMcpWriteAtomic(file, text) {
  var fs = basisMcpF();
  var tmp = file + ".tmp";
  fs.writeFileSync(tmp, text, "utf8");
  try { fs.unlinkSync(file); } catch (e) { /* first write */ }
  fs.renameSync(tmp, file);
}

function basisMcpLog(level, msg) {
  var fs = basisMcpF();
  try { fs.appendFileSync(BASIS_MCP_LOG, new Date().toISOString() + " [" + level + "] " + msg + "\n", "utf8"); }
  catch (e) { /* not critical */ }
}

function basisMcpLogError(kind, e) {
  basisMcpLog("error", kind + ": " + String(e) + (e && e.stack ? " | " + e.stack : ""));
}

function basisMcpSafeNum(fn, fallback) {
  try { var v = fn(); return typeof v === "number" ? v : (v === undefined || v === null ? fallback : Number(v)); }
  catch (e) { return fallback; }
}
function basisMcpSafeStr(fn, fallback) {
  try { var v = fn(); return v === undefined || v === null ? fallback : String(v); }
  catch (e) { return fallback; }
}
function basisMcpChildOf(list, i) {
  try { return list.Objects[i]; } catch (eIndex) {
    try { return list.Objects(i); } catch (eCall) { return null; }
  }
}
function basisMcpQuietBool(fn) {
  try { return !!fn(); } catch (e) { return false; }
}

/* Changes made by a script exist as "new script objects" and do NOT appear
 * in the model tree until committed. Action.Commit() applies them without
 * finishing the script (documented old API). Without it a worker living in
 * the input stage would accumulate invisible pending objects. */
function basisMcpCommit() {
  try {
    if (typeof Action !== "undefined" && Action && typeof Action.Commit === "function") {
      Action.Commit();
      return true;
    }
    basisMcpLog("warn", "Action.Commit unavailable");
    return false;
  } catch (e) {
    basisMcpLogError("commit", e);
    return false;
  }
}

/* ----------------------- model helpers (old API) ----------------------- */

function basisMcpTypeOf(obj) {
  if (basisMcpQuietBool(function () { return obj.Butts !== undefined && obj.Contour !== undefined; })) return "panel";
  if (basisMcpQuietBool(function () { return obj.Objects !== undefined && typeof obj.Count === "number"; })) {
    var ft = basisMcpSafeStr(function () { return obj.FurnType; }, null);
    return ft ? "list:" + ft : "list";
  }
  return "object";
}

function basisMcpSummarize(obj, depth, includePanelInfo, path) {
  var info = {};
  info.name = basisMcpSafeStr(function () { return obj.Name; }, null);
  info.type = basisMcpTypeOf(obj);
  info.path = path;
  if (info.type === "panel") {
    if (includePanelInfo) {
      info.material = basisMcpSafeStr(function () { return obj.MaterialName; }, null);
      info.thickness = basisMcpSafeNum(function () { return obj.Thickness; }, null);
      info.contourWidth = basisMcpSafeNum(function () { return obj.ContourWidth; }, null);
      info.contourHeight = basisMcpSafeNum(function () { return obj.ContourHeight; }, null);
      info.butts = basisMcpSafeNum(function () { return obj.Butts.Count; }, null);
    }
  } else {
    var nums = {};
    var fields = ["Width", "Height", "Depth", "Length", "Count"];
    for (var f = 0; f < fields.length; f++) {
      var v = basisMcpSafeNum(function () { return obj[fields[f]]; }, null);
      if (v !== null && obj[fields[f]] !== undefined) nums[fields[f]] = v;
    }
    if (Object.keys(nums).length > 0) info.fields = nums;
  }
  var cnt = basisMcpSafeNum(function () { return obj.Count; }, null);
  if (cnt !== null && cnt > 0 && depth > 1 && info.type !== "panel") {
    info.children = [];
    for (var i = 0; i < cnt; i++) {
      var child = basisMcpChildOf(obj, i);
      if (child === null || child === undefined) continue;
      try { info.children.push(basisMcpSummarize(child, depth - 1, includePanelInfo, path.concat([i]))); }
      catch (eChild) { info.children.push({ path: path.concat([i]), error: String(eChild) }); }
    }
  }
  return info;
}

function basisMcpFlattenSelected(list, path, out, depth) {
  var cnt = basisMcpSafeNum(function () { return list.Count; }, null);
  if (cnt === null) return;
  for (var i = 0; i < cnt; i++) {
    var obj = basisMcpChildOf(list, i);
    if (obj === null || obj === undefined) continue;
    var isSel = false;
    try { isSel = obj.Selected === true; } catch (e) { isSel = false; }
    var childPath = path.concat([i]);
    if (isSel) {
      try { out.push({ path: childPath, name: basisMcpSafeStr(function () { return obj.Name; }, null), type: basisMcpTypeOf(obj), selected: true }); }
      catch (e2) { out.push({ path: childPath, error: String(e2) }); }
    }
    if (depth > 0) basisMcpFlattenSelected(obj, childPath, out, depth - 1);
  }
}

function basisMcpFindByPath(pathArr) {
  var list = Model;
  var lastObj = null;
  for (var i = 0; i < pathArr.length; i++) {
    var spec = pathArr[i];
    if (typeof spec === "number") {
      var obj = basisMcpChildOf(list, spec);
      if (obj === null || obj === undefined) return null;
      lastObj = obj;
      list = obj;
    } else {
      var found = null;
      var n = basisMcpSafeNum(function () { return list.Count; }, 0) || 0;
      for (var k = 0; k < n; k++) {
        var c = basisMcpChildOf(list, k);
        if (c && basisMcpSafeStr(function () { return c.Name; }, null) === String(spec)) { found = c; break; }
      }
      if (!found) return null;
      lastObj = found;
      list = found;
    }
  }
  return lastObj;
}

/* ----------------------------- operations ----------------------------- */

var BASIS_MCP_HANDLERS = {

  ping: function () {
    return { pong: true, bridgeVersion: BASIS_MCP_VERSION, mode: "worker", modelFilename: basisMcpSafeStr(function () { return ModelFilename; }, null), modelCount: basisMcpSafeNum(function () { return Model.Count; }, null) };
  },

  get_active_file: function () {
    return { filename: basisMcpSafeStr(function () { return ModelFilename; }, null), modelCount: basisMcpSafeNum(function () { return Model.Count; }, null) };
  },

  get_model_summary: function (p) {
    var maxDepth = (p && typeof p.maxDepth === "number") ? p.maxDepth : 4;
    var includePanelInfo = !(p && p.includePanelInfo === false);
    return basisMcpSummarize(Model, maxDepth, includePanelInfo, []);
  },

  get_selection: function () {
    var out = [];
    basisMcpFlattenSelected(Model, [], out, 10);
    return { selectedCount: out.length, items: out };
  },

  add_panel: function (p) {
    if (p.orientation && ["front", "horiz", "vert"].indexOf(p.orientation) < 0) {
      throw new Error("orientation must be front|horiz|vert");
    }
    var orientation = p.orientation || "front";
    var a = p.rect || {};
    var panel;
    if (orientation === "front") {
      panel = AddFrontPanel(a.x1 || 0, a.y1 || 0, a.x2 || (a.width || 100), a.y2 || (a.height || 100), a.depth || 0);
    } else if (orientation === "horiz") {
      panel = AddHorizPanel(a.x1 || 0, a.y1 || 0, a.x2 || (a.width || 100), a.y2 || (a.height || 100), a.depth || 0);
    } else {
      panel = AddVertPanel(a.x1 || 0, a.y1 || 0, a.x2 || (a.width || 100), a.y2 || (a.height || 100), a.depth || 0);
    }
    if (!panel) throw new Error("panel was not created (null returned)");
    /* DISCOVERED RULE: property writes BEFORE Commit() are carried into the
     * model; writes AFTER Commit() land nowhere (the object wrapper is
     * reborn at commit). So: set props -> single Commit -> readback
     * BEFORE the commit. */
    if (p.name) { try { panel.Name = String(p.name); } catch (eName) { /* keep default */ } }
    if (p.materialName) { try { panel.MaterialName = String(p.materialName); } catch (eMat) { /* material name may not match DB */ } }
    if (p.thickness) { try { panel.Thickness = Number(p.thickness); } catch (eTh) { /* keep default */ } }
    var readback = {
      name: basisMcpSafeStr(function () { return panel.Name; }, null),
      type: basisMcpTypeOf(panel),
      material: basisMcpSafeStr(function () { return panel.MaterialName; }, null),
      thickness: basisMcpSafeNum(function () { return panel.Thickness; }, null),
    };
    var committed = basisMcpCommit();
    return {
      created: true,
      committed: committed,
      name: readback.name,
      type: readback.type,
      material: readback.material,
      thickness: readback.thickness,
    };
  },

  enable_butt_picker: function () {
    if (BASIS_MCP_BUTT_INPUT) return { already: true, note: "picker exists; pick a banding in the panel, then use add_butt with material __picked__" };
    try {
      BASIS_MCP_BUTT_INPUT = NewButtMaterialInput("BasisMCP edge banding");
      basisMcpLog("info", "butt picker created (NewButtMaterialInput)");
      return { created: true, note: "pick the banding in the parameter panel; then send add_butt with material __picked__" };
    } catch (e) {
      basisMcpLogError("enable_butt_picker", e);
      throw e;
    }
  },

  batch_set_material: function (p) {
    if (!p || !p.materialName) throw new Error("batch_set_material requires materialName");
    var dryRun = p.dryRun === true;
    var target = String(p.materialName);
    var fromMat = p.fromMaterial ? String(p.fromMaterial) : null;
    var changed = [];
    var skippedCount = 0;
    var errors = [];

    function visit(list, path) {
      var n = basisMcpSafeNum(function () { return list.Count; }, 0) || 0;
      for (var i = 0; i < n; i++) {
        var obj = basisMcpChildOf(list, i);
        if (obj === null || obj === undefined) continue;
        var objPath = path.concat([i]);
        var isPanel = basisMcpQuietBool(function () { return obj.Butts !== undefined && obj.Contour !== undefined; });
        if (isPanel) {
          var oldMat = basisMcpSafeStr(function () { return obj.MaterialName; }, null);
          if (fromMat !== null && oldMat !== fromMat) {
            skippedCount++;
          } else {
            var entry = {
              path: objPath,
              name: basisMcpSafeStr(function () { return obj.Name; }, null),
              from: oldMat,
              to: target,
            };
            if (!dryRun) {
              try { obj.MaterialName = target; } catch (eMat) { entry.error = String(eMat); errors.push(entry); }
            }
            changed.push(entry);
          }
        }
        if (basisMcpQuietBool(function () { return obj.Count !== undefined; })) {
          visit(obj, objPath);
        }
      }
    }
    visit(Model, []);

    var committed = dryRun ? false : basisMcpCommit();
    return {
      dryRun: dryRun,
      committed: committed,
      changedCount: changed.length,
      skippedCount: skippedCount,
      errorCount: errors.length,
      changed: changed,
    };
  },

  mount_scheme: function (p) {
    if (!BASIS_MCP_FURNITURE) throw new Error("no opened furniture: call open_furniture first");
    if (!p || !p.panelPath || !p.panelPath2) throw new Error("mount_scheme requires panelPath and panelPath2");
    var p1 = basisMcpFindByPath(p.panelPath);
    if (!p1) throw new Error("first panel not found");
    var p2 = basisMcpFindByPath(p.panelPath2);
    if (!p2) throw new Error("second panel not found");
    var pos = p.position || "Inside";
    var bp;
    try {
      bp = Vector(Number(p.x || 0), Number(p.y || 0), Number(p.z || 0));
    } catch (eVec) { throw new Error("Vector() failed: " + eVec); }
    var obj = BASIS_MCP_FURNITURE.MountScheme(p1, p2, pos, bp);
    if (!obj) throw new Error("MountScheme returned null (position='" + pos + "')");
    var readback = { name: basisMcpSafeStr(function () { return obj.Name; }, null) };
    var committed = basisMcpCommit();
    return { mounted: true, committed: committed, position: pos, readback: readback };
  },

  object_info: function (p) {
    if (!p || p.path === undefined) throw new Error("object_info requires path");
    var obj = basisMcpFindByPath(p.path);
    if (!obj) throw new Error("object not found by path");
    var info = { name: basisMcpSafeStr(function () { return obj.Name; }, null) };
    try {
      var pos = obj.Position;
      info.position = { x: Number(pos.x), y: Number(pos.y), z: Number(pos.z) };
    } catch (ePos) { info.position = "n/a"; }
    try {
      var gmax = obj.GMax;
      info.gmax = { x: Number(gmax.x), y: Number(gmax.y), z: Number(gmax.z) };
    } catch (eMax) { info.gmax = "n/a"; }
    try {
      var gmin = obj.GMin;
      info.gmin = { x: Number(gmin.x), y: Number(gmin.y), z: Number(gmin.z) };
    } catch (eMin) { info.gmin = "n/a"; }
    info.width = basisMcpSafeNum(function () { return obj.Width; }, null);
    info.height = basisMcpSafeNum(function () { return obj.Height; }, null);
    info.depth = basisMcpSafeNum(function () { return obj.Depth; }, null);
    return info;
  },

  holes_info: function (p) {
    if (!p || !p.path) throw new Error("holes_info requires path");
    var obj = basisMcpFindByPath(p.path);
    if (!obj) throw new Error("object not found by path");
    var info = { name: basisMcpSafeStr(function () { return obj.Name; }, null) };
    try {
      var holes = obj.Holes;
      info.holes = basisMcpSafeNum(function () { return holes.Count; }, null);
      if (info.holes && info.holes > 0) {
        try {
          var h0 = basisMcpChildOf(holes, 0);
          info.first = {
            diameter: basisMcpSafeNum(function () { return h0.Diameter; }, null),
            depth: basisMcpSafeNum(function () { return h0.Depth; }, null),
            x: basisMcpSafeNum(function () { return h0.Position.x; }, null),
            y: basisMcpSafeNum(function () { return h0.Position.y; }, null),
            z: basisMcpSafeNum(function () { return h0.Position.z; }, null),
          };
        } catch (eFirst) {
          info.first = "n/a";
        }
      }
    } catch (e) {
      info.holes = "n/a";
    }
    return info;
  },

  open_furniture: function (p) {
    if (!p || !p.file) throw new Error("open_furniture requires file (absolute path to .f3d)");
    var f = OpenFurniture(String(p.file));
    if (!f) throw new Error("furniture was not opened (null returned): " + p.file);
    BASIS_MCP_FURNITURE = f;
    return {
      opened: true,
      name: basisMcpSafeStr(function () { return f.Name; }, null),
      datumMode: basisMcpSafeStr(function () { return String(f.DatumMode); }, null),
    };
  },

  furniture_reset: function () {
    BASIS_MCP_FURNITURE = null;
    return { reset: true };
  },

  mount_furniture: function (p) {
    if (!BASIS_MCP_FURNITURE) throw new Error("no opened furniture: call open_furniture first");
    if (!p || !p.panelPath) throw new Error("mount_furniture requires panelPath");
    var panel = basisMcpFindByPath(p.panelPath);
    if (!panel) throw new Error("panel not found by path");
    var obj;
    if (p.mode === "between") {
      if (!p.panelPath2) throw new Error("mode between requires panelPath2");
      var panel2 = basisMcpFindByPath(p.panelPath2);
      if (!panel2) throw new Error("second panel not found by path");
      obj = BASIS_MCP_FURNITURE.Mount(panel, panel2, Number(p.x || 0), Number(p.y || 0), Number(p.z || 0));
    } else {
      /* plane mode: Mount1(panel, x, y, z, angle) */
      obj = BASIS_MCP_FURNITURE.Mount1(panel, Number(p.x || 0), Number(p.y || 0), Number(p.z || 0), Number(p.angle || 0));
    }
    if (!obj) throw new Error("mount returned null (furniture was not placed)");
    var readback = {
      name: basisMcpSafeStr(function () { return obj.Name; }, null),
      type: basisMcpSafeStr(function () { return String(obj.Type); }, null),
    };
    var committed = basisMcpCommit();
    return { mounted: true, committed: committed, readback: readback };
  },

  set_butt_picker: function (p) {
    if (!p || !p.material) throw new Error("set_butt_picker requires material (name string)");
    if (!BASIS_MCP_BUTT_INPUT) {
      BASIS_MCP_BUTT_INPUT = NewButtMaterialInput("BasisMCP edge banding");
      basisMcpLog("info", "butt picker created on demand (set_butt_picker)");
    }
    var want = String(p.material);
    var attempts = {};
    try { BASIS_MCP_BUTT_INPUT.Name = want; attempts.Name = basisMcpSafeStr(function () { return BASIS_MCP_BUTT_INPUT.Name; }, null); } catch (e1) { attempts.Name = "error: " + e1; }
    try { BASIS_MCP_BUTT_INPUT.Material = want; attempts.Material = basisMcpSafeStr(function () { return BASIS_MCP_BUTT_INPUT.Material; }, null); } catch (e2) { attempts.Material = "error: " + e2; }
    try { BASIS_MCP_BUTT_INPUT.MaterialName = want; attempts.MaterialName = basisMcpSafeStr(function () { return BASIS_MCP_BUTT_INPUT.MaterialName; }, null); } catch (e3) { attempts.MaterialName = "error: " + e3; }
    var readback = {
      name: basisMcpSafeStr(function () { return BASIS_MCP_BUTT_INPUT.Name; }, null),
      thickness: basisMcpSafeNum(function () { return BASIS_MCP_BUTT_INPUT.Thickness; }, null),
      width: basisMcpSafeNum(function () { return BASIS_MCP_BUTT_INPUT.Width; }, null),
    };
    return { want: want, attempts: attempts, readback: readback };
  },

  add_butt: function (p) {
    if (!p || !p.path || p.elem === undefined) throw new Error("add_butt requires path and elem");
    var matParam = p.material;
    if (matParam === undefined || matParam === null) throw new Error("add_butt requires material (edge banding name string or __picked__)");
    var panel = basisMcpFindByPath(p.path);
    if (!panel) throw new Error("object not found by path");
    if (basisMcpQuietBool(function () { return panel.Butts === undefined; })) throw new Error("object is not a panel");
    var buttObj;
    if (matParam === "__picked__") {
      if (!BASIS_MCP_BUTT_INPUT) throw new Error("no picked material: call enable_butt_picker first, pick a banding, then re-run");
      buttObj = panel.AddButt(BASIS_MCP_BUTT_INPUT, Number(p.elem));
    } else {
      /* String names silently no-op for panel material (tested 20:00) - kept for experiments. */
      buttObj = panel.AddButt(String(matParam), Number(p.elem));
    }
    var readback = {};
    if (buttObj) {
      readback.material = basisMcpSafeStr(function () { return buttObj.Material; }, null);
      readback.thickness = basisMcpSafeNum(function () { return buttObj.Thickness; }, null);
      readback.width = basisMcpSafeNum(function () { return buttObj.Width; }, null);
    }
    var committed = basisMcpCommit();
    /* Re-lookup AFTER commit: the pre-commit wrapper is dead. */
    var fresh = basisMcpFindByPath(p.path);
    var buttsCount = basisMcpSafeNum(function () { return fresh.Butts.Count; }, null);
    return { added: true, committed: committed, butts: buttsCount, elem: Number(p.elem), readback: readback };
  },

  rename_object: function (p) {
    if (!p || !p.path || !p.newName) throw new Error("rename_object requires path and newName");
    var obj = basisMcpFindByPath(p.path);
    if (!obj) throw new Error("object not found by path");
    obj.Name = String(p.newName);
    var readback = basisMcpSafeStr(function () { return obj.Name; }, null);
    var committed = basisMcpCommit();
    return { renamed: committed, readback: readback };
  },

  set_panel_material: function (p) {
    if (!p || (!p.path && !p.name)) throw new Error("need path or name");
    var panel = null;
    if (p.path) {
      panel = basisMcpFindByPath(p.path);
      if (!panel) throw new Error("object not found by path");
    } else {
      var found = null;
      (function dfs(list, depth) {
        if (found || depth > 12) return;
        var n = basisMcpSafeNum(function () { return list.Count; }, 0) || 0;
        for (var i = 0; i < n; i++) {
          var c = basisMcpChildOf(list, i);
          if (!c) continue;
          if (basisMcpSafeStr(function () { return c.Name; }, null) === String(p.name)) { found = c; return; }
          dfs(c, depth + 1);
        }
      })(Model, 0);
      if (!found) throw new Error("object not found by name");
      panel = found;
    }
    if (basisMcpQuietBool(function () { return panel.Butts === undefined; })) throw new Error("object is not a panel");
    if (p.materialName) panel.MaterialName = String(p.materialName);
    if (p.thickness) panel.Thickness = Number(p.thickness);
    return { updated: true, committed: basisMcpCommit(), material: basisMcpSafeStr(function () { return panel.MaterialName; }, null) };
  },

  delete_object: function (p) {
    if (!p || !p.path) throw new Error("delete_object requires path");
    var obj = basisMcpFindByPath(p.path);
    if (!obj) throw new Error("object not found by path");
    DeleteObject(obj);
    return { deleted: true, committed: basisMcpCommit(), path: p.path };
  },

  model_commit: function () {
    return { committed: basisMcpCommit() };
  },

  worker_stop: function () {
    BASIS_MCP_STOP_REQUESTED = true;
    basisMcpLog("info", "stop requested via queue");
    return { stopping: true };
  },
};

/* -------------------------- command processing -------------------------- */

function basisMcpExecuteCommand(cmd) {
  var started = Date.now();
  try {
    var h = BASIS_MCP_HANDLERS[cmd.op];
    if (!h) throw new Error("unknown op: " + cmd.op + ". available: " + Object.keys(BASIS_MCP_HANDLERS).join(", "));
    var result = h((cmd && cmd.params) || {});
    return {
      id: cmd.id, status: "ok", result: result, durationMs: Date.now() - started,
      worker: { version: BASIS_MCP_VERSION, modelFilename: basisMcpSafeStr(function () { return ModelFilename; }, null) },
    };
  } catch (e) {
    return {
      id: cmd && cmd.id ? cmd.id : null, status: "error",
      error: { message: String(e), stack: e && e.stack ? String(e.stack) : undefined },
      durationMs: Date.now() - started,
      worker: { version: BASIS_MCP_VERSION, modelFilename: basisMcpSafeStr(function () { return ModelFilename; }, null) },
    };
  }
}

function basisMcpPump() {
  var fs = basisMcpF();
  var files;
  try { files = fs.readdirSync(BASIS_MCP_INBOX); } catch (e) { files = []; }
  var cmdFiles = files.filter(function (f) { return /^cmd_.+\.json$/.test(f); }).sort();
  for (var i = 0; i < cmdFiles.length; i++) {
    var full = BASIS_MCP_INBOX + "\\" + cmdFiles[i];
    var raw;
    try { raw = fs.readFileSync(full, "utf8"); } catch (eRead) { continue; }
    var cmd;
    try { cmd = JSON.parse(raw); } catch (eParse) {
      basisMcpLog("warn", "corrupt command file " + cmdFiles[i] + ": " + eParse);
      basisMcpArchive(full, cmdFiles[i], "corrupt");
      continue;
    }
    BASIS_MCP_PROCESSED++;
    var envelope = basisMcpExecuteCommand(cmd);
    try {
      basisMcpWriteAtomic(BASIS_MCP_OUTBOX + "\\res_" + cmd.id + ".json", JSON.stringify(envelope, null, 2));
    } catch (eWrite) { basisMcpLogError("write result " + cmd.id, eWrite); }
    basisMcpArchive(full, cmdFiles[i], envelope.status);
    basisMcpLog("info", "exec " + (cmd.op || "?") + " -> " + envelope.status + " (" + envelope.durationMs + " ms)");
    if (BASIS_MCP_STOP_REQUESTED) break;
  }
  basisMcpHeartbeat();
  return cmdFiles.length;
}

function basisMcpArchive(full, name, status) {
  var fs = basisMcpF();
  try {
    var stamp = new Date().toISOString().replace(/[:\.]/g, "-");
    fs.renameSync(full, BASIS_MCP_ROOT + "\\log\\processed\\" + stamp + "_" + status + "_" + name);
  } catch (e) {
    try { fs.unlinkSync(full); } catch (e2) { /* ignore */ }
  }
}

function basisMcpHeartbeat(modeOverride) {
  try {
    basisMcpWriteAtomic(BASIS_MCP_STATES + "\\heartbeat.json", JSON.stringify({
      ts: Date.now(),
      iso: new Date().toISOString(),
      workerVersion: BASIS_MCP_VERSION,
      mode: modeOverride || (BASIS_MCP_STOP_REQUESTED ? "stopping" : "worker"),
      modelFilename: basisMcpSafeStr(function () { return ModelFilename; }, null),
      processedTotal: BASIS_MCP_PROCESSED,
    }, null, 2));
  } catch (e) { basisMcpLogError("heartbeat", e); }
}

/* ------------------------------- bootstrap ------------------------------- */

basisMcpEnsureDirs(BASIS_MCP_INBOX);
basisMcpEnsureDirs(BASIS_MCP_OUTBOX);
basisMcpEnsureDirs(BASIS_MCP_STATES);
basisMcpEnsureDirs(BASIS_MCP_ROOT + "\\log\\processed");

var basisMcpStartedCount = 0;
try { basisMcpStartedCount = basisMcpPump(); } catch (ePump0) { basisMcpLogError("initial pump", ePump0); }

try {
  /* Button hint: "<circle> AI Active" (icon first, English text). */
  BASIS_MCP_BUTTON = NewButtonInput("\uD83D\uDFE2 AI Active");
  basisMcpLog("info", "button installed, id=" + (BASIS_MCP_BUTTON ? BASIS_MCP_BUTTON.id : "?"));
} catch (eBtn) {
  basisMcpLogError("button install", eBtn);
}

basisMcpWriteAtomic(BASIS_MCP_STATES + "\\worker-online.json", JSON.stringify({
  startedAt: new Date().toISOString(),
  workerVersion: BASIS_MCP_VERSION,
  initialQueue: basisMcpStartedCount,
  mode: BASIS_MCP_BUTTON ? "button" : "on-start-only",
}, null, 2));

basisMcpLog("info", "worker v" + BASIS_MCP_VERSION + " started; initial queue processed: " + basisMcpStartedCount + "; mode: " + (BASIS_MCP_BUTTON ? "button" : "on-start-only"));

/* GLOBAL move handler: the engine calls $move on mouse movement while the
 * script session is in the post-Continue input/interrupt mode. Used as a
 * lightweight throttled auto-pump - queued commands can execute WITHOUT
 * any button press: the user just moves the mouse in BASIS. */
function $move() {
  try {
    var now = Date.now();
    if (now - BASIS_MCP_LAST_MOVE_PUMP < 1500) return true;
    BASIS_MCP_LAST_MOVE_PUMP = now;
    basisMcpPump();
  } catch (eMove) {
    basisMcpLogError("$move", eMove);
  }
  return true;
}

function $input(id) {
  try {
    var isOurs = false;
    var btnId = "none";
    try { btnId = BASIS_MCP_BUTTON ? String(BASIS_MCP_BUTTON.id) : "none"; } catch (eId2) { btnId = "unreadable"; }
    try { isOurs = (BASIS_MCP_BUTTON && BASIS_MCP_BUTTON.id == id); } catch (eId) { isOurs = false; }
    basisMcpLog("info", "input event id=" + id + " btnId=" + btnId + " ours=" + isOurs);
    basisMcpHeartbeat("armed");
    if (isOurs) {
      try { basisMcpPump(); } catch (ePump) { basisMcpLogError("pump-click", ePump); }
      if (BASIS_MCP_STOP_REQUESTED) {
        basisMcpHeartbeat();
        basisMcpLog("info", "worker finished by stop command");
        return false; // end the input stage
      }
      return true; // keep listening
    }
    return true;
  } catch (e) {
    basisMcpLogError("$input", e);
    return true;
  }
}

basisMcpHeartbeat();

if (BASIS_MCP_STOP_REQUESTED) {
  basisMcpHeartbeat("stopped");
  basisMcpLog("info", "worker finished right after initial pump (stop was queued)");
  true;
} else {
  /* No startup alert: fewer clicks. Feedback = the BasisMCP button/hint
   * appearing in the status line + worker-log rows. */
  /* KEY LIVENESS STEP (documented old API): keep processing input events
   * after the main body ends. Without this the script exits and the
   * button becomes dead UI - exactly the bug of v0.3.0. */
  try {
    if (typeof Action !== "undefined" && Action && typeof Action.Continue === "function") {
      basisMcpLog("info", "arming via Action.Continue() (returns immediately); session stays alive");
      Action.Continue();
      basisMcpHeartbeat("armed");
      basisMcpLog("info", "armed: input events dispatch to $input while this session lives");
    } else {
      basisMcpLog("warn", "Action.Continue unavailable; relying on engine input stage");
    }

    /* v0.4.2 experiment: a timer scheduled INSIDE the armed session.
     * If the engine keeps intervals alive for a script that stays in the
     * input stage (unlike the old timer-bridge, which ended completely),
     * the queue will execute WITHOUT any user action. */
    try {
      BASIS_MCP_TIMER = setInterval(function () {
        try {
          BASIS_MCP_TICKS++;
          basisMcpPump();
          if (BASIS_MCP_TICKS % 15 === 0) {
            basisMcpLog("info", "timer tick " + BASIS_MCP_TICKS);
          }
        } catch (eTick) {
          basisMcpLogError("timer tick", eTick);
        }
      }, 2000);
      basisMcpLog("info", "session timer scheduled, tick 2000 ms");
    } catch (eTimer) {
      basisMcpLogError("timer setup", eTimer);
    }
  } catch (eCont) {
    basisMcpLogError("Action.Continue", eCont);
  }
}

true;
