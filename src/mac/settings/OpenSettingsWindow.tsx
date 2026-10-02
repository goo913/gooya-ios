import { router } from "expo-router";
import { useEffect } from "react";
import { openSettings, type SettingsTab } from "../../../modules/gooya-mac";

/**
 * On the Mac, Settings is a window of its own (GOOYA → Settings…): a link to Settings or Integrations (gooya://settings)
 * opens it at its tab, and the page asked for goes.
 */
export function OpenSettingsWindow({ tab }: { tab: SettingsTab }) {
  useEffect(() => {
    openSettings(tab);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [tab]);
  return null;
}
