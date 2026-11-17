"""Create local secrets without overwriting existing configuration or printing secrets."""
import argparse
import secrets
from pathlib import Path


def configure(root: Path):
    paths = [root / "apps/api/.env", root / "infra/.env"]
    if any(path.exists() for path in paths):
        return {"created": False, "message": "已有本机配置，未覆盖。请按 docs/local-setup.md 检查后端与数据库两份文件是否匹配。"}
    token, password = secrets.token_hex(32), secrets.token_hex(24)
    api = (root / "apps/api/.env.example").read_text(encoding="utf-8")
    api = api.replace("CHANGE_ME", password).replace("API_TOKEN=\n", "API_TOKEN=" + token + "\n")
    contents = [api, "POSTGRES_PASSWORD=" + password + "\n"]
    for path, content in zip(paths, contents):
        with path.open("x", encoding="utf-8", newline="\n") as file:
            file.write(content)
    return {"created": True, "message": "本机配置已生成；后端 API_TOKEN 和数据库密码已生成。请只在 apps/api/.env 填写百炼密钥及地域地址。"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(configure(args.root)["message"])
