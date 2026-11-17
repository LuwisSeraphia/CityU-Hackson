import { Suspense } from "react";
import { ServiceSettingsPage } from "@/components/v2/service-settings";
export default function Page() {
  return (
    <Suspense fallback={<p role="status">正在加载…</p>}>
      <ServiceSettingsPage />
    </Suspense>
  );
}
