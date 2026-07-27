import {Text} from "@gravity-ui/uikit";

/** Пустое состояние: ни один файл не открыт. */
export function EmptyState() {
  return (
    <div className="empty-state">
      <Text variant="header-1">Vasyavig</Text>
      <Text variant="body-2" color="secondary" style={{marginTop: 8}}>
        Откройте папку и выберите Markdown/YFM файл
      </Text>
    </div>
  );
}
