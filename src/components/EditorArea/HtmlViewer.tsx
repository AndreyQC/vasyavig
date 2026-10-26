import {useMemo, useState} from "react";
import {Button} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {injectCspMeta} from "../../lib/htmlCsp";
import {MonacoViewer} from "./MonacoViewer";

interface Props {
  content: string;
  path: string;
  name: string;
}

/** Вкладка-просмотр HTML (спека html-viewer): «Просмотр» (песочница) / «Исходник». */
export function HtmlViewer({content, path, name}: Props) {
  const {t} = useTranslation();
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const sandboxedDoc = useMemo(() => injectCspMeta(content), [content]);

  const viewToggle = (
    <div className="html-viewer__mode">
      <Button size="s" view={mode === "rendered" ? "outlined" : "flat"} onClick={() => setMode("rendered")}>
        {t("html.viewRendered")}
      </Button>
      <Button size="s" view={mode === "source" ? "outlined" : "flat"} onClick={() => setMode("source")}>
        {t("html.viewSource")}
      </Button>
    </div>
  );

  if (mode === "source") {
    return (
      <div className="html-viewer">
        {viewToggle}
        <div className="html-viewer__source">
          <MonacoViewer content={content} path={path} />
        </div>
      </div>
    );
  }

  return (
    <div className="html-viewer">
      {viewToggle}
      <div className="html-viewer__frame-wrap">
        <iframe className="html-viewer__frame" srcDoc={sandboxedDoc} sandbox="" title={name} />
      </div>
    </div>
  );
}
