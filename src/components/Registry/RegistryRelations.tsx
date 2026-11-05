import {useMemo, useState} from "react";
import {Button, Icon, Select, Text} from "@gravity-ui/uikit";
import {Plus} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEntitiesIndexStore} from "../../store/entitiesIndexStore";
import type {EntityRelationKind} from "../../lib/entityRelations";

/**
 * Связи сущности (T6-2, план 20261105_011): явные рёбра
 * (`works_at`/`member_of`/`role_in`/`alias_of`) — добавить/убрать вручную;
 * выведенные `co_occurs` — read-only (свидетельство/документ). Направление:
 * выбранная сущность — всегда `from` (персона → организация/проект).
 */

const EXPLICIT_KINDS: readonly EntityRelationKind[] = ["works_at", "member_of", "role_in", "alias_of"];

export function RegistryRelations({ulid}: {ulid: string}) {
  const {t} = useTranslation();
  const entries = useEntitiesIndexStore((s) => s.entries);
  const relations = useEntitiesIndexStore((s) => s.relations);
  const addRelation = useEntitiesIndexStore((s) => s.addRelation);
  const removeRelation = useEntitiesIndexStore((s) => s.removeRelation);

  const byUlid = useMemo(() => new Map(entries.map((e) => [e.ulid, e])), [entries]);

  const explicit = useMemo(
    () =>
      relations.filter(
        (rel) =>
          (rel.from === ulid || rel.to === ulid) &&
          rel.kind !== "co_occurs" &&
          rel.confidence === "explicit",
      ),
    [relations, ulid],
  );
  const inferred = useMemo(
    () => relations.filter((rel) => (rel.from === ulid || rel.to === ulid) && rel.kind === "co_occurs"),
    [relations, ulid],
  );

  const [kind, setKind] = useState<EntityRelationKind>("works_at");
  const [target, setTarget] = useState<string>("");
  const targets = useMemo(
    () =>
      entries
        .filter((e) => e.ulid !== ulid)
        .sort((a, b) => a.canonical.localeCompare(b.canonical))
        .map((e) => ({value: e.ulid, content: e.canonical})),
    [entries, ulid],
  );

  const add = () => {
    if (target === "") return;
    void addRelation({from: ulid, to: target, kind, confidence: "explicit"});
    setTarget("");
  };

  return (
    <div className="registry-relations">
      <Text variant="caption-2" color="secondary" as="div">{t("registry.relationsTitle")}</Text>
      {explicit.length === 0 && inferred.length === 0 && (
        <Text variant="caption-2" color="secondary" as="div">{t("registry.relationsEmpty")}</Text>
      )}
      <div className="registry-relations__list">
        {explicit.map((rel) => {
          const other = byUlid.get(rel.from === ulid ? rel.to : rel.from);
          return (
            <div key={`${rel.from}|${rel.to}|${rel.kind}`} className="registry-relations__row">
              <span className="registry-relations__kind">{t(`registry.kind.${rel.kind}`)}</span>
              <span className="registry-relations__target" title={other?.ulid ?? rel.to}>
                {other?.canonical ?? rel.to}
              </span>
              {rel.from !== ulid && (
                <span className="registry-relations__dir">{t("registry.kindDirectionIn")}</span>
              )}
              <Button
                size="xs"
                view="flat"
                onClick={() => void removeRelation(rel)}
              >
                {t("registry.relationRemove")}
              </Button>
            </div>
          );
        })}
        {inferred.map((rel) => {
          const other = byUlid.get(rel.from === ulid ? rel.to : rel.from);
          return (
            <div key={`${rel.from}|${rel.to}|${rel.kind}`} className="registry-relations__row">
              <span className="registry-relations__kind">{t("registry.kind.co_occurs")}</span>
              <span className="registry-relations__target" title={other?.ulid ?? rel.to}>
                {other?.canonical ?? rel.to}
              </span>
              <span className="registry-relations__dir">{t("registry.kindInferred")}</span>
            </div>
          );
        })}
      </div>
      <div className="registry-relations__add">
        <Select
          size="s"
          className="registry-relations__kind-select"
          value={[kind]}
          onUpdate={(v) => v[0] != null && setKind(v[0] as EntityRelationKind)}
          options={EXPLICIT_KINDS.map((k) => ({value: k, content: t(`registry.kind.${k}`)}))}
        />
        <Select
          size="s"
          className="registry-relations__target-select"
          value={target === "" ? [] : [target]}
          onUpdate={(v) => setTarget(v[0] ?? "")}
          options={targets}
          placeholder={t("registry.relationTarget")}
          filterable
        />
        <Button size="s" view="flat" disabled={target === ""} onClick={add}>
          <Icon data={Plus} />
          {t("registry.relationAdd")}
        </Button>
      </div>
    </div>
  );
}
