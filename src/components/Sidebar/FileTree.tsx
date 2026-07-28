import {Loader, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";
import {FileTreeNode} from "./FileTreeNode";

export function FileTree() {
  const {t} = useTranslation();
  const tree = useFileStore((s) => s.tree);
  const isLoadingTree = useFileStore((s) => s.isLoadingTree);
  const hasRoot = useFileStore((s) => s.rootPath !== null);

  if (!hasRoot) {
    return (
      <Text variant="body-2" color="secondary" className="file-tree__empty">
        {t("sidebar.noFolder")}
      </Text>
    );
  }

  if (isLoadingTree) {
    return <Loader size="m" className="file-tree__loader" />;
  }

  return (
    <div className="file-tree">
      {tree.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={0} />
      ))}
    </div>
  );
}
