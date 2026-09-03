import "../../lib/monacoSetup";
import Editor from "@monaco-editor/react";
import {useThemeValue} from "@gravity-ui/uikit";
import {getMonacoLanguage} from "../../lib/utils";

interface Props {
  content: string;
  path: string;
  /** Редактируемый режим (text-вкладки); по умолчанию — read-only просмотр. */
  editable?: boolean;
  onChange?: (value: string) => void;
}

/** Monaco: подсветка по расширению; read-only viewer или редактор (идея §4.2.3). */
export function MonacoViewer({content, path, editable = false, onChange}: Props) {
  const themeValue = useThemeValue();

  return (
    <Editor
      height="100%"
      path={path}
      language={getMonacoLanguage(path)}
      value={content}
      theme={themeValue === "dark" ? "vs-dark" : "vs"}
      onChange={editable ? (value) => onChange?.(value ?? "") : undefined}
      options={{
        readOnly: !editable,
        minimap: {enabled: false},
        wordWrap: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
    />
  );
}
