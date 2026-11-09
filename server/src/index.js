#!/usr/bin/env node
/**
 * Basis MCP — MCP-сервер для управления БАЗИС-Мебельщик.
 *
 * Архитектура: сервер (этот процесс) не имеет прямого доступа к API БАЗИС.
 * Внутри БАЗИС работает резидентный скрипт-мост (bridge/basis_mcp_bridge.js),
 * который обменивается с сервером командами через файловый «ящик»:
 *
 *   <ROOT>/inbox   — команды сервер -> БАЗИС (cmd_*.json, атомарная запись)
 *   <ROOT>/outbox  — результаты БАЗИС -> сервер (res_<id>.json)
 *   <ROOT>/states  — heartbeat моста, отчёт probe-скрипта
 *   <ROOT>/log     — журнал моста
 *
 * ROOT по умолчанию: C:\Users\Public\basis-mcp (переопределяется переменной BASIS_MCP_DIR,
 * значение должно совпадать на стороне моста).
 */
import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const ROOT = path.resolve(process.env.BASIS_MCP_DIR || "C:\\Users\\Public\\basis-mcp");
const INBOX = path.join(ROOT, "inbox");
const OUTBOX = path.join(ROOT, "outbox");
const STATES = path.join(ROOT, "states");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureDirs() {
  for (const dir of [ROOT, INBOX, OUTBOX, STATES]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/** Атомарная запись: сначала во временнй файл, затем переименование. */
async function writeAtomic(file, text) {
  const tmp = `${file}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rm(file, { force: true });
  await fs.rename(tmp, file);
}

async function readJsonSafe(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Отправка команды мосту и ожидание результата.
 * Мост после исполнения удаляет командный файл и пишет res_<id>.json.
 */
async function sendCommand(op, params = {}, timeoutMs = 15_000) {
  await ensureDirs();
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const cmdFile = path.join(INBOX, `cmd_${id}.json`);
  await writeAtomic(
    cmdFile,
    JSON.stringify({ id, op, params, sentAt: new Date().toISOString() }, null, 2),
  );

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(100);
    const result = await readJsonSafe(path.join(OUTBOX, `res_${id}.json`));
    if (result !== undefined) {
      await fs.rm(path.join(OUTBOX, `res_${id}.json`), { force: true });
      return result;
    }
  }

  // Таймаут: подскажем, что проверять. Команду убираем, чтобы не повисла навсегда.
  await fs.rm(cmdFile, { force: true });
  return {
    id,
    status: "timeout",
    error: `Worker не ответил за ${timeoutMs} мс.`,
    hint: "Worker не ответил — вероятно, его сессия завершилась (ESC / запуск другого скрипта / перезапуск БАЗИС). Попросите пользователя открыть меню «Скрипты» → 0_BasisMCP_worker (один клик, без диалогов): накопленная очередь исполнится сразу при старте. Диагностика — log/worker.log.",
  };
}

function text(result) {
  return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
}

const server = new McpServer({ name: "basis-mcp", version: "0.1.0" });

/* ------------------------------ инструменты ------------------------------ */

server.registerTool(
  "basis_probe_report",
  {
    title: "Отчёт probe-скрипта БАЗИС",
    description:
      "Читает отчёт диагностического скрипта (bridge/basis_mcp_probe.js), который запускается вручную в БАЗИС. " +
      "Отчёт показывает доступность Node-модулей, таймеров, COM, глобальных функций старого API и пример панели модели. " +
      "Если отчётов нет, вернёт инструкцию по запуску probe.",
    inputSchema: {},
  },
  async () => {
    let report = await readJsonSafe(path.join(STATES, "probe2-result.json"));
    if (!report) {
      report = await readJsonSafe(path.join(STATES, "probe-result.json"));
      if (report) report.probe = report.probeVersion ? "v1 (legacy)" : report.probe;
    }
    if (!report) {
      return text({
        status: "no-report",
        instruction:
          "Скопируйте bridge/basis_mcp_probe.js в папку скриптов БАЗИС (например C:\\Users\\<user>\\Documents\\Bazis2022\\Scripts\\), " +
          "откройте вкладку «Мебельщик», запустите скрипт из меню «Скрипты», подождите ~15 секунд и повторите вызов (probe ещё дописывает результаты теста таймера).",
      });
    }
    const timerTest = await readJsonSafe(path.join(STATES, "probe-timer.json"));
    const summary = {
      engine: report.newModules && Object.keys(report.newModules).every((k) => { const v = report.newModules[k]; return v === "undefined" || (v && v.error); })
        ? "old-api (BASIS 2022)"
        : "new-modules available",
      capabilities: {
        fs: !!report.modules?.fs,
        nodeModules: report.nodeModules ?? report.modules ?? null,
        timers: report.timers ?? null,
        com: report.com ?? null,
        legacyGlobals: report.globals ?? report.globalsLegacy ?? null,
        functions: report.functions ?? null,
        selectionSurface: report.selection ?? null,
        panelSample: report.panelSample ?? null,
        encoding: report.encoding ?? null,
        model: report.model ?? null,
      },
      timerSurvivalTest: timerTest ?? { note: "probe-timer.json появится, если ваш probe был v1; для v2 таймер уже подтверждён." },
    };
    return text({ status: "ok", summary, raw: report });
  },
);

server.registerTool(
  "basis_status",
  {
    title: "Статус моста БАЗИС",
    description:
      "Проверяет, жив ли резидентный мост внутри БАЗИС (heartbeat обновляется на каждом тике), и есть ли застрявшие команды.",
    inputSchema: {},
  },
  async () => {
    await ensureDirs();
    const heartbeat = await readJsonSafe(path.join(STATES, "heartbeat.json"));
    let ageMs = null;
    if (heartbeat?.ts) ageMs = Date.now() - Number(heartbeat.ts);
    const fresh = ageMs !== null && ageMs < 6000;
    const workerOnline = await readJsonSafe(path.join(STATES, "worker-online.json"));
    const mode = heartbeat?.mode ?? "unknown";
    let status, advice;
    if (fresh && (mode === "worker" || mode === "armed")) {
      status = "worker-listening";
      advice = "Worker в БАЗИС активен. Очередь исполняется автоматически (таймер 2 с) — нажимать ничего не нужно.";
    } else if (fresh) {
      status = "bridge-alive";
      advice = "Мост работает — можно слать команды через basis_execute.";
    } else if (workerOnline && mode !== "stopping") {
      status = "worker-idle-waiting";
      advice = `Worker запускался ${workerOnline.startedAt}, но не получал клика как минимум 6 сек. Пусть пользователь кликнет кнопку BasisMCP в статус-строке БАЗИС (справа от координат X/Y/Z) — очередь исполнится. Если кнопки не видно — перезапустить worker из меню «Скрипты» (backlog исполнится при старте).`;
    } else if (workerOnline && mode === "stopping") {
      status = "worker-stopping";
      advice = "Worker завершается — запустите его заново из меню «Скрипты».";
    } else {
      status = "not-running";
      advice = "Запустите worker в БАЗИС: меню «Скрипты» → basis_mcp_worker (файл из bridge/).";
    }
    let pendingCommands = 0;
    try {
      pendingCommands = (await fs.readdir(INBOX)).filter((f) => /^cmd_.*\.json$/.test(f)).length;
    } catch {
      /* каталог может отсутствовать */
    }
    return text({
      status,
      heartbeatAgeMs: ageMs,
      heartbeat,
      workerOnline,
      pendingCommands,
      root: ROOT,
      advice,
    });
  },
);

server.registerTool(
  "basis_execute",
  {
    title: "Выполнить команду в БАЗИС",
    description:
      "Отправляет команду резидентному worker'у в БАЗИС и ждёт результат. Worker исполняет очередь сам. " +
      "Если статус worker'а не listening (basis_status) — попросите пользователя запустить «Скрипты → 0_BasisMCP_worker». " +
      "На «unknown op» — тоже рестарт: worker старой версии. Операции (v0.6.1): ping, get_active_file, get_model_summary, " +
      "get_selection, object_info, list_materials, add_panel, set_panel_material, batch_set_material, rename_object, " +
      "delete_object (guard «Габаритная рамка» → force), add_cut, holes_info, object_move, resize_panel, copy_object, " +
      "enable_butt_picker, add_butt, open_furniture, mount_furniture, mount_scheme, edit_probe, model_commit, worker_stop.",
    inputSchema: {
      op: z.string().min(1).describe("Имя операции, например ping / get_model_summary / add_panel"),
      params: z.record(z.any()).optional().describe("Параметры операции"),
      timeoutMs: z.number().int().min(1000).max(120_000).optional().describe("Таймаут ожидания ответа, мс (по умолчанию 15000)"),
    },
  },
  async ({ op, params, timeoutMs }) => {
    const result = await sendCommand(op, params ?? {}, timeoutMs ?? 15_000);
    return text(result);
  },
);

server.registerTool(
  "basis_model_summary",
  {
    title: "Сводка модели БАЗИС",
    description:
      "Удобная обёртка над операцией get_model_summary: рекурсивный обход дерева модели (панели, блоки, фурнитура) краткой структуры.",
    inputSchema: {
      maxDepth: z.number().int().min(1).max(10).optional().describe("Глубина обхода (по умолчанию 4)"),
      includeSizes: z.boolean().optional().describe("Пытаться читать габариты панелей (по умолчанию true)"),
    },
  },
  async ({ maxDepth, includeSizes }) => {
    const result = await sendCommand(
      "get_model_summary",
      /* worker's own param name is includePanelInfo; includeSizes is the
       * tool alias kept for catalog compatibility */
      { maxDepth: maxDepth ?? 4, includePanelInfo: includeSizes ?? true },
      30_000,
    );
    return text(result);
  },
);

/* --------------------------------- запуск --------------------------------- */

async function main() {
  await ensureDirs();
  await server.connect(new StdioServerTransport());
  // MCP-сервер живёт, пока его держит клиент (OpenCode). Никакой собственной логики времени здесь не нужно.
}

main().catch((error) => {
  console.error("basis-mcp fatal:", error);
  process.exit(1);
});

fss.existsSync(ROOT); // прогрев пути для наглядных ошибок, если Public недоступен — detectable в логах клиентов
