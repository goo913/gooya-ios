import { useEffect } from "react";
import { useIsPad } from "@/lib/layout";
import { noteExternalOpen, showOpenView } from "@/lib/openView";

/** gooya://open (the widget, away from its days): today in the view GOOYA opens in (Settings → Opens In). */
export default function Open() {
  const pad = useIsPad();
  useEffect(() => {
    noteExternalOpen();
    showOpenView(pad);
  }, [pad]);
  return null;
}
