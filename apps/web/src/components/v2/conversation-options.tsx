"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { RealGateway } from "@/lib/api/gateway";
import { mutation, type ResponseSettings } from "@/lib/api/v2";
import { useV2 } from "@/state/use-v2";
import { Feedback, InfoTip, useAction } from "./common";

export function ConversationOptions({
  id,
  gateway,
  busy,
  onReady,
}: {
  id: string;
  gateway: RealGateway;
  busy: boolean;
  onReady: (ready: boolean) => void;
}) {
  const settings = useV2<ResponseSettings>("/settings/response");
  const policy = useV2<{ mode: "on" | "off" | "legacy"; revision: number }>(
    `/conversations/${id}/memory-policy`,
  );
  const [globalEnabled, setGlobalEnabled] = useState<boolean>();
  const [globalError, setGlobalError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const action = useAction();
  useEffect(() => {
    let active = true;
    gateway
      .policy()
      .then((p) => {
        if (active) setGlobalEnabled(p.enabled);
      })
      .catch(() => {
        if (active) setGlobalError("记忆设置读取失败，请刷新页面。");
      });
    return () => {
      active = false;
    };
  }, [gateway]);
  useEffect(() => {
    const ready = !!settings.data && !settings.error;
    gateway.setV2Enabled(ready);
    onReady(ready);
  }, [gateway, settings.data, settings.error, onReady]);
  useEffect(() => {
    gateway.setResponseOptions(undefined);
    gateway.setSkipMemory(false);
    return () => {
      gateway.setResponseOptions(undefined);
      gateway.setSkipMemory(false);
    };
  }, [gateway, id]);
  async function toggle(mode: "on" | "off") {
    if (!policy.data) return;
    await action.run(async () => {
      const body = { mode, expected_revision: policy.data!.revision };
      // Turning on explicitly authorizes global processing and this conversation.
      // If the second request fails, its unchanged consent still blocks new writes.
      if (mode === "on" && globalEnabled === false) {
        const result = await gateway.setPolicy(true);
        setGlobalEnabled(result.enabled);
      }
      await mutation(
        `/conversations/${id}/memory-policy`,
        { ...body, request_id: action.requestId("policy", body) },
        "PATCH",
      );
      policy.refresh();
      setConfirm(false);
    });
  }
  if (settings.error)
    return (
      <div className="compact-status">
        <span>记忆不可用</span>
        <Link href="/settings/service">连接设置</Link>
        <InfoTip>{settings.error}</InfoTip>
      </div>
    );
  const enabled = policy.data?.mode === "on" && globalEnabled === true;
  const pending =
    settings.loading || policy.loading || globalEnabled === undefined;
  return (
    <div className="conversation-options">
      <Button
        variant="outline"
        role="switch"
        aria-checked={enabled}
        aria-label={
          pending ? "记忆：加载中" : enabled ? "记忆：开启" : "记忆：关闭"
        }
        disabled={
          busy || action.busy || pending || !!policy.error || !!globalError
        }
        onClick={() => (enabled ? void toggle("off") : setConfirm(true))}
      >
        <span className={`memory-toggle-dot ${enabled ? "is-on" : ""}`} />
        记忆：{pending ? "加载中" : enabled ? "开启" : "关闭"}
      </Button>
      <Feedback error={policy.error || globalError || action.error} />
      {confirm && (
        <Modal
          title="记住这段对话"
          onClose={() => {
            if (!action.busy) setConfirm(false);
          }}
        >
          <div className="dialog-body" aria-busy={action.busy}>
            <p>
              {globalEnabled === false
                ? "这会恢复全局自动整理，并开启本会话记忆。其他已授权会话也会恢复整理后续消息。"
                : "开启后会整理本会话的后续消息；复杂或敏感内容需你确认。"}
            </p>
            <Feedback error={action.error} />
            <div className="form-actions">
              <Button disabled={action.busy} onClick={() => setConfirm(false)}>
                取消
              </Button>
              <Button
                disabled={action.busy}
                variant="solid"
                onClick={() => void toggle("on")}
              >
                开启记忆
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
