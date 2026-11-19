# Аудит WITA MCP-стека — проект «Кухня» (WITA) — 19.11.2026

Аудит по статическому анализу репозиториев, срезам модели, документации и канону знаний.
Проект: кухня, **S1/S2 кухня (6 ящиков)**. Worker: v0.6.8. Модель: 121 объект.

---

## 1. Состояние

| Компонент | Состояние |
|---|---|
| Worker | v0.6.8 — deployed, push ✓ |
| Worker | остановлен (`worker-idle-waiting`) — следующий рестарт: «Скрипты» → `0_BasisMCP_worker` |
| Текущая модель | Кухня S1/S2 (Модель1.b3d), 121 объект (`fasteners_spec`, `summary`, `list_materials`) |
| Модель «Старая» (B1..B5, 215 объектов) | отложена (другой файл модели) |
| Факторы | Евровинт кронштейн: 102 + Петля/Полкодержатель/Штангодержатель HA10 |
| KB-индекс | 3358 фрагментов (GTV/Blum/AKS) + AGENTS table + OPERATIONS/STP |
| Тестовые вырезы | 3 на S1-D2-Bottom — почищены через `cut_delete` (F1 честно инцидентален) |

## 2. Геометрия ящиков (факты: `fasteners_spec` v0.6.8, positions)

Ящики (6): S1-D1/D2/D3, S2-D1/D2/D3 — идентичные:
- Bottom: 518 (W) × 400 (D)×?, Bottom ch=400; Front 518×200; SideL/R 400×200; Back 518×200; Facade: 544×246.
- Припуск фасадный: 26 (2 крома × 13 мм/сторону — facade ок, deltaW=26; facade pos−bottom pos = 13 мм).
- Двери Door-1..4: 596 (W), depth 2496, pos y≈2, z≈500 — TBD для STP.
- Метры: Полкодержатель (592, 2008, 100), Штангодержатель овальный HA10 N1 никель (1184, 1900, 250).
- ПММ: нет. Верхние: S1/S2-Top 1200×500×16 — TBD.

## 3. Проверки статус (Ф1 Ф2)

| Операция | Статус |
|---|---|
| set_pocket (rect/circle/round_rect), add_hole | ✅ green (S1-D2-Bottom: 3 cuts) |
| holes_info (cutList) | ✅ работает, читает имена |
| cut_delete | ✅ v0.6.7 (S1-D2-Bottom, 3 cut из 10.11 удалено; максимальный) |
| set_pocket на S1-D2-Back (P3) | ✅ + cuts и holes_info — чисто |
| fasteners_spec | ✅ green (D1/D2/D3 ×2, двери, метры) |
| set_chamfer/Rounding | — (P2) — есть Rounding/RoundingEx/Facet/Symmetry/Elastic на Contour |

## 4. Рекомендации (ответ на вопрос «что продвинуть в программе»)

1. **Модель S1/S2** — расшифровать/объединить данные (много "Полкодержатель"? метров?), схема присадки (ни для одной модели), межцентровое для ящиков?
2. **set_chamfer/round_edge** — П2, Contour.Rounding не полез? — probe: 1-суточный тест (k)* — [TODO]
3. **STP #1** — `docs/STP-MK1.md` (заполнен из fasteners_spec) — требует дополнения: петли/зазоры/спецификации кромки с базой-стандартами.
4. **Docs/AGENTS** — канона правил WITA (furniture-design, drawer-design, kitchen-design), OPERATIONS.md (v0.6.8).
5. **Xrefs** — сверка STP/ kitchen/ drawer/ hardware.

## 5. Источники

- WITA стандарты (есть) — замечания: Fasteners (13/сторона, система 32).
- KB: `skills/hardware-fasteners`, `docs/OPERATIONS.md`, `docs/STP-MK1.md`, `kb/sources/local-docs/gtv-encyclopedia-2018.txt`.
- Пользовательские стандарты — TBD по СТП (есть пример в NOTES).

## 6. Типичные ошибки (из прошлых проектов)

- Имена-дубликаты, длинные сессии (легирование рестартов).
- "Забытые батареи" — длительная работа без проверки `fasteners_spec`/резюме.
