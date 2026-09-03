import type {useMarkdownEditor} from "@gravity-ui/markdown-editor";

export type EditorInstance = ReturnType<typeof useMarkdownEditor>;

/**
 * Реестр живых editor-instances по пути вкладки. Нужен, чтобы кнопки тулбара
 * (восстановление кириллицы, оглавление) применяли правки через editor.replace()
 * снаружи MarkdownEditor (phase 4, план §2.5).
 */
const registry = new Map<string, EditorInstance>();

export function registerEditor(path: string, editor: EditorInstance): void {
  registry.set(path, editor);
}

export function unregisterEditor(path: string): void {
  registry.delete(path);
}

export function getEditor(path: string): EditorInstance | null {
  return registry.get(path) ?? null;
}
