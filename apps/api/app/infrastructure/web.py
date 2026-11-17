"""Public web reader with DNS/IP pinning, bounded responses and redirect checks."""

import asyncio
import http.client
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from app.errors import AppError


def public_url(url):
    parts = urlsplit(url)
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.port not in (None, 80, 443)
    ):
        raise AppError("URL_NOT_ALLOWED", "仅允许公共 HTTP/HTTPS 网页。")
    if parts.hostname.lower() in ("localhost", "metadata.google.internal"):
        raise AppError("URL_NOT_ALLOWED", "不能读取本机或内部服务。")
    return parts


def fetch_page(url):
    for _ in range(4):
        parts = public_url(url)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        addresses = {
            r[4][0] for r in socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
        }
        if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
            raise AppError("URL_NOT_ALLOWED", "该地址解析到内部或保留网络。")
        address = sorted(addresses)[0]
        connection_type = (
            http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
        )
        connection = connection_type(parts.hostname, port, timeout=10)
        # HTTPSConnection still validates the certificate against the original hostname.
        connection._create_connection = lambda target, timeout, source_address=None, **kw: (
            socket.create_connection((address, port), timeout, source_address)
        )
        try:
            connection.request(
                "GET",
                (parts.path or "/") + ("?" + parts.query if parts.query else ""),
                headers={"User-Agent": "PersonalAgent/1.1", "Accept": "text/html,text/plain"},
            )
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                url = urljoin(url, response.getheader("Location", ""))
                continue
            if response.status != 200:
                raise AppError("WEB_READ_FAILED", f"网页返回 HTTP {response.status}。", 502)
            if not any(
                t in response.getheader("Content-Type", "") for t in ("text/html", "text/plain")
            ):
                raise AppError("WEB_TYPE_UNSUPPORTED", "仅能读取 HTML 或纯文本网页。")
            body = response.read(1_000_001)
            if len(body) > 1_000_000:
                raise AppError("WEB_TOO_LARGE", "网页响应过大。")
            soup = BeautifulSoup(body, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "iframe"]):
                tag.decompose()
            return {
                "url": url,
                "title": soup.title.get_text()[:200] if soup.title else parts.hostname,
                "content": soup.get_text(" ", strip=True)[:16000],
            }
        finally:
            connection.close()
    raise AppError("WEB_REDIRECT_LIMIT", "网页重定向次数过多。")


async def read_page(url):
    try:
        return await asyncio.wait_for(asyncio.to_thread(fetch_page, url), 35)
    except AppError:
        raise
    except (OSError, TimeoutError, http.client.HTTPException, ValueError) as exc:
        raise AppError("WEB_READ_FAILED", "网页连接失败或超时。", 502, "tool", True) from exc
