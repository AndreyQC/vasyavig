import {Button, Icon, Text} from "@gravity-ui/uikit";
import {Xmark} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import type {Finding} from "../../lib/agent/findings";

interface Props {
  findings: Finding[];
  docName: string | null;
  running: boolean;
  /** Пояснения модели (explain/keep) по findingId — Phase 8.3. */
  notes?: Record<string, string>;
  onClear: () => void;
}

/**
 * Findings детерминированной проверки (Phase 8.2): severity, ключ правила,
 * строка и сниппет. Правки — отдельными diff-карточками (8.3); здесь же —
 * пояснения модели для finding'ов без правки.
 */
export function FindingsList({findings, docName, running, notes, onClear}: Props) {
  const {t} = useTranslation();

  return (
    <div className="assistant-section assistant-findings">
      <div className="assistant-section__head">
        <Text variant="subheader-1">{t("assistant.findings.title")}</Text>
        <div className="assistant-section__head-actions">
          {findings.length > 0 && (
            <span className="assistant-count">{findings.length}</span>
          )}
          <Button view="flat" size="s" onClick={onClear} title={t("assistant.findings.clear")}>
            <Icon data={Xmark} size={14} />
          </Button>
        </div>
      </div>

      {docName && (
        <Text variant="caption-2" color="secondary" className="assistant-panel__path">
          {docName}
        </Text>
      )}

      {running ? (
        <Text variant="body-2" color="secondary">
          {t("assistant.findings.running")}
        </Text>
      ) : findings.length === 0 ? (
        <Text variant="body-2" color="secondary">
          {t("assistant.findings.empty")}
        </Text>
      ) : (
        <ul className="assistant-findings__list">
          {findings.map((finding) => (
            <li key={finding.id} className="assistant-finding">
              <span
                className={`assistant-finding__severity assistant-finding__severity--${finding.severity}`}
              >
                {t(`assistant.severity.${finding.severity}`)}
              </span>
              <div className="assistant-finding__body">
                <Text variant="body-2">
                  {t(finding.messageKey, finding.params ?? {})}
                </Text>
                {finding.line !== undefined && (
                  <Text variant="caption-2" color="secondary">
                    {t("assistant.findings.line", {line: finding.line})}
                  </Text>
                )}
                {finding.snippet && (
                  <code className="assistant-finding__snippet">{finding.snippet}</code>
                )}
                {notes?.[finding.id] && (
                  <Text variant="caption-2" color="secondary" className="assistant-finding__note">
                    {t("assistant.findings.note", {note: notes[finding.id]})}
                  </Text>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
