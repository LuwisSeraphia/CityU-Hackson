import { Suspense } from "react";
import { ProfilesPage } from "@/components/v2/profiles-page";
export default function Page() {
  return (
    <Suspense fallback={<p role="status">正在加载…</p>}>
      <ProfilesPage />
    </Suspense>
  );
}
