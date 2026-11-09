# Операции (белый список)

worker v0.6.1. Все операции вызываются через `basis_execute`:

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
| `list_materials` | — | срез материалов всех панелей, кромок и вырезов: `{panelCount, objectCount, materials[{key,count}], edges[{material,thickness,width,count,key}], cuts{total,names}}` |
| `holes_info` | `path` | монтажные отверстия панели (диаметры/координаты/стороны) |

Серверный алиас `basis_model_summary(includeSizes)` — это тот же `get_model_summary`; параметр фактически всегда «включено» (worker проверяет только `includePanelInfo === false`).

**Верификация мутаций — только по `Position` и `ContourWidth/Height`** (probe v2):
`gmin/gmax` — локальные и после правок не пересчитываются. `Position` и размеры контура
отражают изменения достоверно. Контуры панелей всегда 0-based.

## Запись

| op | params | result |
|---|---|---|
| `add_panel` | `orientation: front|horiz|vert`, `rect{x1,y1,x2,y2,depth}`, `name`, `materialName`, `thickness` | `{created, committed, name, material, thickness}` |
| `set_panel_material` | `path` или `name`, `materialName`, `thickness` | `{updated, committed, material}` |
| `rename_object` | `path`, `newName` | `{renamed, readback}` |
| `delete_object` | `path`, `force?` | `{deleted, committed, path}` — «Габаритная рамка» удаляется только при `force: true` |
| `model_commit` | — | `{committed}` |
| `batch_set_material` | `materialName`, `fromMaterial?`, `dryRun?` | `{changedCount, skippedCount, errorCount, changed[]}` |
| `object_move` | `path`, `dx,dy,dz` | `{moved, marker, effective{x,y,z}, posBefore, posAfter}` — `Translate()`; верификация по дельте `Position` |
| `resize_panel` | `path`, `width?`, `height?`, `anchorX?`, `anchorY?` | `{resized, requested, before, after}` — `Contour.Clear()+AddRectangle()` от якоря (по умолчанию 0,0); авто-откат при провале |
| `copy_object` | `path`, `newName?`, `offset{dx,dy,dz}?`, `orientation?` | `{copied, strategy:"recreate", sourceGeo, after, buttsSkipped}` — пересоздание панели (см. примечание); но НЕ `Clone()` |
| `add_cut` | `path`, `name?` | вырез: именованный (`AddCut(name)`) либо анонимный (`Cuts.Add()`) |
| `add_cut` (геометрия) | `line{x1,y1,x2,y2}` | прямолинейная траектория |
| `add_cut` (мультипойнт) | `points: [[x,y],...]` (≥2) | траектория цепочкой сегментов `i → i+1` |
| `add_cut` (профиль) | `profile` (обязателен), `moveX?`, `moveY?` | профиль выреза (`Contour.Load`); результат: `{cut, committed, name, trajectory}` |

### delete_object и дубликаты имён

Поисковая выборка по имени (`path: ["Имя"]`) всегда возвращает **первый матч**, а в
дереве типовой кухни имён-дубликатов десятки (крепёж «Евровинт 6х50» и т.п.).
Удаление объекта → путь **индексами** из свежего `get_model_summary` (`[216]`).
Минимальный безопасный сценарий: summary → найти индекс → `delete_object` по нему.

### copy_object — recreate-стратегия (v0.6.1)

`Clone()` работает только до коммита: после `Commit()` клон в дереве не появляется
(батарея v0.6.0: Count 218→218, клона нет). Поэтому copy строится как
пересоздание:

1. Читаем источник: `Position`, `ContourWidth/Height`, `Thickness`, `MaterialName`.
2. Ориентация — параметр `orientation` явно, либо вывод по локальной оси
   толщины (z→front, y→horiz, x→vert).
3. Имя копии — `newName` или «источник + copy», суффиксы 2, 3, … до уникальности.
4. Офсет копии — `offset{dx,dy,dz}`, прибавляется к позиции; всё через `add_panel`.

Кромки (**butts**) в копию не переносятся — пока нет достоверного чтения стороны
(`elem`) из Butt-объекта. Кромку в копию добавлять отдельно: `add_butt`
(`__picked__`), сторона — по правилам дизайна из скилла `furniture-design`.

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
| `edit_probe` | диагностика движка на черновой панели (мутации + откаты, скан Schema Clone/Butt); чистит за собой |
| `enable_butt_picker` / `model_commit` | см. выше |

## Ошибки

`status: "error"` → `error.message` (+ stack). Частые причины: объект не найден по
path; неизвестная операция (старая версия worker'а — перезапустить); некорректный
параметр. Диагностика: `log/worker.log`.
