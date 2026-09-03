import {useMemo, useState} from "react";
import {Button} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {decodeRawDisplay, parseEml} from "../../lib/emlParser";

interface Props {
  /** Latin-1 транспортировка файла (read_file_latin1). */
  content: string;
}

/** Вкладка-просмотр письма .eml: «Разбор» (заголовки + text/plain) или «Исходник». */
export function EmlViewer({content}: Props) {
  const {t} = useTranslation();
  const [mode, setMode] = useState<"parsed" | "raw">("parsed");
  const parsed = useMemo(() => parseEml(content), [content]);
  const rawText = useMemo(() => decodeRawDisplay(content), [content]);

  const viewToggle = (
    <div className="eml-viewer__mode">
      <Button size="s" view={mode === "parsed" ? "outlined" : "flat"} onClick={() => setMode("parsed")}>
        {t("eml.viewParsed")}
      </Button>
      <Button size="s" view={mode === "raw" ? "outlined" : "flat"} onClick={() => setMode("raw")}>
        {t("eml.viewRaw")}
      </Button>
    </div>
  );

  if (mode === "raw") {
    return (
      <div className="eml-viewer">
        {viewToggle}
        <pre className="eml-viewer__body eml-viewer__body--raw">{rawText}</pre>
      </div>
    );
  }

  if (parsed.parseError) {
    return (
      <div className="eml-viewer">
        {viewToggle}
        <div className="eml-viewer__notice">{t("eml.parseError")}</div>
      </div>
    );
  }

  const rows: Array<[string, string]> = [
    [t("eml.from"), parsed.headers.from],
    [t("eml.to"), parsed.headers.to],
    [t("eml.cc"), parsed.headers.cc],
    [t("eml.subject"), parsed.headers.subject],
    [t("eml.date"), parsed.headers.date],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <div className="eml-viewer">
      {viewToggle}
      {rows.length > 0 && (
        <table className="eml-viewer__headers">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {parsed.textBody === null ? (
        <div className="eml-viewer__notice">{t("eml.noTextPart")}</div>
      ) : (
        <pre className="eml-viewer__body">{parsed.textBody}</pre>
      )}
    </div>
  );
}
