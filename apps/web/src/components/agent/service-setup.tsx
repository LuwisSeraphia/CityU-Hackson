"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RealGateway, type ServiceHealth } from "@/lib/api/gateway";

export function ServiceSetup({
  gateway,
  onRetry,
}: {
  gateway: RealGateway;
  onRetry: () => void;
}) {
  const [health, setHealth] = useState<ServiceHealth>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    gateway
      .health()
      .then((result) => {
        if (active) setHealth(result);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [gateway]);
  return (
    <section className="service-setup" aria-label="连接你的 Agent">
      <span className="eyebrow">PERSONAL AGENT</span>
      <h2>让你的 Agent 准备好</h2>
      <p>
        对话、记忆和文件会保存在本机数据库；需要推理的文本会发送给你配置的百炼模型。
      </p>
      <ul className="service-status">
        <li>
          本地服务 <strong>{health ? "已启动" : "等待连接"}</strong>
        </li>
        <li>
          长期记忆数据库{" "}
          <strong>{health?.database ? "已连接" : "待配置"}</strong>
        </li>
        <li>
          百炼模型{" "}
          <strong>
            {health?.model_configured ? "已填写配置，待真实调用验证" : "待配置"}
          </strong>
        </li>
      </ul>
      <ol>
        <li>
          在项目终端运行 <code>./scripts/setup-local.ps1</code>，生成本机配置。
        </li>
        <li>
          在 <code>apps/api/.env</code> 填写百炼 Key
          和对应地域的服务地址，再运行 <code>./scripts/start-db.ps1</code>。
        </li>
        <li>
          运行 <code>./scripts/start-api.ps1</code>
          ，重新启动前端，然后检查连接。
        </li>
      </ol>
      <p
        className="inline-error"
        role={error || health?.message ? "alert" : undefined}
      >
        {error || health?.message}
      </p>
      <Button variant="solid" onClick={onRetry}>
        检查连接并进入工作台
      </Button>
      <p className="source-footnote">
        详细步骤见项目文档 docs/local-setup.md。密钥只填入本机配置文件。
      </p>
    </section>
  );
}
