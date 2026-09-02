import {useMemo} from "react";
import type {CSSProperties} from "react";
import {Button, Icon, Text} from "@gravity-ui/uikit";
import {Xmark} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {useFileStore} from "../../store/fileStore";
import {useFileActions} from "../../hooks/useFileActions";
import {resolveRoot} from "../../lib/roots";
import type {RootColor} from "../../lib/rootColors";

/**
 * Горизонтальные табы открытых файлов: точка ● у «грязных», крестик закрытия.
 * Фон вкладки — тинт цвета корня файла (вне корней — нейтральный серый),
 * активная вкладка — широкая рамка насыщенного цвета корня (спека folder-colors).
 * Цвет всегда производен от (путь → корень), в табах не хранится (design D2).
 */
export function EditorTabs() {
  const {t} = useTranslation();
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const roots = useFileStore((s) => s.roots);
  const {requestCloseTab} = useFileActions();

  // производная коллекция — useMemo, не селектор (урок §3)
  const colors = useMemo(() => {
    const map = new Map<string, RootColor>();
    for (const tab of tabs) {
      map.set(tab.path, resolveRoot(tab.path, roots)?.color ?? "neutral");
    }
    return map;
  }, [tabs, roots]);

  if (tabs.length === 0) return null;

  return (
    <div className="editor-tabs">
      {tabs.map((tab) => {
        const color = colors.get(tab.path) ?? "neutral";
        const style = {
          "--tint": `var(--root-tint-${color})`,
          "--accent": `var(--root-accent-${color})`,
        } as CSSProperties;
        return (
          <div
            key={tab.path}
            className={`editor-tabs__tab${tab.path === activePath ? " editor-tabs__tab--active" : ""}`}
            style={style}
            title={tab.path}
          >
            <button
              type="button"
              className={`editor-tabs__label${tab.preview ? " editor-tabs__label--preview" : ""}`}
              onClick={() => setActiveTab(tab.path)}
            >
              <Text variant="body-1" ellipsis>
                {tab.name}
              </Text>
              {tab.dirty && <span className="editor-tabs__dirty">●</span>}
            </button>
            <Button
              view="flat"
              size="s"
              className="editor-tabs__close"
              onClick={() => requestCloseTab(tab.path)}
              title={t("tabs.close")}
            >
              <Icon data={Xmark} size={12} />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
