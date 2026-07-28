import {useEffect} from "react";
import {useToaster} from "@gravity-ui/uikit";
import {useFileStore} from "../store/fileStore";
import i18n from "../lib/i18n";

/** Ошибки из fileStore показываются toast-уведомлениями (идея §9) и очищаются. */
export function ErrorToasts() {
  const toaster = useToaster();
  const error = useFileStore((s) => s.error);

  useEffect(() => {
    if (!error) return;
    toaster.add({
      name: "vasyavig-error",
      title: i18n.t("errors.toastTitle"),
      content: error,
      theme: "danger",
      autoHiding: 8000,
    });
    useFileStore.getState().setError(null);
  }, [error, toaster]);

  return null;
}
