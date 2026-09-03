import {useEffect} from "react";
import {MarkdownEditorView, useMarkdownEditor} from "@gravity-ui/markdown-editor";
import {useEditorStore} from "../../store/editorStore";
import {useFileStore} from "../../store/fileStore";
import {spellcheckExtension} from "../../lib/spellcheckExtension";
import {preserveUrlsExtension} from "../../lib/preserveUrlsExtension";
import {anchorNavigationExtension} from "../../lib/anchorNavigationExtension";
import {imageSrcExtension} from "../../lib/imageSrcExtension";
import {combineExtensions} from "../../lib/combineExtensions";
import {registerEditor, unregisterEditor} from "../../lib/editorRegistry";
import {getParentDir} from "../../lib/utils";
import {resolveRoot} from "../../lib/roots";

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
      wysiwygConfig: {
        extensions: combineExtensions(
          spellcheckExtension(),
          preserveUrlsExtension(),
          anchorNavigationExtension(),
          // rootPath читается лениво — корни могут добавиться после файла
          imageSrcExtension(getParentDir(path), () => {
            const roots = useFileStore.getState().roots;
            return resolveRoot(path, roots)?.path ?? null;
          }),
        ),
      },
    },
    [path],
  );

  // editor-instance доступен кнопкам тулбара (phase 4)
  useEffect(() => {
    registerEditor(path, editor);
    return () => unregisterEditor(path);
  }, [editor, path]);

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

  // Синхронизация режима из store (переключается через ModeSwitcher).
  // split = редактор WYSIWYG + отдельная панель превью (рендерится снаружи).
  const mode = useEditorStore((s) => s.tabs.find((t) => t.path === path)?.mode ?? "wysiwyg");
  useEffect(() => {
    const editorMode = mode === "markup" ? "markup" : "wysiwyg";
    if (editor.currentMode !== editorMode) {
      editor.setEditorMode(editorMode, {emit: false});
    }
  }, [editor, mode]);

  // stickyToolbar=false: тулбар Gravity и так не уезжает (он сиблинг скроллера,
  // а не его содержимое), а sticky-измерения дёргаются на каждый resize/scroll
  // и являются главным подозреваемым пропадания панелей (спека layout-stability)
  return <MarkdownEditorView autofocus stickyToolbar={false} editor={editor} className="md-editor" />;
}
