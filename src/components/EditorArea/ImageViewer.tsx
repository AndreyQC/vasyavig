import {useEffect, useRef, useState} from "react";
import {Button, Icon} from "@gravity-ui/uikit";
import {Minus, Plus} from "@gravity-ui/icons";
import {useTranslation} from "react-i18next";
import {toAssetUrl} from "../../lib/resolveImageSrc";

const MIN_ZOOM = 10;
const MAX_ZOOM = 1000;
const ZOOM_STEP = 1.25;

interface Props {
  path: string;
  name: string;
}

function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

/**
 * Вкладка-просмотрщик изображений (design D3/D4): файл отображается только
 * через asset protocol в `<img>` — скрипты SVG не выполняются, внешние
 * ресурсы не грузятся. По умолчанию вписывание; зум кнопками и Ctrl+колесом.
 */
export function ImageViewer({path, name}: Props) {
  const {t} = useTranslation();
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [natural, setNatural] = useState<{w: number; h: number} | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ctrl+колесо: нужен нативный listener с passive:false, иначе скроллит контейнер
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setFit(false);
      setZoom((z) => clampZoom(z * factor));
    };
    el.addEventListener("wheel", onWheel, {passive: false});
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    setFit(false);
    setZoom((z) => clampZoom(z * factor));
  };

  // переключатель «вписать / 100%»
  const toggleFit = () => {
    if (fit) {
      setFit(false);
      setZoom(100);
    } else {
      setFit(true);
    }
  };

  // процентный режим считается от натурального размера картинки, а не контейнера
  const displayW = natural ? Math.round((natural.w * zoom) / 100) : undefined;

  return (
    <div className="image-viewer" ref={containerRef}>
      <div className="image-viewer__toolbar">
        <Button view="flat" size="s" onClick={() => zoomBy(1 / ZOOM_STEP)} title={t("imageViewer.zoomOut")}>
          <Icon data={Minus} size={14} />
        </Button>
        <span className="image-viewer__zoom">{fit ? t("imageViewer.fit") : `${Math.round(zoom)}%`}</span>
        <Button view="flat" size="s" onClick={() => zoomBy(ZOOM_STEP)} title={t("imageViewer.zoomIn")}>
          <Icon data={Plus} size={14} />
        </Button>
        <Button view="flat" size="s" onClick={toggleFit}>
          {fit ? t("imageViewer.actualSize") : t("imageViewer.fit")}
        </Button>
      </div>
      <div className={`image-viewer__canvas${fit ? " image-viewer__canvas--fit" : ""}`}>
        {failed ? (
          <div className="image-viewer__error">{t("imageViewer.loadError")}</div>
        ) : (
          <img
            src={toAssetUrl(path)}
            alt={name}
            draggable={false}
            style={fit || displayW === undefined ? undefined : {width: displayW}}
            onLoad={(e) => setNatural({w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight})}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  );
}
