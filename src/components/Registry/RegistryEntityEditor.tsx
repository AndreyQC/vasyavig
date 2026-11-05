import {useMemo, useState} from "react";
import {Button, Icon, Select, Text, TextInput} from "@gravity-ui/uikit";
import {ArrowLeft, TrashBin} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {useEntitiesIndexStore} from "../../store/entitiesIndexStore";
import {currentEntityTypes} from "../../lib/entityTypes";
import {typeLabel} from "./RegistryPanel";
import {RegistryRelations} from "./RegistryRelations";

/**
 * Редактор сущности (T6-2, план 20261105_011): canonical (у «чистой» записи
 * старый канон не остаётся формой, у размеченной — остаётся), тип (из
 * справочника типов harness.yaml + текущее значение записи), наблюдаемые
 * forms — read-only (источник — документы), ручные aliases —
 * добавление/удаление, связи — отдельный блок. Удаление записи — в два клика
 * (запись производного файла, но якоря документов остаются без словаря).
 */
export function RegistryEntityEditor({ulid, onClose}: {ulid: string; onClose: () => void}) {
  const {t, i18n} = useTranslation();
  const entries = useEntitiesIndexStore((s) => s.entries);
  const updateEntry = useEntitiesIndexStore((s) => s.updateEntry);
  const removeEntry = useEntitiesIndexStore((s) => s.removeEntry);
  const entry = useMemo(() => entries.find((e) => e.ulid === ulid) ?? null, [entries, ulid]);

  const [canonicalDraft, setCanonicalDraft] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const typeOptions = useMemo(() => {
    const defs = currentEntityTypes().defs.map((def) => ({
      value: def.token,
      content: typeLabel(def.token, i18n.language, t),
    }));
    // тип записи мог остаться из старого справочника — не терять его
    if (entry != null && !defs.some((d) => d.value === entry.type)) {
      defs.unshift({value: entry.type, content: entry.type});
    }
    return defs;
  }, [entry, i18n.language, t]);

  if (entry == null) {
    return (
      <div className="registry-editor">
        <div className="registry-editor__hint">{t("registry.editorGone")}</div>
        <Button size="s" view="flat" onClick={onClose}>
          <Icon data={ArrowLeft} />
          {t("registry.back")}
        </Button>
      </div>
    );
  }

  const canonicalDirty = canonicalDraft != null && canonicalDraft !== entry.canonical;
  const canonicalValid = canonicalDraft == null || canonicalDraft.trim() !== "";

  return (
    <div className="registry-editor">
      <div className="registry-editor__header">
        <Button size="s" view="flat" onClick={onClose}>
          <Icon data={ArrowLeft} />
          {t("registry.back")}
        </Button>
        <Text variant="caption-2" color="secondary" className="registry-editor__ulid">
          {entry.ulid}
        </Text>
      </div>

      <div className="registry-editor__field">
        <Text variant="caption-2" color="secondary" as="div">{t("registry.canonical")}</Text>
        <div className="registry-editor__canonical-row">
          <TextInput
            size="s"
            className="registry-editor__canonical"
            value={canonicalDraft ?? entry.canonical}
            onUpdate={setCanonicalDraft}
            error={!canonicalValid}
          />
          {canonicalDirty && canonicalValid && (
            <Button
              size="s"
              view="outlined"
              onClick={() => {
                void updateEntry(entry.ulid, {canonical: (canonicalDraft ?? "").trim()});
                setCanonicalDraft(null);
              }}
            >
              {t("registry.save")}
            </Button>
          )}
        </div>
      </div>

      <div className="registry-editor__field">
        <Text variant="caption-2" color="secondary" as="div">{t("registry.type")}</Text>
        <Select
          size="s"
          value={[entry.type]}
          onUpdate={(v) => v[0] != null && void updateEntry(entry.ulid, {type: v[0]})}
          options={typeOptions}
        />
      </div>

      <div className="registry-editor__field">
        <Text variant="caption-2" color="secondary" as="div">
          {t("registry.formsHint", {count: entry.forms.length})}
        </Text>
        <div className="registry-editor__chips">
          {entry.forms.map((form) => (
            <span key={form} className="registry-editor__chip" title={t("registry.formObserved")}>
              {form}
            </span>
          ))}
        </div>
      </div>

      <div className="registry-editor__field">
        <Text variant="caption-2" color="secondary" as="div">{t("registry.aliases")}</Text>
        <div className="registry-editor__chips">
          {(entry.aliases ?? []).length === 0 && (
            <Text variant="caption-2" color="secondary" as="span">
              {t("registry.aliasesEmpty")}
            </Text>
          )}
          {(entry.aliases ?? []).map((alias) => (
            <span key={alias} className="registry-editor__chip registry-editor__chip--alias">
              {alias}
              <button
                type="button"
                className="registry-editor__chip-remove"
                title={t("registry.aliasRemove")}
                onClick={() =>
                  void updateEntry(entry.ulid, {
                    aliases: (entry.aliases ?? []).filter((a) => a !== alias),
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="registry-editor__alias-row">
          <TextInput
            size="s"
            className="registry-editor__alias-input"
            value={aliasDraft}
            onUpdate={setAliasDraft}
            placeholder={t("registry.aliasPlaceholder")}
          />
          <Button
            size="s"
            view="flat"
            disabled={aliasDraft.trim() === ""}
            onClick={() => {
              const alias = aliasDraft.trim();
              if (alias !== "") void updateEntry(entry.ulid, {aliases: [...(entry.aliases ?? []), alias]});
              setAliasDraft("");
            }}
          >
            {t("registry.aliasAdd")}
          </Button>
        </div>
      </div>

      <RegistryRelations ulid={entry.ulid} />

      <div className="registry-editor__danger">
        {confirmDelete ? (
          <>
            <Text variant="caption-2" color="danger" as="span">
              {t("registry.deleteConfirm")}
            </Text>
            <Button size="s" view="outlined-danger" onClick={() => void removeEntry(entry.ulid).then(onClose)}>
              {t("registry.deleteYes")}
            </Button>
            <Button size="s" view="flat" onClick={() => setConfirmDelete(false)}>
              {t("registry.deleteNo")}
            </Button>
          </>
        ) : (
          <Button size="s" view="flat" onClick={() => setConfirmDelete(true)}>
            <Icon data={TrashBin} />
            {t("registry.delete")}
          </Button>
        )}
      </div>
    </div>
  );
}
