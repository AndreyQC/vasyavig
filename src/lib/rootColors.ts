/**
 * Палитра цветов корней workspace (спека folder-colors).
 *
 * В workspace-файле и в сторе хранится ИМЯ цвета, не hex: конкретные оттенки
 * заданы CSS-переменными --root-tint-<name> / --root-accent-<name> отдельно
 * для light/dark тем (src/styles/root-colors.css) — двойная тема не ломается.
 */

/** 9 хроматических цветов палитры; серый в палитру не входит. */
export const ROOT_PALETTE = [
  "red",
  "orange",
  "amber",
  "lime",
  "teal",
  "cyan",
  "blue",
  "violet",
  "pink",
] as const;

export type PaletteColor = (typeof ROOT_PALETTE)[number];

/** Цвет корня; neutral — файлы вне корней, в палитру не входит. */
export type RootColor = PaletteColor | "neutral";

export interface RootInfo {
  path: string;
  color: PaletteColor;
}

/**
 * Авто-выдача цвета новому корню (design D3): первый свободный цвет палитры;
 * при исчерпании — с начала палитры (повтор уже используемого).
 */
export function pickNextColor(roots: readonly RootInfo[]): PaletteColor {
  const used = new Set(roots.map((r) => r.color));
  for (const color of ROOT_PALETTE) {
    if (!used.has(color)) return color;
  }
  return ROOT_PALETTE[roots.length % ROOT_PALETTE.length];
}

export function isPaletteColor(value: string): value is PaletteColor {
  return (ROOT_PALETTE as readonly string[]).includes(value);
}
