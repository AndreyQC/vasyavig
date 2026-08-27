import {Button, Icon, Text} from "@gravity-ui/uikit";
import {Xmark} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {useFileActions} from "../../hooks/useFileActions";

/** Горизонтальные табы открытых файлов: точка ● у «грязных», крестик закрытия. */
export function EditorTabs() {
  const {t} = useTranslation();
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const {requestCloseTab} = useFileActions();

  if (tabs.length === 0) return null;

  return (
    <div className="editor-tabs">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          className={`editor-tabs__tab${tab.path === activePath ? " editor-tabs__tab--active" : ""}`}
          title={tab.path}
        >
          <button type="button" className="editor-tabs__label" onClick={() => setActiveTab(tab.path)}>
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
      ))}
    </div>
  );
}
