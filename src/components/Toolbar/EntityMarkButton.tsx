import {useEffect, useState} from "react";
import {Button, Icon, Popover, Tooltip} from "@gravity-ui/uikit";
import {PersonPencil} from "@gravity-ui/icons";
import {useToaster} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useEditorStore} from "../../store/editorStore";
import {useSelectionStore} from "../../store/selectionStore";
import {getParentDir} from "../../lib/utils";
import {markSelectionAsEntity} from "../../lib/vasEntityExtension";
import {ensureEntitiesIndex, matchEntityEntry, type EntityIndexEntry} from "../../lib/entitiesIndex";
import {generateUlid} from "../../lib/agent/masking/ulid";
import type {EntityType} from "../../lib/agent/masking/types";

const ENTITY_TYPES: readonly EntityType[] = [
  "PERSON",
  "ORG",
  "LOC",
  "SECRET",
  "EMAIL",
  "PHONE",
  "URL_CRED",
];

/**
 * Кнопка «Сущность» в тулбаре (Phase 8.5, T3; план 20261105_001, T3-9):
 * ручная разметка выделения — первичный путь (D11). Выделение → тип →
 * обёртка в `[выделенное](vas-entity:<type>:<ULID>)`. Значение известно
 * словарю identities — ULID переиспользуется (склонения связываются),
 * иначе генерируется новый.
 */
export function EntityMarkButton({path}: {path: string}) {
  const {t} = useTranslation();
  const toaster = useToaster();
  const kind = useEditorStore((s) => s.tabs.find((tab) => tab.path === path)?.kind);
  const selPath = useSelectionStore((s) => s.path);
  const selText = useSelectionStore((s) => s.text);
  const [indexEntries, setIndexEntries] = useState<EntityIndexEntry[]>([]);

  useEffect(() => {
    let alive = true;
    void ensureEntitiesIndex(getParentDir(path)).then((file) => {
      if (alive) setIndexEntries(file.entries);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  if (kind !== "markdown") return null;
  const hasSelection = selPath === path && selText !== "";

  const mark = (type: EntityType) => {
    const known = matchEntityEntry(indexEntries, selText);
    const ulid = known?.ulid ?? generateUlid();
    const ok = markSelectionAsEntity(path, type, ulid);
    if (!ok) {
      toaster.add({name: "entity-mark", content: t("entity.intersection"), autoHiding: 4000});
      return;
    }
    if (known) {
      toaster.add({
        name: "entity-mark",
        content: t("entity.reused", {canonical: known.canonical}),
        autoHiding: 4000,
      });
    }
  };

  return (
    <Tooltip content={t("tools.entityTooltip")}>
      <span>
        <Popover
          trigger="click"
          toggle
          placement="bottom-start"
          content={
            <div className="entity-mark-panel">
              <div className="entity-mark-panel__title">{t("entity.pickType")}</div>
              {hasSelection ? (
                <>
                  <div className="entity-mark-panel__value">{selText}</div>
                  <div className="entity-mark-panel__types">
                    {ENTITY_TYPES.map((type) => (
                      <Button key={type} size="s" view="flat" onClick={() => mark(type)}>
                        {t(`assistant.entityType.${type.toLowerCase()}`)}
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="entity-mark-panel__title">{t("entity.noSelection")}</div>
              )}
            </div>
          }
        >
          <Button view="flat" disabled={!hasSelection}>
            <Icon data={PersonPencil} />
            {t("tools.entity")}
          </Button>
        </Popover>
      </span>
    </Tooltip>
  );
}
