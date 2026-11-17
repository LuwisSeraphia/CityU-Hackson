"use client";
import { Button } from "@/components/ui/button";
import { useV2 } from "@/state/use-v2";
import { SectionShell, Feedback } from "./common";
import { SettingsTabs } from "./response-settings";
export function ServiceSettingsPage() {
  const query = useV2("/settings/response");
  return (
    <SectionShell title="设置">
      <SettingsTabs />
      <div className="settings-form field-grid">
        <h2>服务连接</h2>
        <p role="status">
          {query.loading
            ? "检查中…"
            : query.error
              ? "新版记忆未连接"
              : "新版记忆已连接"}
        </p>
        <Feedback error={query.error} />
        <Button variant="outline" onClick={query.refresh}>
          重新检查
        </Button>
        <details>
          <summary>连接配置</summary>
          <p>连接地址与密钥由本机服务配置管理，不会在浏览器中保存。</p>
          <p>
            请检查后端已启动且已启用 MEMORY_V2_ENABLED；前端通过 AGENT_API_URL
            或 AGENT_API_V2_URL 连接。
          </p>
        </details>
      </div>
    </SectionShell>
  );
}
