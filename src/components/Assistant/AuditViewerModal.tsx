import {useMemo} from "react";
import {Button, Label, Modal, Text} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useAssistantStore} from "../../store/assistantStore";
import {auditLog} from "../../lib/agent/audit";

/**
 * Просмотр audit-лога (Phase 8.5, T3e; план 20261105_005, T3e-4): read-only
 * таблица последних записей прогона — время, операция, результат, модель,
 * путь, findings, masking-счётчики. Записи и так ограничены retain_runs;
 * значений сущностей в audit нет (D8) — смотреть нечего скрывать.
 */
export function AuditViewerModal() {
  const {t} = useTranslation();
  const open = useAssistantStore((s) => s.auditOpen);
  const close = useAssistantStore((s) => s.closeAudit);

  const entries = useMemo(() => [...auditLog.list()].reverse(), [open]);

  if (!open) return null;

  return (
    <Modal open onOpenChange={(value) => !value && close()}>
      <div className="audit-viewer">
        <div className="audit-viewer__head">
          <Text variant="header-2">{t("audit.title")}</Text>
          <Button view="flat" size="s" onClick={close}>
            {t("audit.close")}
          </Button>
        </div>
        <Text variant="caption-2" color="secondary">
          {t("audit.hint")}
        </Text>
        {entries.length === 0 ? (
          <Text variant="body-2" className="audit-viewer__empty">
            {t("audit.empty")}
          </Text>
        ) : (
          <div className="audit-viewer__list">
            {entries.map((entry) => (
              <div key={entry.id} className="audit-viewer__row">
                <span className="audit-viewer__time">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
                <span className="audit-viewer__op">{entry.operation}</span>
                <Label
                  theme={
                    entry.result === "ok" || entry.result === "applied"
                      ? "success"
                      : entry.result === "error"
                        ? "danger"
                        : "normal"
                  }
                >
                  {entry.result}
                </Label>
                {entry.model != null && <span className="audit-viewer__model">{entry.model}</span>}
                {entry.path != null && <span className="audit-viewer__path">{entry.path}</span>}
                {typeof entry.findings === "number" && (
                  <span className="audit-viewer__findings">
                    {t("audit.findings", {count: entry.findings})}
                  </span>
                )}
                {entry.masking != null && (
                  <span className="audit-viewer__masking">
                    {t("audit.masking", {
                      mode: entry.masking.mode,
                      confirmation: entry.masking.confirmation,
                      entities: entry.masking.entities,
                      counts: Object.entries(entry.masking.counts)
                        .map(([type, count]) => `${type}:${count}`)
                        .join(" ") || "-",
                    })}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
