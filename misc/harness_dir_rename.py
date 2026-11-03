#!/usr/bin/env python3
"""
Rename harness documentation directories and rewrite references.

Задача 20261102_940 (lm_hrdo_2): каталоги вида `_{каталог}_` переносятся на
`harness_{каталог}`. Скрипт делает ТОЛЬКО текстовую перезапись ссылок/путей;
сами каталоги переименовываются отдельно через `git mv` (см. ранбук плана).

- Переименование каталогов: git mv (вне этого скрипта), порядок в ранбуке.
- Перезапись ссылок: во всех текстовых файлах под root, кроме skip-каталогов
  (.git, node_modules, dist, vendor, src-tauri, ...), Taskfile.yml, файлов из
  SKIP_GLOBS и самого скрипта.
- Разделители путей: «/», «\» и «\\» (экранированные строки в TS/JSON) —
  составные пути вида `_docs_/_tasks_` переписываются для всех трёх форм.
- Fenced-блоки переписываются наравне с телом: живые инструкции (команды
  make/ls) тоже лежат в фенсах; от порчи карту уберегает self-skip.
- Байт-точная запись: перезаписываются только файлы с реальными заменами,
  без нормализации переводов строк и кодировки (UTF-8 strict, иначе binary).

Usage:
    python harness_dir_rename.py <root_dir>            # preview (default)
    python harness_dir_rename.py <root_dir> --apply    # выполнить замену
"""

import argparse
import fnmatch
import sys
from pathlib import Path

# Порядок важен: сначала длинные префиксы, catch-all _docs_ — последним.
# Разделители: «/» (posix), «\» (windows/markdown), «\\» (экранированные
# строки в TS/JSON — в исходнике два байта «\\»).
_SEPARATORS = (b"/", b"\\", b"\\\\")
_SUBDIRS = (b"checkpoints", b"tasks", b"plans", b"domains", b"phases", b"sessions")


def _build_rename_map() -> list[tuple[bytes, bytes]]:
    pairs: list[tuple[bytes, bytes]] = []
    for sep in _SEPARATORS:
        for sub in _SUBDIRS:
            pairs.append(
                (b"_docs_" + sep + b"_" + sub + b"_", b"harness_docs" + sep + b"harness_" + sub)
            )
        pairs.append((b"_docs_" + sep + b"_index", b"harness_docs" + sep + b"harness_index"))
    # опечаточный вариант без закрывающего подчёркивания (исторический мусор)
    pairs.append((b"_docs/_checkpoints_", b"harness_docs/harness_checkpoints"))
    # catch-all — последним
    pairs.append((b"_docs_", b"harness_docs"))
    pairs.append((b"_archives_", b"harness_archives"))
    return pairs


RENAME_MAP = _build_rename_map()

SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", "vendor", "targets", "src-tauri",
    ".venv", "__pycache__", ".idea", ".vscode", "output", "logs",
}
SKIP_FILES = {"Taskfile.yml"}
# Файлы, которые переписывать нельзя:
# - ранбук переименования: в командах старые пути — это сам объект переименования;
# - исторический скрипт первой миграции: его таблица соответствий — артефакт v1.
SKIP_GLOBS = ("20261103_001_harness-dir-rename_plan.md", "rename_docs_dirs.py")


def is_text(data: bytes) -> bool:
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def rewrite(data: bytes) -> tuple[bytes, int]:
    """Переписать все вхождения; вернуть (новые байты, число замен)."""
    changed = data
    total = 0
    for old, new in RENAME_MAP:
        n = changed.count(old)
        if n:
            changed = changed.replace(old, new)
            total += n
    return changed, total


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"нет каталога: {root}")
        return 2
    self_path = Path(__file__).resolve()

    files_total = 0
    files_hit: list[tuple[Path, int]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts[:-1]):
            continue
        if rel.name in SKIP_FILES or path.name in SKIP_FILES:
            continue
        if any(fnmatch.fnmatch(rel.name, g) for g in SKIP_GLOBS):
            continue
        if path == self_path:
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if not is_text(data):
            continue
        files_total += 1
        new, n = rewrite(data)
        if n:
            files_hit.append((path, n))
            if args.apply:
                path.write_bytes(new)

    verb = "ПЕРЕЗАПИСАНО" if args.apply else "найдено замен"
    print(f"просмотрено текстовых файлов: {files_total}")
    print(f"{verb}: {sum(n for _, n in files_hit)} в {len(files_hit)} файлах")
    for path, n in files_hit:
        print(f"  {n:4d}  {path.relative_to(root)}")
    if not args.apply:
        print("preview — ничего не изменено; применение: --apply")
    return 0


if __name__ == "__main__":
    sys.exit(main())
