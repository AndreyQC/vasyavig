import {Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";

/** Пустое состояние: ни один файл не открыт. */
export function EmptyState() {
  const {t} = useTranslation();
  return (
    <div className="empty-state">
      <Text variant="header-1">Vasyavig</Text>
      <Text variant="body-2" color="secondary" style={{marginTop: 8}}>
        {t("empty.hint")}
      </Text>
    </div>
  );
}
