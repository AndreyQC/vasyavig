import {useCallback} from "react";
import {useToaster} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../store/editorStore";
import {useUiStore} from "../store/uiStore";
import {getEditor} from "../lib/editorRegistry";
import {restoreCyrillicUrls} from "../lib/restoreCyrillicUrls";
import {applyTocInsert, applyTocReplace, buildTocPlan} from "../lib/generateToc";

/**
 * Инструменты MainToolbar для markdown-вкладок (phase 4–5):
 * «Восстановить ссылки» (%-кириллица + \_-escape) и генерация оглавления.
 * Правки применяются через editor.replace() — вкладка становится dirty,
 * сохранение остаётся за пользователем.
 */
export function useMarkdownTools(path: string) {
  const {t} = useTranslation();
  const toaster = useToaster();

  const applyToEditor = useCallback(
    (newText: string) => {
      const tab = useEditorStore.getState().tabs.find((x) => x.path === path);
      const editor = getEditor(path);
      if (!tab || !editor || newText === tab.content) return false;
      editor.replace(newText); // -> change -> store -> dirty
      return true;
    },
    [path],
  );

  const notify = useCallback(
    (message: string) => {
      toaster.add({name: "markdown-tools", content: message, autoHiding: 4000});
    },
    [toaster],
  );

  /** Кнопка «Восстановить ссылки»: %-декодирование + снятие \_-escape (phase 5). */
  const restoreUrls = useCallback(() => {
    const tab = useEditorStore.getState().tabs.find((x) => x.path === path);
    if (!tab) return;
    const {text, changedUrls} = restoreCyrillicUrls(tab.content);
    if (changedUrls === 0) {
      notify(t("tools.nothingToRestore"));
      return;
    }
    applyToEditor(text);
  }, [path, applyToEditor, notify, t]);

  /** Кнопка «Оглавление»: без существующего блока — сразу вставка, иначе модалка. */
  const startToc = useCallback(() => {
    const tab = useEditorStore.getState().tabs.find((x) => x.path === path);
    if (!tab) return;
    const plan = buildTocPlan(tab.content);
    if (!plan.list) {
      notify(t("tools.noHeadings"));
      return;
    }
    if (plan.tocHeadingLine === null) {
      applyToEditor(applyTocInsert(tab.content));
    } else {
      useUiStore.getState().setPendingTocPath(path);
    }
  }, [path, applyToEditor, notify, t]);

  /** Модалка: заменить существующий блок оглавления. */
  const tocReplace = useCallback(() => {
    const tab = useEditorStore.getState().tabs.find((x) => x.path === path);
    if (tab) applyToEditor(applyTocReplace(tab.content));
    useUiStore.getState().setPendingTocPath(null);
  }, [path, applyToEditor]);

  /** Модалка: вставить новый блок оглавления в начало. */
  const tocInsert = useCallback(() => {
    const tab = useEditorStore.getState().tabs.find((x) => x.path === path);
    if (tab) applyToEditor(applyTocInsert(tab.content));
    useUiStore.getState().setPendingTocPath(null);
  }, [path, applyToEditor]);

  const tocCancel = useCallback(() => {
    useUiStore.getState().setPendingTocPath(null);
  }, []);

  return {restoreUrls, startToc, tocReplace, tocInsert, tocCancel};
}
