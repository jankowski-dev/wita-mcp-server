# Установка WITA MCP Server и скиллов

Пошаговая инструкция для нового ПК (Windows + БАЗИС-Мебельщик + OpenCode).

## 0. Требования

| Компонент | Версия / примечание |
|---|---|
| Windows | 10/11 |
| БАЗИС-Мебельщик | проверено на 2022.12.21 (сборка 36090) |
| Node.js | ≥ 18 (проверено на 22.17.0), `node.exe` в PATH |
| OpenCode | V2 (конфиг `opencode.json`, секция `mcp.servers`) |
| Git | для клонирования и обновлений |

## 1. Клонирование

```powershell
cd C:\Tools          # или любая удобная папка
git clone https://github.com/jankowski-dev/wita-mcp-server.git
git clone https://github.com/jankowski-dev/wita-mcp-knowledge.git
```

> `wita-mcp-server` — код («руки»), `wita-mcp-knowledge` — скиллы («правила»).
> Скиллы опциональны, но без них агент не знает правил проектирования.

## 2. Установка MCP-сервера

```powershell
cd C:\Tools\wita-mcp-server\server
npm install
```

Проверка синтаксиса и запуска (сервер работает по stdio, поэтому «просто
запустить» его в консоли не получится — это нормально):

```powershell
node --check src\index.js
```

## 3. Установка скриптов в БАЗИС

```powershell
cd C:\Tools\wita-mcp-server
powershell -ExecutionPolicy Bypass -File tools\install-worker.ps1
```

Скрипт найдёт `%USERPROFILE%\Documents\Bazis*\Scripts` и скопирует:

| Файл | Имя в папке БАЗИС |
|---|---|
| `bridge/basis_mcp_worker.js` | `0_BasisMCP_worker.js` |
| `bridge/basis_mcp_worker_stop.js` | `1_BasisMCP_stop.js` |
| `bridge/basis_mcp_probe.js` | `basis_mcp_probe.js` |

Ручной вариант — скопировать эти три файла в папку скриптов под указанными именами.

## 4. Конфигурация OpenCode

Создайте `opencode.json` в корне рабочего проекта (не в репозитории — файл
машинно-зависимый). Образец — `opencode.example.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "basis": {
        "type": "local",
        "command": [
          "C:\\Program Files\\nodejs\\node.exe",
          "C:\\Tools\\wita-mcp-server\\server\\src\\index.js"
        ],
        "environment": {
          "BASIS_MCP_DIR": "C:\\Users\\Public\\basis-mcp"
        }
      }
    }
  },
  "skills": ["C:\\Tools\\wita-mcp-knowledge\\skills"]
}
```

Правила:

- **Пути к командам — только абсолютные.** Относительные OpenCode V2 не
  поддерживает (проверено: сервер не стартует).
- `BASIS_MCP_DIR` — каталог файлового обмена; значение должно совпадать с тем,
  что использует worker (по умолчанию `C:\Users\Public\basis-mcp`).
- `skills` — необязательный массив; можно указать каталог скиллов (как выше),
  либо установить их глобально (см. п. 5).

## 5. Установка скиллов (варианты)

**Вариант А (рекомендуется) — подключить каталог** строкой `skills` в
`opencode.json` (п. 4). Обновления = `git pull` в `wita-mcp-knowledge`.

**Вариант Б — глобально на ПК:**

```powershell
cd C:\Tools\wita-mcp-knowledge
powershell -ExecutionPolicy Bypass -File install.ps1
```

Копирует скиллы в `%USERPROFILE%\.config\opencode\skills` — доступны во всех
проектах. Обновление: `git pull` + повторный запуск `install.ps1`.

## 5a. RAG-сервер базы знаний (`kb`)

```powershell
cd C:\Tools\wita-mcp-knowledge\kb-server
npm install
node fetch-docs.js
npm run index
```

- `fetch-docs.js` скачивает официальные руководства БАЗИС (PDF/HTML) и статью
  SAPR.ru в `kb/sources/local-docs/` (локально, в `.gitignore`).
- Модель эмбеддингов `Xenova/multilingual-e5-small` скачивается один раз (~120 МБ).
- Индексируются `skills/` и `kb/sources/` (см. `kb/kb.config.json`).
- Дополнительные каталоги: `npm run index -- --extra "C:/path/to/docs"`.
- Подключение в `opencode.json` — сервер `kb` (см. `opencode.example.json`).
- Инструменты: `kb_search(query, topK)`, `kb_stats()`.
- Индекс: `kb/index/index.json` (в `.gitignore`); после переиндексации
  перезапустить MCP-сервер (`/reload`) или OpenCode.

## 6. Первый запуск

1. Откройте БАЗИС-Мебельщик, вкладку «Мебельщик», модель.
2. Меню **«Скрипты» → `0_BasisMCP_worker`** (первый пункт, без диалогов).
   В статус-строке появится кнопка `🟢 AI Active`.
3. В OpenCode перезапустите/перезагрузите конфиг (`/reload` или restart).
4. Проверка:

```text
basis_status          → status: "worker-listening", свежий heartbeat
basis_execute ping    → { pong: true }
basis_model_summary   → дерево открытой модели
```

## 7. Проверка скиллов

- В списке доступных скиллов должны быть: `furniture-design`, `basis-mcp`,
  `basis-engine`, `wardrobe-generator`.
- Явная проверка: попросите агента «загрузи скилл furniture-design».
- Если скиллов нет: проверьте путь в `skills`, наличие `SKILL.md` в каждой папке,
  перезапустите OpenCode. Диагностика описана в документации OpenCode V2 (Skills).

## 8. Обновление

```powershell
cd C:\Tools\wita-mcp-server && git pull
cd C:\Tools\wita-mcp-knowledge && git pull
powershell -ExecutionPolicy Bypass -File C:\Tools\wita-mcp-server\tools\install-worker.ps1
```

После обновления worker'а — перезапустить его в БАЗИС (старая сессия работает на
старом коде). После обновления скиллов при варианте А ничего делать не нужно
(каталог читается напрямую); при варианте Б — повторить `install.ps1`.
Сервер MCP перезапускается вместе с OpenCode.

## 9. Диагностика

| Проблема | Причина | Решение |
|---|---|---|
| `MCP server "basis" is not available` | сервер не стартовал | проверить `node --check`, пути в `opencode.json` (абсолютные!), перезапустить OpenCode |
| `basis_status` = `not-running` | worker не запущен | «Скрипты» → `0_BasisMCP_worker` |
| `worker-idle-waiting` | сессия уснула (ESC/другой скрипт) | перезапустить worker |
| `timeout` у `basis_execute` | worker мёртв / модальный диалог | закрыть диалог, перезапустить worker |
| `unknown op` | старая версия worker'а | перезапустить worker |
| Скиллы не видны | неверный путь/нет `SKILL.md` | проверить конфиг, перезапустить OpenCode |
| Кириллица в скриптах повреждена | правило ASCII нарушено | исходники `bridge/*.js` — только ASCII (движок CP1251) |

Журнал worker'а: `C:\Users\Public\basis-mcp\log\worker.log`.
