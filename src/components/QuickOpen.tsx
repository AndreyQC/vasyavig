import {useEffect, useMemo, useState} from "react";
import {Text, TextInput} from "@gravity-ui/uikit";
import {useTranslation} from "react-i18next";
import {useFileStore} from "../store/fileStore";
import {useUiStore} from "../store/uiStore";
import {filterQuickOpen, flattenFiles} from "../lib/quickOpen";
import "./QuickOpen.css";

/**
 * Палитра быстрого открытия по имени (Ctrl+P, план 20261028_004, D7):
 * ввод + ранжированный список файлов всех корней; Up/Down/Enter/Esc.
 * Enter/клик — закреплённая вкладка (как Ctrl+O).
 */
export function QuickOpen() {
  const {t} = useTranslation();
  const open = useUiStore((s) => s.quickOpenOpen);
  const setQuickOpenOpen = useUiStore((s) => s.setQuickOpenOpen);
  const trees = useFileStore((s) => s.trees);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const entries = useMemo(() => flattenFiles(trees), [trees]);
  const results = useMemo(() => filterQuickOpen(entries, query), [entries, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);

  if (!open) return null;

  const close = () => setQuickOpenOpen(false);

  const openIndex = (index: number) => {
    const entry = results[index];
    if (!entry) return;
    close();
    void useFileStore.getState().openFile(entry.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openIndex(selected);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="quick-open__overlay" onMouseDown={close}>
      <div className="quick-open" onMouseDown={(e) => e.stopPropagation()}>
        <TextInput
          value={query}
          onUpdate={setQuery}
          onKeyDown={onKeyDown}
          placeholder={t("quickOpen.placeholder")}
          autoFocus
        />
        <div className="quick-open__list">
          {results.map((entry, i) => (
            <button
              key={entry.path}
              type="button"
              className={`quick-open__item${i === selected ? " quick-open__item--active" : ""}`}
              title={entry.path}
              onMouseEnter={() => setSelected(i)}
              onClick={() => openIndex(i)}
            >
              <Text variant="body-1" ellipsis className="quick-open__name">
                {entry.name}
              </Text>
              <Text variant="caption-1" color="secondary" ellipsis className="quick-open__dir">
                {entry.dir}
              </Text>
            </button>
          ))}
          {results.length === 0 && (
            <Text variant="body-1" color="secondary" className="quick-open__empty">
              {t("quickOpen.empty")}
            </Text>
          )}
        </div>
      </div>
    </div>
  );
}
