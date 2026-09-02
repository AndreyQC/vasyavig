import {useEffect} from "react";
import {useToaster} from "@gravity-ui/uikit";
import {useFileStore} from "../store/fileStore";
import i18n from "../lib/i18n";

/** Информационные уведомления из fileStore (дубликат/вложенность корня) — тосты. */
export function NoticeToasts() {
  const toaster = useToaster();
  const notice = useFileStore((s) => s.notice);

  useEffect(() => {
    if (!notice) return;
    toaster.add({
      name: "vasyavig-notice",
      title: i18n.t("notices.toastTitle"),
      content: notice,
      theme: "info",
      autoHiding: 6000,
    });
    useFileStore.getState().setNotice(null);
  }, [notice, toaster]);

  return null;
}
