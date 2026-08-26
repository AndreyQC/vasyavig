#!/usr/bin/env python3
"""
Rename directories and update references: -=Folder=- -> _folder_

- Renames matching directories (deepest first, with collision check).
- Rewrites references in ALL text files under root (not only inside renamed
  dirs), skipping .git, gitignored directories and binary files.
- .gitignore is updated as a regular text file (same substring replace).
- Byte-exact write-back: only files with actual replacements are rewritten,
  no newline or encoding normalization.

Usage:
    python rename_docs_dirs.py <root_dir>            # preview (default)
    python rename_docs_dirs.py <root_dir> --apply    # perform the rename

    python rename_docs_dirs.py "C:\\repos\\personal\\GITHUB\\vasyavig"
"""

import argparse
import os
import re
import sys
from pathlib import Path

# old_name -> new_name. Keys are canonical (lowercase); text replacement is
# case-insensitive (re.IGNORECASE), directory lookup uses os.path.normcase.
RENAME_MAP = {
    "-=checkpoints=-": "_checkpoints_",
    "-=phases=-": "_phases_",
    "-=tasks=-": "_tasks_",
    "-=docs=-": "_docs_",
}

# Path to this script (skipped during file rewriting)
SCRIPT_NAME = Path(__file__).resolve()

SKIP_DIRS = {".git","node_modules","targets"}
BINARY_SNIFF_BYTES = 8192


def norm_map() -> dict[str, tuple[str, str]]:
    """Case-insensitive lookup: normcase(old_name) -> (old_name, new_name)."""
    return {os.path.normcase(old): (old, new) for old, new in RENAME_MAP.items()}


def parse_gitignore(root: Path) -> set[str]:
    """Old dir names that are listed in .gitignore (any case, with or without /)."""
    gi = root / ".gitignore"
    if not gi.is_file():
        return set()
    lookup = norm_map()
    ignored = set()
    raw = gi.read_bytes().decode("utf-8", errors="replace")
    for line in raw.splitlines():
        name = line.strip().removeprefix("./").strip("/").rstrip("/")
        hit = lookup.get(os.path.normcase(name))
        if hit:
            ignored.add(hit[0])
    return ignored


def collect_dirs(root: Path) -> list[tuple[str, Path, str]]:
    """All matching dirs as (old_name, path, new_name), deepest first."""
    found = []
    lookup = norm_map()
    for dirpath, dirnames, _ in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for d in dirnames:
            hit = lookup.get(os.path.normcase(d))
            if hit:
                old, new = hit
                found.append((old, Path(dirpath) / d, new))
    found.sort(key=lambda item: len(item[1].parts), reverse=True)
    return found


def decode_text(data: bytes, path: Path) -> tuple[str, str] | None:
    """Decode text; returns (text, encoding) or None if binary/undecodable."""
    if b"\x00" in data[:BINARY_SNIFF_BYTES]:
        return None
    for enc in ("utf-8", "cp1251"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue
    print(f"  [skip] not utf-8/cp1251: {path}")
    return None


def replace_refs(text: str) -> tuple[str, int]:
    """Replace all RENAME_MAP patterns case-insensitively. Returns (new_text, replacement_count)."""
    total = 0
    for old, new in RENAME_MAP.items():
        pattern = re.compile(re.escape(old), re.IGNORECASE)
        text, count = pattern.subn(new, text)
        total += count
    return text, total


def rewrite_files(root: Path, gitignored: set[str], apply: bool) -> int:
    """Rewrite references in every text file under root. Returns file count."""
    ignored_nc = {os.path.normcase(n) for n in gitignored}
    changed_files = 0
    total_replacements = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIRS and os.path.normcase(d) not in ignored_nc
        ]
        for fname in filenames:
            path = Path(dirpath) / fname
            # Skip this script itself
            if path.resolve() == SCRIPT_NAME:
                continue
            data = path.read_bytes()
            decoded = decode_text(data, path)
            if decoded is None:
                continue
            text, enc = decoded
            new_text, count = replace_refs(text)
            if not count:
                continue
            rel = path.relative_to(root)
            marker = "would edit" if not apply else "edited"
            print(f"  {marker}: {rel}: {count} replacement(s)")
            if apply:
                path.write_bytes(new_text.encode(enc))
            changed_files += 1
            total_replacements += count
    print(f"\nFiles {'to edit' if not apply else 'edited'}: {changed_files}, "
          f"replacements: {total_replacements}")
    return changed_files


def rename_dirs(root: Path, dirs: list[tuple[str, Path, str]], apply: bool) -> None:
    for old, path, new in dirs:
        new_path = path.parent / new
        if new_path.exists():
            print(f"  [skip] target already exists: {new_path}")
            continue
        marker = "would rename" if not apply else "renamed"
        print(f"  {marker}: {path.relative_to(root)} -> {new}")
        if apply:
            path.rename(new_path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Rename -=Folder=- to __folder__ in files and directories."
    )
    parser.add_argument(
        "root", nargs="?", default=".", help="Root directory to process (default: current)"
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Actually write changes (without it the script only previews)."
    )
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        print(f"Error: not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    mode = "APPLY" if args.apply else "PREVIEW (dry run)"
    print(f"Processing: {root}\nMode: {mode}\n")

    # Parse .gitignore BEFORE any rewrite: it still lists the old names.
    gitignored = parse_gitignore(root)
    if gitignored:
        print(f"Gitignored dirs (old names): {sorted(gitignored)}\n")

    dirs = collect_dirs(root)
    if not dirs:
        print("No directories found to rename.")
        return
    print(f"Directories ({len(dirs)}):")
    for old, path, new in dirs:
        note = " [gitignored]" if old in gitignored else ""
        print(f"  {old} -> {new}{note}")
    print()

    rewrite_files(root, gitignored, apply=args.apply)
    rename_dirs(root, dirs, apply=args.apply)

    if args.apply:
        print("\nDone. Review with `git status` and commit the rename.")
    else:
        print("\nPreview only. Re-run with --apply to perform the rename.")


if __name__ == "__main__":
    main()
