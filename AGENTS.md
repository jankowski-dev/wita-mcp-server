# AGENTS.md — контракт для ИИ-агента

> Читается первым. Здесь — только карта, правила загрузки и заповеди.
> **Детали — в скиллах** (единственный источник истины), см. таблицу ниже.

## Экосистема: два репозитория

| Репозиторий | Роль | Что внутри |
|---|---|---|
| **`wita-mcp-server`** (этот) | «руки» | MCP-сервер, worker-скрипт, технические доки |
| **`wita-mcp-knowledge`** | «правила» | скиллы агента + будущий RAG (`kb_search`) |

Схема: `OpenCode ↔ MCP (server/src/index.js) ↔ файловый ящик C:\Users\Public\basis-mcp ↔ worker в БАЗИС`.

## Скиллы — загружай перед работой

Подключение: `opencode.json` → `"skills": ["<путь>\\wita-mcp-knowledge\\skills"]`
(или глобально через `install.ps1`).

| ID | Когда обязательно загрузить |
|---|---|
| `basis-engine` | **перед любой правкой `bridge/*.js`** и при отладке поведения движка |
| `basis-mcp` | перед серией MCP-операций, при восстановлении worker'а, добавлении операций |
| `furniture-design` | перед проектированием/проверкой мебели |
| `wardrobe-generator` | при генерации шкафа по параметрам |

Если скиллы ещё не подключены — детали лежат в `docs/ENGINE-NOTES.md`,
`docs/OPERATIONS.md`, `docs/DESIGN-RULES.md` (мирроры).

## Заповеди (детали — в скиллах)

1. **Исходники `bridge/*.js` — строго ASCII** (движок CP1251); кириллица — через
   `\uXXXX` в рантайме → `basis-engine`.
2. **Только старое JS-API** (v5-модули в 2022 отсутствуют) → `basis-engine`.
3. **Worker**: `Action.Continue()` не блокирует; `setInterval(2000)` исполняет
   очередь; сессию убивают ESC/чужой скрипт/перезапуск; backlog не теряется →
   `basis-mcp`, `basis-engine`.
4. **`Action.Commit()`** после мутаций; свойства — до коммита → `basis-engine`.
5. **Порядок панелей в `Mount` важен** (полка/дверь первыми); `MountScheme` — не
   петли → `basis-engine`, `furniture-design`.
6. **Только белый список операций**; новая операция = bridge-обработчик + рестарт
   worker'а + доки → `basis-mcp`.
7. **Не сохранять модель за пользователя; не удалять чужие объекты без
   подтверждения.**

## Структура

| Путь | Назначение |
|---|---|
| `server/src/index.js` | MCP-сервер: `basis_status`, `basis_execute`, `basis_model_summary`, `basis_probe_report` |
| `bridge/basis_mcp_worker.js` | worker (деплой: `0_BasisMCP_worker.js`) |
| `bridge/basis_mcp_worker_stop.js` | стоп (деплой: `1_BasisMCP_stop.js`) |
| `bridge/basis_mcp_probe.js` | диагностика движка |
| `tools/install-worker.ps1` | установка скриптов в папку БАЗИС |
| `opencode.example.json` | шаблон конфигурации (MCP + skills, абсолютные пути) |
| `docs/INSTALL.md` | полная установка (MCP + worker + скиллы) |
| `docs/` | ARCHITECTURE, OPERATIONS, ENGINE-NOTES, WORKFLOW, DESIGN-RULES (миррор) |
| `research/NOTES.md` | живой журнал исследований и инцидентов |

## Порядок работы

1. Определи тип задачи → загрузи скиллы (таблица выше).
2. `basis_status`; если worker не запущен — попроси пользователя запустить
   («Скрипты» → `0_BasisMCP_worker`, одно действие).
3. Операции — через `basis_execute`; батчи десятков команд нормальны (тик ~2 с).
4. После мутаций — проверка чтением (`basis_model_summary`/`object_info`).
5. Изменения движка — в `research/NOTES.md` + docs; изменения правил — в скиллах
   репозитория знаний (канон), затем при необходимости в миррор `DESIGN-RULES.md`.

## Установка на новом ПК

Полная инструкция — **`docs/INSTALL.md`**. Кратко:

```powershell
cd server; npm install
powershell -ExecutionPolicy Bypass -File ..\tools\install-worker.ps1
# opencode.json: mcp.servers.basis (абсолютные пути) + "skills": ["...\\wita-mcp-knowledge\\skills"]
# БАЗИС → «Скрипты» → 0_BasisMCP_worker
# OpenCode: basis_status → worker-listening; basis_execute ping → pong
```
