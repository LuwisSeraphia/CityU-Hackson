import { Suspense } from "react";
import { MemoriesPage } from "@/components/v2/memories-page";
export default function Page() {
  return (
    <Suspense fallback={<p role="status">正在加载…</p>}>
      <MemoriesPage />
    </Suspense>
  );
}
