import { Suspense } from "react";
import { DataSettingsPage } from "@/components/v2/data-settings";
export default function Page() {
  return (
    <Suspense fallback={<p role="status">正在加载…</p>}>
      <DataSettingsPage />
    </Suspense>
  );
}
