# Операции (белый список)

Все операции вызываются через `basis_execute`:

```json
{ "op": "add_panel", "params": { "...": "..." }, "timeoutMs": 30000 }
```

`path` — массив имён/индексов от корня модели: `["S1-Side-L"]`, `[3]`, `["Шкаф", 0]`.
Имена регистрочувствительны.

## Чтение

| op | params | result |
|---|---|---|
| `ping` | — | `{pong, bridgeVersion, mode, modelFilename, modelCount}` |
| `get_active_file` | — | `{filename, modelCount}` |
| `get_model_summary` | `maxDepth` (default 4), `includePanelInfo` | дерево: узлы `{name, type, path, fields|material/thickness/contourWidth/contourHeight/butts, children[]}` |
| `get_selection` | — | `{selectedCount, items:[{path,name,type}]}` |
| `object_info` | `path` | `{name, position:{x,y,z}, gmax, gmin, width,height,depth}` |

## Запись

| op | params | result |
|---|---|---|
| `add_panel` | `orientation: front|horiz|vert`, `rect{x1,y1,x2,y2,depth}`, `name`, `materialName`, `thickness` | `{created, committed, name, material, thickness}` |
| `set_panel_material` | `path` или `name`, `materialName`, `thickness` | `{updated, committed, material}` |
| `rename_object` | `path`, `newName` | `{renamed, readback}` |
| `delete_object` | `path` | `{deleted, committed, path}` |
| `model_commit` | — | `{committed}` |
| `batch_set_material` | `materialName`, `fromMaterial?`, `dryRun?` | `{changedCount, skippedCount, errorCount, changed[]}` |

### Система координат add_panel (важно!)

Внутренние сигнатуры старого API:

- `AddFrontPanel(x1, y1, x2, y2, z)` — плоскость XY, глубина z.
- `AddHorizPanel(x1, z1, x2, z2, y)` — плоскость XZ, высота y.
- `AddVertPanel(z1, y1, z2, y2, x)` — плоскость YZ, положение x.

Worker принимает единый `rect` и передаёт аргументы по порядку. Практическое правило:

| orientation | rect.x1 | rect.y1 | rect.x2 | rect.y2 | depth |
|---|---|---|---|---|---|
| `front` | x1 | y1 | x2 | y2 | z |
| `horiz` | x1 | z1 | x2 | z2 | y (высота) |
| `vert`  | z1 | y1 | z2 | y2 | x (положение) |

## Кромка

| op | params | result |
|---|---|---|
| `enable_butt_picker` | — | создаёт `NewButtMaterialInput` (дефолт — первая кромка базы); идемпотентно |
| `set_butt_picker` | `material` | диагностика: попытки присвоить имя программно (Name/Material/MaterialName) |
| `add_butt` | `path`, `elem` (0..3 — элемент контура), `material: "__picked__"` | `{added, committed, butts, elem, readback}` |

`elem`: элементы контура против часовой стрелки от начала координат.
ХДФ/задняя стенка кромкой не оклеивается.

## Фурнитура

| op | params | result |
|---|---|---|
| `open_furniture` | `file` (абс. путь к `.f3d`) | `{opened, name, datumMode}` — объект хранится в сессии |
| `mount_furniture` | `mode: "plane"|"between"`, `panelPath`, `panelPath2?`, `x,y,z`, `angle?` | `{mounted, committed, readback}` |
| `mount_scheme` | `panelPath`, `panelPath2`, `position: Inside|Outside|Up|Down`, `x,y,z` | схема крепежа на стык (НЕ петли) |
| `furniture_reset` | — | сброс открытого `.f3d` |

Проверенные образцы:

```text
# петля: через боковину в дверь
OpenFurniture("…/Петля для накладной двери.f3d")
Mount(боковина, дверь, 32, высота, 0)

# конфирмат корпуса: через дно/верх в торец стойки
Mount(стойка, дно, x, y, z)

# конфирмат полки: полка ПЕРВОЙ, иначе сядет на кромку
Mount(полка, боковина, x, y, z)
```

## Служебные

| op | назначение |
|---|---|
| `worker_stop` | завершить сессию после текущего цикла |
| `enable_butt_picker` / `model_commit` | см. выше |

## Ошибки

`status: "error"` → `error.message` (+ stack). Частые причины: объект не найден по
path; неизвестная операция (старая версия worker'а — перезапустить); некорректный
параметр. Диагностика: `log/worker.log`.
