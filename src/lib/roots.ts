import type {RootInfo} from "./rootColors";

/**
 * Резолвинг путей по корням workspace (design D2): чистые функции, без стора.
 * Обе стороны сравнения проходят через normalizePath (Windows: `\` vs `/`,
 * регистр букв) — иначе матринг префиксов и события watcher'а ломаются.
 */

/** Канонизация пути для сравнения: `/`-разделители, без хвостового слэша, нижний регистр. */
export function normalizePath(path: string): string {
  let s = path.replace(/\\/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s.toLowerCase();
}

/** path лежит внутри root (или совпадает с ним) с границей разделителя. */
function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root + "/");
}

/**
 * Корень, которому принадлежит путь: самое длинное совпадение префикса
 * (наиболее глубокой корень). Вне корней — null (файл получит neutral).
 */
export function resolveRoot(path: string, roots: readonly RootInfo[]): RootInfo | null {
  const np = normalizePath(path);
  let best: RootInfo | null = null;
  let bestLen = -1;
  for (const root of roots) {
    const nr = normalizePath(root.path);
    if (nr.length > bestLen && isWithin(np, nr)) {
      best = root;
      bestLen = nr.length;
    }
  }
  return best;
}

/**
 * Пути, которые потеряют свой корень при удалении removingPath: файл относится
 * к удаляемому корню и НЕ остаётся внутри другого (вложенного) корня.
 */
export function pathsLosingRoot(
  paths: readonly string[],
  roots: readonly RootInfo[],
  removingPath: string,
): string[] {
  const remaining = roots.filter((r) => r.path !== removingPath);
  return paths.filter((p) => {
    const owner = resolveRoot(p, roots);
    return owner?.path === removingPath && resolveRoot(p, remaining) === null;
  });
}
