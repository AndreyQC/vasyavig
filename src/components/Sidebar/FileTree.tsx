import {Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";
import {RootSection} from "./RootSection";

/** Дерево workspace: секция на каждый корень (порядок = порядок добавления). */
export function FileTree() {
  const {t} = useTranslation();
  const roots = useFileStore((s) => s.roots);

  if (roots.length === 0) {
    return (
      <Text variant="body-2" color="secondary" className="file-tree__empty">
        {t("sidebar.emptyWorkspace")}
      </Text>
    );
  }

  return (
    <div className="file-tree">
      {roots.map((root) => (
        <RootSection key={root.path} root={root} />
      ))}
    </div>
  );
}
