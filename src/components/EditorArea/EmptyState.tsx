import {Button, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../../store/fileStore";

/**
 * Пустое состояние: ни один файл не открыт (план 20261028_004, D4) —
 * кнопки открытия файла/папки прямо здесь, без похода в сайдбар.
 */
export function EmptyState() {
  const {t} = useTranslation();
  const openFileDialog = useFileStore((s) => s.openFileDialog);
  const addFolder = useFileStore((s) => s.addFolder);

  return (
    <div className="empty-state">
      <Text variant="header-1">Vasyavig</Text>
      <Text variant="body-2" color="secondary" style={{marginTop: 8}}>
        {t("empty.hint")}
      </Text>
      <div className="empty-state__actions">
        <Button view="action" onClick={() => void openFileDialog()}>
          {t("empty.openFile")}
        </Button>
        <Button view="outlined" onClick={() => void addFolder()}>
          {t("empty.openFolder")}
        </Button>
      </div>
    </div>
  );
}
