import "../../lib/monacoSetup";
import Editor from "@monaco-editor/react";
import {useThemeValue} from "@gravity-ui/uikit";
import {getMonacoLanguage} from "../../lib/utils";

interface Props {
  content: string;
  path: string;
}

/** Read-only просмотр текстовых файлов с подсветкой синтаксиса (идея §4.2.3). */
export function MonacoViewer({content, path}: Props) {
  const themeValue = useThemeValue();

  return (
    <Editor
      height="100%"
      path={path}
      language={getMonacoLanguage(path)}
      value={content}
      theme={themeValue === "dark" ? "vs-dark" : "vs"}
      options={{
        readOnly: true,
        minimap: {enabled: false},
        wordWrap: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
    />
  );
}
