import {useEffect, useState} from "react";
import {collectHarnessRepoRoots, isHarnessRepoDir} from "../lib/harnessIndex";
import {normalizePath} from "../lib/roots";
import {useFileStore} from "../store/fileStore";

/**
 * Harness-репозитории в workspace (план 20261028_001): корень сам является
 * репозиторием (манифест или реестр) либо содержит репозиторий во вложенной
 * папке — тогда корень репо восстанавливается по найденному реестру.
 *
 * Пути возвращаются в исходном виде (для склейки с путями файлов), но
 * сравниваются нормализованно — один и тот же репозиторий не попадёт в
 * список дважды.
 */
export function useHarnessRepos(): string[] {
  const roots = useFileStore((s) => s.roots);
  const trees = useFileStore((s) => s.trees);
  const [repos, setRepos] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = new Map<string, string>();
      const add = (path: string) => {
        const key = normalizePath(path);
        if (!found.has(key)) found.set(key, path);
      };
      for (const root of roots) {
        if (await isHarnessRepoDir(root.path)) add(root.path);
        for (const nested of collectHarnessRepoRoots(trees[root.path] ?? [])) add(nested);
      }
      if (!cancelled) setRepos([...found.values()]);
    })();
    return () => {
      cancelled = true;
    };
  }, [roots, trees]);

  return repos;
}
