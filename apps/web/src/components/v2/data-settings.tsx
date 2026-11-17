"use client";
import { Form } from "@/components/ui/form";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadBackup, mutation, v2 } from "@/lib/api/v2";
import { Feedback, SectionShell, useAction } from "./common";
import { SettingsTabs } from "./response-settings";
type Transfer = {
  id?: string;
  job_id?: string;
  state: string;
  epoch: number;
  report: {
    counts?: Record<string, number>;
    conflicts?: {
      conflict_id: string;
      table: string;
      local_preview?: string;
      import_preview?: string;
    }[];
  };
};
export function DataSettingsPage() {
  const action = useAction();
  const [file, setFile] = useState<File>(),
    [transfer, setTransfer] = useState<Transfer>(),
    [transferId, setTransferId] = useState("");
  const [mode, setMode] = useState("merge"),
    [resolutions, setResolutions] = useState<Record<string, string>>({}),
    [confirmed, setConfirmed] = useState(false);
  const conflicts = transfer?.report.conflicts ?? [];
  return (
    <SectionShell title="设置">
      <SettingsTabs />
      <div className="settings-form">
        <h2>个人记忆备份</h2>
        <p>
          备份包含个人记忆、画像和聊天原文，请妥善保存。知识库原件需通过独立流程导出。
        </p>
        <Button
          disabled={action.busy}
          variant="outline"
          onClick={() =>
            void action.run(async () => {
              const result = await mutation<Transfer>("/exports", {
                request_id: crypto.randomUUID(),
              });
              await downloadBackup(result.job_id!);
            }, "备份已下载")
          }
        >
          导出备份
        </Button>
      </div>
      <Form
        noValidate
        className="settings-form field-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (!file) return;
          void action.run(async () => {
            if (file.size > 200 * 1024 * 1024)
              throw new Error("备份不能超过 200 MB。");
            const body = new FormData();
            body.set("file", file);
            const result = await v2<Transfer>("/imports/preflight", {
              method: "POST",
              body,
            });
            const id = result.job_id!;
            const status = await v2<Transfer>(`/imports/${id}`);
            setTransferId(id);
            setTransfer(status);
            setConfirmed(false);
            setResolutions({});
          });
        }}
      >
        <h2>导入备份</h2>
        <label>
          个人记忆 ZIP 文件
          <input
            type="file"
            accept=".zip,application/zip"
            required
            disabled={action.busy}
            onChange={(e) => {
              setFile(e.target.files?.[0]);
              setTransfer(undefined);
              setConfirmed(false);
            }}
          />
        </label>
        <Button variant="outline" type="submit" disabled={!file || action.busy}>
          检查备份
        </Button>
      </Form>
      {transfer && transfer.state !== "completed" && (
        <div className="settings-form field-grid">
          <h2>确认导入</h2>
          <p>
            共{" "}
            {Object.values(transfer.report.counts ?? {}).reduce(
              (a, b) => a + b,
              0,
            )}{" "}
            条数据 · {conflicts.length} 项冲突
          </p>
          <label>
            导入方式
            <select
              value={mode}
              disabled={action.busy}
              onChange={(e) => {
                setMode(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="merge">合并到当前空间</option>
              <option value="restore">恢复到空空间</option>
            </select>
          </label>
          {mode === "merge" &&
            conflicts.map((c, i) => (
              <fieldset className="import-conflict" key={c.conflict_id}>
                <legend>冲突 {i + 1}</legend>
                <p>当前：{c.local_preview || "无可展示正文"}</p>
                <p>备份：{c.import_preview || "无可展示正文"}</p>
                <details>
                  <summary>记录标识</summary>
                  <code>
                    {c.table} / {c.conflict_id}
                  </code>
                </details>
                <label>
                  保留内容
                  <select
                    value={resolutions[c.conflict_id] ?? ""}
                    disabled={action.busy}
                    onChange={(e) => {
                      setResolutions({
                        ...resolutions,
                        [c.conflict_id]: e.target.value,
                      });
                      setConfirmed(false);
                    }}
                  >
                    <option value="">请选择</option>
                    <option value="keep_local">保留当前</option>
                    <option value="use_import">使用备份</option>
                  </select>
                </label>
              </fieldset>
            ))}
          <p>
            {mode === "merge"
              ? "导入会新增数据，并按你的选择替换冲突内容，无法撤销。请先导出当前备份。"
              : "仅支持空的记忆空间；当前空间有数据时会拒绝恢复。"}{" "}
            导入后跟进许可保持暂停，检索索引需重新准备。
          </p>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={action.busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我已确认导入内容及影响
          </label>
          <Button
            variant="solid"
            disabled={
              action.busy ||
              !confirmed ||
              (mode === "merge" &&
                conflicts.some((c) => !resolutions[c.conflict_id]))
            }
            onClick={() =>
              void action.run(async () => {
                const body = {
                  mode,
                  expected_epoch: transfer.epoch,
                  resolutions:
                    mode === "merge"
                      ? conflicts.map((c) => ({
                          conflict_id: c.conflict_id,
                          action: resolutions[c.conflict_id],
                        }))
                      : [],
                };
                await mutation(`/imports/${transferId}/commit`, {
                  ...body,
                  request_id: action.requestId("import", body),
                });
                setTransfer({ ...transfer, state: "completed" });
              }, "数据已恢复，索引状态待查询。跟进许可保持暂停。")
            }
          >
            确认导入
          </Button>
        </div>
      )}
      <Feedback {...action} />
    </SectionShell>
  );
}
