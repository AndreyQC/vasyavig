import {useFileStore} from "../../store/fileStore";
import {useUiStore} from "../../store/uiStore";
import {normalizeJoin} from "../../lib/utils";
import type {DocumentNode} from "../../lib/harnessGraph";

/**
 * Переход по узлу графа (план 20261028_001, D6): документ открывается
 * существующим путём `openFile` (вкладкой), главная панель переключается на
 * документ. Вкладка «Граф» остаётся открытой — возврат к графу одним кликом
 * по табу.
 */
export function openGraphDocument(repoRoot: string, node: DocumentNode): void {
  void useFileStore.getState().openFile(normalizeJoin(repoRoot, node.path));
  useUiStore.getState().setMainPane("doc");
}
