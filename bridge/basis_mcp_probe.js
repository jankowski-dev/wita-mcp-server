/*
 * Basis MCP probe v2  (old-API edition for BASIS 2022.x)
 * ASCII-only file on purpose: the script engine reads sources in CP1251,
 * so any non-ASCII string literal would be corrupted.
 *
 * RUN: BASIS -> tab "Mebelshchik" -> menu "Scripts" -> click "basis_mcp_probe"
 * RESULT FILES (written ~immediately):
 *   C:\Users\Public\basis-mcp\states\probe2-result.json
 *   C:\Users\Public\basis-mcp\states\probe2-sample.json
 */
(function main() {
  var ROOT = "C:\\Users\\Public\\basis-mcp";
  var STATES = ROOT + "\\states";
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
  function writeAtomic(file, text) {
    var tmp = file + ".tmp";
    fs.writeFileSync(tmp, text, "utf8");
    try { fs.unlinkSync(file); } catch (e) { /* first write */ }
    fs.renameSync(tmp, file);
  }
  function safe(fn) {
    try { return { ok: true, value: fn() }; }
    catch (e) { return { ok: false, error: String(e) }; }
  }
  function safeQuiet(fn, fallback) {
    try { var v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; }
  }
  ensureDirs(STATES);

  var result = { probe: "v2", startedAt: new Date().toISOString() };

  /* 1. Model globals and file name */
  result.globals = {
    Model: typeof Model,
    ModelCountNotNull: safeQuiet(function () { return Model !== null; }, null),
    ModelFilename: safeQuiet(function () { return typeof ModelFilename === "undefined" ? null : String(ModelFilename); }, null),
    Action: typeof Action,
    ActiveMaterial: typeof ActiveMaterial,
    system: typeof system,
    systemExec: safeQuiet(function () { return system ? typeof system.exec : null; }, null),
    NewForm: typeof NewForm,
    NewVector: typeof NewVector,
    VectorGlobal: safeQuiet(function () { return Vector(1, 2, 3).x !== undefined || true; }, null),
    NewCOMObject: typeof NewCOMObject,
    alert: typeof alert,
    confirm: typeof confirm,
    prompt: typeof prompt,
  };

  /* 2. Model traversal surface */
  result.model = {
    count: safeQuiet(function () { return Model.Count; }, null),
    objectsType: safeQuiet(function () { return typeof Model.Objects; }, null),
    firstObject: (function () {
      var v = safeQuiet(function () { return Model.Objects[0]; }, undefined);
      if (v === undefined) return { present: false };
      var out = { present: true };
      out.name = safeQuiet(function () { return String(v.Name); }, null);
      out.furnType = safeQuiet(function () { return typeof v.FurnType === "string" ? v.FurnType : null; }, null);
      out.constructorName = safeQuiet(function () { return v.constructor && v.constructor.name ? String(v.constructor.name) : null; }, null);
      out.selectedProp = safeQuiet(function () { return typeof v.Selected; }, null);
      out.countProp = safeQuiet(function () { return typeof v.Count; }, null);
      return out;
    })(),
  };

  /* 3. Creation/deletion/edit functions (old API) */
  result.functions = {
    AddPanel: typeof AddPanel,
    AddFrontPanel: typeof AddFrontPanel,
    AddHorizPanel: typeof AddHorizPanel,
    AddVertPanel: typeof AddVertPanel,
    AddExtrusion: typeof AddExtrusion,
    AddTrajectory: typeof AddTrajectory,
    AddBlock: typeof AddBlock,
    AddAssembly: typeof AddAssembly,
    AddDraftBlock: typeof AddDraftBlock,
    DeleteObject: typeof DeleteObject,
    DeleteNewObjects: typeof DeleteNewObjects,
    StartEditing: typeof StartEditing,
    BeginBlock: typeof BeginBlock,
    EndBlock: typeof EndBlock,
    SelectAll: typeof SelectAll,
    UnSelectAll: typeof UnSelectAll,
    OpenFurniture: typeof OpenFurniture,
    GetPanel: typeof GetPanel,
    GetObject: typeof GetObject,
    NewMaterialInput: typeof NewMaterialInput,
    NewButtMaterialInput: typeof NewButtMaterialInput,
    NewFurnitureInput: typeof NewFurnitureInput,
  };

  /* 4. Selection enumeration candidates (read-only probes) */
  result.selection = {
    SelectedObj: safeQuiet(function () { return typeof Model.SelectedObj; }, null),
    Selected: safeQuiet(function () { return typeof Model.Selected; }, null),
    SelectionCount: safeQuiet(function () { return typeof Model.SelectionCount; }, null),
  };

  /* 5. Panel props: search first panel-like child and sample its fields */
  var panelSample = null;
  (function findPanel() {
    var n = safeQuiet(function () { return Model.Count; }, 0) || 0;
    for (var i = 0; i < n; i++) {
      var obj = safeQuiet(function () { return Model.Objects[i]; }, null);
      if (!obj) continue;
      var hasButts = safeQuiet(function () { return obj.Butts !== undefined; }, false);
      var hasContour = safeQuiet(function () { return obj.Contour !== undefined; }, false);
      if (hasButts && hasContour) {
        panelSample = {
          index: i,
          name: safeQuiet(function () { return String(obj.Name); }, null),
          materialName: safeQuiet(function () { return obj.MaterialName === undefined ? null : String(obj.MaterialName); }, null),
          materialWidth: safeQuiet(function () { return obj.MaterialWidth; }, null),
          thickness: safeQuiet(function () { return obj.Thickness; }, null),
          contourWidth: safeQuiet(function () { return typeof obj.ContourWidth === "number" ? obj.ContourWidth : null; }, null),
          contourHeight: safeQuiet(function () { return typeof obj.ContourHeight === "number" ? obj.ContourHeight : null; }, null),
          buttsCount: safeQuiet(function () { return obj.Butts && obj.Butts.Count; }, null),
        };
        return;
      }
    }
  })();
  result.panelSample = panelSample || { found: false, note: "no panel-like objects in current model" };

  /* 6. Runtime string encoding check: write back the model name read from the model */
  result.encoding = (function () {
    var modelName = safeQuiet(function () { return String(Model.Name); }, null);
    writeAtomic(STATES + "\\probe2-sample.json", JSON.stringify({ modelName: modelName, note: "if cyrillic ok here then runtime strings pass JSON correctly" }, null, 2));
    return { modelName: modelName, sampleFile: "states/probe2-sample.json" };
  })();

  /* 7. Node modules (short re-confirmation) */
  result.nodeModules = {
    fs: typeof require("fs"),
    os: typeof require("os"),
    path: typeof require("path"),
    http: typeof require("http"),
    child_process_available: typeof require("child_process") === "object",
  };

  /* 8. COM short re-check (creation only) */
  result.com = { xmlhttp: safe(function () { return NewCOMObject("MSXML2.XMLHTTP.6.0") ? "created" : "null"; }) };

  writeAtomic(STATES + "\\probe2-result.json", JSON.stringify(result, null, 2));

  alert("Basis MCP probe v2 complete.\nFile: C:\\Users\\Public\\basis-mcp\\states\\probe2-result.json\nModel count: " + (result.model.count === null ? "?" : result.model.count));
})();
