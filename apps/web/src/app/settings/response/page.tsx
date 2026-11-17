import { Suspense } from "react";
import { ResponseSettingsPage } from "@/components/v2/response-settings";
export default function Page() {
  return (
    <Suspense fallback={<p role="status">正在加载…</p>}>
      <ResponseSettingsPage />
    </Suspense>
  );
}
