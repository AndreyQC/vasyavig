import {useCallback, useMemo, useRef, useState} from "react";
import {useEditorStore, type EditorTab} from "../../store/editorStore";
import {useFileStore} from "../../store/fileStore";
import {getParentDir} from "../../lib/utils";
import {resolveRoot} from "../../lib/roots";
import {MarkdownEditor} from "./MarkdownEditor";
import {SplitPreview} from "./SplitPreview";

interface Props {
  tab: EditorTab;
}

const MIN_PREVIEW_WIDTH = 300;

/** Режим Split: слева редактор (WYSIWYG), справа превью. Разделитель — drag (идея §5.2). */
export function SplitView({tab}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(480);

  // контент из store: stable-ref find, обновляется по мере печати
  const content = useEditorStore((s) => s.tabs.find((t) => t.path === tab.path)?.content ?? tab.content);
  const roots = useFileStore((s) => s.roots);
  // корень файла для root-relative картинок (phase 5): самый глубокой корень
  const rootPath = useMemo(() => resolveRoot(tab.path, roots)?.path ?? null, [tab.path, roots]);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const onMouseMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const width = Math.min(
        Math.max(rect.right - ev.clientX, MIN_PREVIEW_WIDTH),
        rect.width * 0.8,
      );
      setPreviewWidth(width);
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div ref={containerRef} className="split-view">
      <div className="split-view__editor">
        <MarkdownEditor key={tab.path} path={tab.path} initialContent={tab.content} />
      </div>
      <div className="split-view__divider" onMouseDown={onDividerMouseDown} />
      <div className="split-view__preview" style={{width: previewWidth}}>
        <SplitPreview content={content} basePath={getParentDir(tab.path)} rootPath={rootPath} />
      </div>
    </div>
  );
}
