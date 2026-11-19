"""Run frontend + backend together; demo mode is explicit and separate from cloud config."""

import argparse
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--demo",
        action="store_true",
        help="Explicit local SQLite integration mode, no model calls",
    )
    mode.add_argument(
        "--cloud",
        action="store_true",
        help="Use apps/api/.env, PostgreSQL and the configured model",
    )
    mode.add_argument(
        "--codex-cli", action="store_true", help="Real model via local Codex login"
    )
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--api-port", type=int, default=8000)
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=None,
        help="Persistent demo data directory",
    )
    args = parser.parse_args()
    if args.port == args.api_port or not all(
        1024 <= p <= 65535 for p in (args.port, args.api_port)
    ):
        parser.error("请选择两个不同的 1024—65535 端口。")
    npm = shutil.which("npm")
    if not npm or not (ROOT / "node_modules/vite").exists():
        parser.error("请先激活 Conda 环境并在项目根目录执行 npm ci。")
    try:
        import uvicorn  # noqa: F401
        from dotenv import dotenv_values
    except ImportError:
        parser.error("请先安装 apps/api/requirements.lock 中的 Python 依赖。")
    env = dict(os.environ)
    if args.demo or args.codex_cli:
        data = (
            args.data_dir
            or ROOT
            / "apps/api/.data"
            / ("codex-public-demo" if args.codex_cli else "local-demo")
        ).resolve()
        data.mkdir(parents=True, exist_ok=True)
        token_path = data / "api-token"
        if not token_path.exists():
            with token_path.open("x") as file:
                file.write(secrets.token_hex(32))
            token_path.chmod(0o600)
        env["API_TOKEN"] = token_path.read_text().strip()
        env["LOCAL_DEMO_DB"] = str(data / "chat.sqlite")
        app = (
            "app.codex_provider:app_factory"
            if args.codex_cli
            else "app.local_demo:app_factory"
        )
    else:
        values = {**dotenv_values(ROOT / "apps/api/.env"), **os.environ}
        if not all(
            values.get(k) for k in ("API_TOKEN", "DATABASE_URL", "DASHSCOPE_API_KEY")
        ):
            parser.error(
                "云模型模式需要在 apps/api/.env 配置 API_TOKEN、DATABASE_URL 和 DASHSCOPE_API_KEY。"
            )
        env.update({k: str(v) for k, v in values.items() if v is not None})
        app = "app.main:app"
    for port in (args.port, args.api_port):
        try:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
        except OSError:
            parser.error(
                f"端口 {port} 不可用，请停止占用服务或指定其他 --port / --api-port。"
            )
    env["AGENT_API_URL"] = f"http://127.0.0.1:{args.api_port}"
    api_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        app,
        "--app-dir",
        str(ROOT / "apps/api"),
        "--host",
        "127.0.0.1",
        "--port",
        str(args.api_port),
        "--no-access-log",
    ]
    if args.demo or args.codex_cli:
        api_cmd.append("--factory")
    children = []
    try:
        children.append(subprocess.Popen(api_cmd, cwd=ROOT, env=env))
        import urllib.request

        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for _ in range(100):
            if children[0].poll() is not None:
                raise RuntimeError("后端启动失败，请查看上方提示。")
            try:
                with opener.open(
                    env["AGENT_API_URL"] + "/api/v1/health/ready", timeout=0.5
                ) as response:
                    import json

                    health = json.load(response)
                if not health["database"] or not health["api_token_configured"]:
                    raise RuntimeError(
                        "后端未就绪：" + (health.get("message") or "请检查配置。")
                    )
                if not health["worker_required"] or health["worker"]:
                    break
            except (OSError, ValueError):
                time.sleep(0.1)
        else:
            raise RuntimeError("等待后端启动超时。")
        children.append(
            subprocess.Popen(
                [npm, "run", "dev", "--", "--port", str(args.port), "--strictPort"],
                cwd=ROOT,
                env=env,
            )
        )
        label = (
            "Codex CLI 真实模型模式"
            if args.codex_cli
            else "本地联调模式（非云模型）"
            if args.demo
            else "云模型模式"
        )
        print(
            f"\n{label}：http://127.0.0.1:{args.port}，按 Ctrl+C 同时停止前后端。\n",
            flush=True,
        )
        while all(child.poll() is None for child in children):
            time.sleep(0.2)
        raise RuntimeError("一个服务已退出，正在停止另一个服务。")
    except KeyboardInterrupt:
        pass
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
