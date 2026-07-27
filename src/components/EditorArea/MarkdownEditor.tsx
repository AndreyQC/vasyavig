import {useEffect} from "react";
import {MarkdownEditorView, useMarkdownEditor} from "@gravity-ui/markdown-editor";
import {useEditorStore} from "../../store/editorStore";

interface Props {
  path: string;
  initialContent: string;
}

/**
 * Обёртка над Gravity UI Markdown Editor.
 * Компонент монтируется один раз на файл (key={path} снаружи) —
 * initialContent читается только при монтировании, дальше источник правды — store.
 */
export function MarkdownEditor({path, initialContent}: Props) {
  const editor = useMarkdownEditor(
    {
      preset: "full",
      md: {html: true, breaks: true, linkify: true},
      initial: {markup: initialContent, mode: "wysiwyg"},
      experimental: {preserveEmptyRows: true},
    },
    [path],
  );

  // change -> store (урок §5: состояние текста живёт в Zustand, не в компоненте)
  useEffect(() => {
    const onChange = () => {
      useEditorStore.getState().updateContent(path, editor.getValue());
    };
    editor.on("change", onChange);
    return () => {
      editor.off("change", onChange);
    };
  }, [editor, path]);

  // Синхронизация режима из store (переключается через ModeSwitcher)
  const mode = useEditorStore((s) => s.tabs.find((t) => t.path === path)?.mode ?? "wysiwyg");
  useEffect(() => {
    if (editor.currentMode !== mode) {
      editor.setEditorMode(mode, {emit: false});
    }
  }, [editor, mode]);

  return <MarkdownEditorView autofocus stickyToolbar editor={editor} className="md-editor" />;
}
