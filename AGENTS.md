# AGENTS.md — инструкции для ИИ-агента

> Этот файл читается первым. Он описывает проект, критические факты о движке
> БАЗИС, правила безопасности и порядок работы. Не начинай работу без его
> прочтения; держи его в актуальном состоянии при изменениях.

## Что это

**wita-mcp-server** — MCP-сервер, через который ИИ-агент (OpenCode) управляет
САПР **БАЗИС-Мебельщик** (проверено на 2022.12.21): читает дерево модели,
создаёт/изменяет панели, кромку, крепёж, фурнитуру, пакетно меняет материалы.

Архитектура «файловый ящик»:

```
OpenCode ──MCP(stdio)── server/src/index.js
                                │  пишет cmd_<id>.json, читает res_<id>.json
                                ▼
             C:\Users\Public\basis-mcp\{inbox,outbox,states,log}
                                ▲
                                │  worker-скрипт внутри БАЗИС
                                │  (Documents\Bazis\Scripts\0_BasisMCP_worker.js)
```

## КРИТИЧЕСКИЕ ФАКТЫ (не нарушать)

1. **Исходники скриптов БАЗИС — только ASCII.** Движок читает `.js` как CP1251;
   кириллица в исходнике превращается в мусор. Русский текст собирай
   escape-последовательностями `\u0410...` во время выполнения. После любой
   правки `bridge/*.js` проверяй: `python -c "print(sum(1 for b in open(f,'rb').read() if b>127))"` → 0.
2. **Только старое API** (v1–v5 модули `currentFileData/objects3d/...` в 2022
   отсутствуют — ReferenceError). Проверенные функции: `Model`, `Action`,
   `NewButtonInput`, `NewButtMaterialInput`, `AddFrontPanel/AddHorizPanel/AddVertPanel`,
   `DeleteObject`, `OpenFurniture`, `BeginBlock/EndBlock`, `require('fs')` и т.п.
3. **Жизненный цикл worker'а**: скрипт вызывается из меню «Скрипты» →
   создаёт кнопку `🟢 AI Active` → `Action.Continue()` **возвращает управление
   сразу**, но сессия остаётся в режиме прерываний → `setInterval(2000)` внутри
   сессии исполняет очередь автоматически. Нажатия пользователя не нужны.
4. **Action.Commit()** обязателен после изменений: скриптовые объекты существуют
   как «новые объекты скрипта» и не попадают в дерево без коммита. Свойства
   задавай **до** коммита (после коммита обёртка объекта «перерождается»).
5. **Сессия умирает** при: перезапуске БАЗИС, ESC, запуске другого скрипта,
   интерактивном выборе материала в пикере. Восстановление: пользователь один раз
   запускает «Скрипты → 0_BasisMCP_worker»; **накопленная очередь исполняется
   сразу при старте** (initial pump) — команды не теряются.
6. **Порядок панелей в `Mount` важен**: `Mount(полка, боковина, ...)` центрует
   крепёж по толщине полки; обратный порядок сажает его на кромку. Петли:
   `Mount(боковина, дверь, 32, высота, 0)` (образец — `Редактируемая тумба.js`
   в папке скриптов пользователя). `MountScheme` — это схема крепежа на стык,
   НЕ петли.
7. **Белый список операций.** Произвольный код агент в БАЗИС не исполняет.
   Новая операция = правка `bridge/basis_mcp_worker.js` (обработчик в
   `BASIS_MCP_HANDLERS`) + перезапуск worker'а пользователем + документация в
   `docs/OPERATIONS.md`.

## Структура

| Путь | Назначение |
|---|---|
| `server/src/index.js` | MCP-сервер (stdio). Инструменты: `basis_status`, `basis_execute`, `basis_model_summary`, `basis_probe_report` |
| `bridge/basis_mcp_worker.js` | worker (деплой как `0_BasisMCP_worker.js`) |
| `bridge/basis_mcp_worker_stop.js` | стоп (деплой как `1_BasisMCP_stop.js`) |
| `bridge/basis_mcp_probe.js` | диагностика движка |
| `tools/install-worker.ps1` | установка скриптов в папку БАЗИС |
| `docs/` | архитектура, операции, уроки движка, workflow, правила проектирования |
| `research/NOTES.md` | живой журнал исследований и инцидентов |

## Связанные репозитории

| Репозиторий | Назначение |
|---|---|
| `wita-mcp-server` (этот) | «руки»: код MCP-сервера и worker'а |
| `wita-mcp-knowledge` | «правила и факты»: скиллы (`furniture-design`, `basis-mcp`, `basis-engine`, `wardrobe-generator`) + будущий RAG (`kb_search`) |

Скиллы подключаются в `opencode.json`:

```jsonc
{ "skills": ["C:\\path\\to\\wita-mcp-knowledge\\skills"] }
```

## Порядок работы агента

1. Прочитай `docs/ARCHITECTURE.md` и `docs/OPERATIONS.md`.
2. Перед операциями вызови `basis_status`; при `worker-idle-waiting/not-running`
   попроси пользователя запустить worker (одно действие).
3. Команды шли через `basis_execute` (Timeout 15–30 c; очередь исполняется
   таймером ~2 c). Батчи из десятков операций допустимы (проверено 100+ за тик).
4. После мутаций проверяй результат чтением (`basis_model_summary`/`object_info`).
5. Любые изменения движка фиксируй в `research/NOTES.md` и профильных docs.
6. Не сохраняй модель за пользователя; не удаляй чужие объекты без подтверждения.

## Проверка после клонирования на новом ПК

```powershell
cd server; npm install
# конфиг: скопировать opencode.example.json → opencode.json
#   и прописать АБСОЛЮТНЫЕ пути: node.exe и <repo>\server\src\index.js
# запустить БАЗИС → «Скрипты» → 0_BasisMCP_worker (после tools/install-worker.ps1)
# в OpenCode: basis_status → worker-listening; basis_execute ping → pong
```
