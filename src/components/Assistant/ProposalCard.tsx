import {useMemo} from "react";
import {Button, Icon, Text} from "@gravity-ui/uikit";
import {Check, Eye, FilePlus, FileText, PencilToLine, Xmark} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {proposalDiff, type Proposal} from "../../lib/agent/proposals";
import {useAgentStore} from "../../store/agentStore";
import {useEditorStore} from "../../store/editorStore";
import {useUiStore} from "../../store/uiStore";

interface Props {
  proposal: Proposal;
}

function iconFor(proposal: Proposal) {
  if (proposal.kind === "create") return FilePlus;
  return proposal.kind === "replace" ? PencilToLine : FileText;
}

/**
 * Карточка предложения (Phase 8.2): diff, rationale, «Применить»/«Отклонить».
 * Применение — только по кнопке; auto-apply нет. Правка идёт в буфер, вкладка
 * становится dirty, на диск сохраняет пользователь.
 */
export function ProposalCard({proposal}: Props) {
  const {t} = useTranslation();
  const diff = useMemo(() => proposalDiff(proposal), [proposal]);
  const applying = useAgentStore((s) => s.applyingProposalId === proposal.id);
  const apply = useAgentStore((s) => s.applyProposalById);
  const reject = useAgentStore((s) => s.rejectProposal);
  const clear = useAgentStore((s) => s.clearProposal);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);

  const pending = proposal.status === "pending";
  const closed = proposal.status === "applied" || proposal.status === "rejected" || proposal.status === "stale";

  return (
    <div className={`assistant-proposal assistant-proposal--${proposal.status}`}>
      <div className="assistant-proposal__head">
        <Icon data={iconFor(proposal)} size={15} />
        <div className="assistant-proposal__title">
          <Text variant="subheader-1">{t(`assistant.proposals.kind.${proposal.kind}`)}</Text>
          <Text variant="caption-2" color="secondary" className="assistant-panel__path">
            {proposal.relativePath}
          </Text>
        </div>
        <span className={`assistant-proposal__status assistant-proposal__status--${proposal.status}`}>
          {t(`assistant.proposals.status.${proposal.status}`)}
        </span>
      </div>

      {proposal.rationale && (
        <Text variant="body-2" className="assistant-proposal__rationale">
          {proposal.rationale}
        </Text>
      )}

      <pre className="assistant-diff">
        {diff.lines.map((line, index) => (
          <div
            key={`${index}-${line.type}`}
            className={`assistant-diff__line assistant-diff__line--${line.type}`}
          >
            {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
            {line.text}
          </div>
        ))}
      </pre>
      {diff.truncated && (
        <Text variant="caption-2" color="secondary">
          {t("assistant.proposals.diffTruncated")}
        </Text>
      )}

      <div className="assistant-proposal__actions">
        {pending && (
          <>
            <Button
              view="action"
              size="s"
              disabled={applying}
              onClick={() => void apply(proposal.id)}
            >
              <Icon data={Check} size={14} />
              {t("assistant.proposals.apply")}
            </Button>
            <Button view="flat" size="s" onClick={() => reject(proposal.id)}>
              <Icon data={Xmark} size={14} />
              {t("assistant.proposals.reject")}
            </Button>
          </>
        )}
        {proposal.kind !== "create" && (
          <Button
            view="flat"
            size="s"
            onClick={() => {
              useUiStore.getState().setMainPane("doc");
              setActiveTab(proposal.path);
            }}
          >
            <Icon data={Eye} size={14} />
            {t("assistant.proposals.show")}
          </Button>
        )}
        {closed && (
          <Button view="flat" size="s" onClick={() => clear(proposal.id)}>
            {t("assistant.proposals.dismiss")}
          </Button>
        )}
      </div>

      {proposal.status === "applied" && (
        <Text variant="caption-2" color="secondary">
          {t("assistant.proposals.appliedHint")}
        </Text>
      )}
    </div>
  );
}
