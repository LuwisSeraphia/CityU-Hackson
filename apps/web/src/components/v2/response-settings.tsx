"use client";
import { Form } from "@/components/ui/form";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RealGateway } from "@/lib/api/gateway";
import { Button } from "@/components/ui/button";
import {
  modes,
  mutation,
  type ResponseOptions,
  type ResponseSettings,
} from "@/lib/api/v2";
import { useV2 } from "@/state/use-v2";
import {
  Feedback,
  InfoTip,
  LoadState,
  SectionShell,
  useAction,
  useUnsavedChanges,
} from "./common";

export function ResponseFields({
  value,
  onChange,
  limits,
  disabled = false,
}: {
  value: ResponseOptions;
  onChange: (options: ResponseOptions) => void;
  limits: ResponseSettings["limits"];
  disabled?: boolean;
}) {
  return (
    <fieldset className="response-fields" disabled={disabled}>
      <legend className="sr-only">回答方式</legend>
      <div className="response-modes">
        {Object.entries(modes).map(([mode, label]) => (
          <label key={mode} className={value.mode === mode ? "selected" : ""}>
            <input
              type="radio"
              name="response-mode"
              checked={value.mode === mode}
              onChange={() =>
                onChange({ ...value, mode: mode as ResponseOptions["mode"] })
              }
            />
            {label}
          </label>
        ))}
      </div>
      <details className="advanced-options">
        <summary>高级设置</summary>
        <div className="field-grid">
          <InfoTip>
            记忆预算限制本轮最多使用的个性化记忆 token，不是实际消耗。0
            表示不使用长期记忆。
          </InfoTip>
          <label>
            记忆预算
            <input
              type="number"
              min={0}
              max={limits.memory_budget_max}
              step={1}
              placeholder="跟随档位"
              value={value.memory_budget_tokens ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  memory_budget_tokens:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            检索次数
            <input
              type="number"
              min={1}
              max={limits.retrieval_rounds_max}
              placeholder="跟随档位"
              value={value.retrieval_rounds ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  retrieval_rounds:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <Button
            onClick={() =>
              onChange({
                ...value,
                memory_budget_tokens: null,
                retrieval_rounds: null,
              })
            }
          >
            恢复档位默认
          </Button>
        </div>
      </details>
    </fieldset>
  );
}
function SettingsForm({
  data,
  refresh,
}: {
  data: ResponseSettings;
  refresh: () => void;
}) {
  const [options, setOptions] = useState(data.options);
  const discardDialog = useUnsavedChanges(
    JSON.stringify(options) !== JSON.stringify(data.options),
  );
  const action = useAction();
  return (
    <Form
      noValidate
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          const body = { ...options, expected_revision: data.revision };
          await mutation(
            "/settings/response",
            { ...body, request_id: action.requestId("settings", body) },
            "PATCH",
          );
          refresh();
        }, "设置已保存");
      }}
    >
      {discardDialog}
      <h2>默认回答方式</h2>
      <ResponseFields
        value={options}
        onChange={setOptions}
        limits={data.limits}
        disabled={action.busy}
      />
      <Feedback {...action} />
      <div className="form-actions">
        <Button type="submit" variant="solid" disabled={action.busy}>
          {action.busy ? "保存中…" : "保存设置"}
        </Button>
      </div>
    </Form>
  );
}
export function SettingsTabs() {
  return (
    <nav className="section-tabs" aria-label="设置分类">
      <Link href="/settings/response">回答方式</Link>
      <Link href="/settings/data">数据</Link>
      <Link href="/settings/service">连接设置</Link>
    </nav>
  );
}
export function ResponseSettingsPage() {
  const query = useV2<ResponseSettings>("/settings/response");
  return (
    <SectionShell title="设置">
      <SettingsTabs />
      <GlobalMemory />
      <LoadState {...query} />
      {query.data && !query.error && (
        <SettingsForm
          key={query.data.revision}
          data={query.data}
          refresh={query.refresh}
        />
      )}
    </SectionShell>
  );
}
function GlobalMemory() {
  const [gateway] = useState(() => new RealGateway()),
    [enabled, setEnabled] = useState<boolean>();
  const action = useAction();
  useEffect(() => {
    let active = true;
    gateway
      .policy()
      .then((p) => {
        if (active) setEnabled(p.enabled);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [gateway]);
  return (
    <div className="settings-form">
      <h2>自动整理记忆</h2>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={enabled ?? false}
          disabled={enabled === undefined || action.busy}
          onChange={(e) => {
            const next = e.target.checked;
            void action.run(async () => {
              setEnabled((await gateway.setPolicy(next)).enabled);
            }, "设置已保存");
          }}
        />
        允许自动整理已授权会话
      </label>
      <InfoTip>
        关闭后，所有会话都停止自动写入记忆。已有记忆仍可用于回答；单次手动记录不受影响。
      </InfoTip>
      {enabled === undefined && (
        <Button
          onClick={() =>
            void action.run(async () => {
              setEnabled((await gateway.policy()).enabled);
            })
          }
        >
          重新检查
        </Button>
      )}
      <Feedback {...action} />
    </div>
  );
}
