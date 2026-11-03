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
import {customTypeLabel, ensureEntityTypes, type EntityTypeDef} from "../../lib/entityTypes";
import {generateUlid} from "../../lib/agent/masking/ulid";

/**
 * Кнопка «Сущность» в тулбаре (Phase 8.5, T3/T3c; планы 20261105_001/002,
 * T3-9/HY-5): ручная разметка выделения — первичный путь (D11). Выделение →
 * тип (справочник harness.yaml: система + кастомные) → обёртка в
 * `[выделенное](vas-entity:<type>:<ULID>)`. Значение известно словарю
 * identities — ULID переиспользуется, иначе генерируется новый.
 */
export function EntityMarkButton({path}: {path: string}) {
  const {t, i18n} = useTranslation();
  const toaster = useToaster();
  const kind = useEditorStore((s) => s.tabs.find((tab) => tab.path === path)?.kind);
  const selPath = useSelectionStore((s) => s.path);
  const selText = useSelectionStore((s) => s.text);
  const [typeDefs, setTypeDefs] = useState<EntityTypeDef[]>([]);
  const [indexEntries, setIndexEntries] = useState<EntityIndexEntry[]>([]);

  useEffect(() => {
    let alive = true;
    const dir = getParentDir(path);
    void ensureEntityTypes(dir).then((config) => {
      if (alive) setTypeDefs(config.defs);
    });
    void ensureEntitiesIndex(dir).then((file) => {
      if (alive) setIndexEntries(file.entries);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  if (kind !== "markdown") return null;
  const hasSelection = selPath === path && selText !== "";

  const label = (token: string): string =>
    customTypeLabel(token, i18n.language) ?? t(`assistant.entityType.${token}`);

  const mark = (token: string) => {
    const known = matchEntityEntry(indexEntries, selText, undefined, {fuzzy: true});
    const ulid = known?.ulid ?? generateUlid();
    const ok = markSelectionAsEntity(path, token, ulid);
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
                    {typeDefs.map((def) => (
                      <Button key={def.token} size="s" view="flat" onClick={() => mark(def.token)}>
                        {label(def.token)}
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
