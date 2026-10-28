"""Build complete-source and single-file MMCrypto ZIPs using Python stdlib only.

Run from any directory: python3 /path/to/project/work/package_mmcrypto.py
The source site is not modified. ZIP members are rooted at index.html.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html as html_module
import mimetypes
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit
import zipfile


SCRIPT_FOLDER = Path(__file__).resolve().parent
ROOT = SCRIPT_FOLDER.parent
# The same script can run from the original workspace or a downloaded source ZIP.
SITE = SCRIPT_FOLDER if (SCRIPT_FOLDER / "index.html").is_file() else ROOT / "outputs" / "mmcrypto-prism-bright"
OUTPUTS = SITE.parent
SINGLE = OUTPUTS / "mmcrypto-reference-single-file"
REQUIRED = ("index.html", "styles.css", "player.css", "frontend.css", "journey.css", "neutral.css", "content-sections.css", "theme.css", "theme-members.css", "autoplay.css", "autoplay.js", "config.js", "app.js", "members.js", "content.js", "prism.css", "prism-bright.css", "reference.css", "prism-motion.js", "README.md", "assets/sources.json", "assets/mmcrypto-logo.png", "assets/favicon.png", "assets/chris-story-conversation.webp", "assets/mmcrypto-ribbon-field.svg")
ATTR_RE = re.compile(r"([\w:-]+)\s*=\s*([\"'])(.*?)\2", re.DOTALL)
CSS_URL_RE = re.compile(r"url\(\s*([\"']?)(.*?)\1\s*\)", re.IGNORECASE)
ZIP_DATE = (2026, 1, 1, 0, 0, 0)


def attributes(tag: str) -> dict[str, str]:
    return {match[0].lower(): html_module.unescape(match[2]) for match in ATTR_RE.findall(tag)}


def local_file(url: str, base: Path) -> Path | None:
    """Resolve a local dependency, rejecting missing files and paths outside SITE."""
    parsed = urlsplit(html_module.unescape(url.strip()))
    if parsed.scheme or parsed.netloc or not parsed.path or url.startswith("#"):
        return None
    path = (SITE / unquote(parsed.path.lstrip("/")) if parsed.path.startswith("/")
            else base / unquote(parsed.path)).resolve()
    if not path.is_relative_to(SITE.resolve()):
        raise ValueError(f"Local reference escapes the source directory: {url}")
    if not path.is_file():
        raise FileNotFoundError(f"Missing local dependency: {url} (relative to {base})")
    return path


def image_data(url: str, base: Path) -> str:
    path = local_file(url, base)
    if path is None:
        return url
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if not mime.startswith("image/"):
        raise ValueError(f"Only local images may be embedded as assets: {path.relative_to(SITE)}")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    fragment = urlsplit(url).fragment
    return f"data:{mime};base64,{encoded}" + (f"#{fragment}" if fragment else "")


def inline_css(css: str, base: Path) -> str:
    # The site intentionally uses plain CSS with no local @import build chain.
    if re.search(r"@import\b", css, flags=re.IGNORECASE):
        raise ValueError("CSS @import must be resolved before creating the single-file version.")

    def replace_url(match: re.Match[str]) -> str:
        url = match.group(2).strip()
        if not url or url.startswith("#"):
            return match.group(0)
        return f'url("{image_data(url, base)}")'

    return CSS_URL_RE.sub(replace_url, css)


def make_single_html() -> str:
    page = (SITE / "index.html").read_text(encoding="utf-8")
    inlined_styles: list[str] = []
    inlined_scripts: list[str] = []
    script_bodies: list[str] = []

    def stylesheet(match: re.Match[str]) -> str:
        tag = match.group(0)
        attrs = attributes(tag)
        if "stylesheet" not in attrs.get("rel", "").split() or not attrs.get("href"):
            return tag
        path = local_file(attrs["href"], SITE)
        if path is None:
            return tag
        css = inline_css(path.read_text(encoding="utf-8"), path.parent)
        inlined_styles.append(path.name)
        return "<style>\n" + css.replace("</style", "<\\/style") + "\n</style>"

    page = re.sub(r"<link\b[^>]*>", stylesheet, page, flags=re.IGNORECASE)

    def script(match: re.Match[str]) -> str:
        tag = match.group(0)
        opening = tag[:tag.index(">") + 1]
        attrs = attributes(opening)
        if not attrs.get("src"):
            return tag
        path = local_file(attrs["src"], SITE)
        if path is None:
            return tag
        if attrs.get("type") == "module":
            raise ValueError("This no-build packager expects classic scripts, not ES modules.")
        source = path.read_text(encoding="utf-8")
        # Prevent a JS string containing </script> from closing the HTML element.
        source = re.sub(r"</script", lambda match: "<\\/" + match.group(0)[2:], source,
                        flags=re.IGNORECASE)
        script_bodies.append("<script>\n" + source + "\n</script>")
        inlined_scripts.append(path.name)
        return ""

    page = re.sub(r"<script\b[^>]*>.*?</script\s*>", script, page,
                  flags=re.IGNORECASE | re.DOTALL)
    if "styles.css" not in inlined_styles:
        raise ValueError("index.html must reference styles.css before packaging.")
    if inlined_scripts != ["config.js", "app.js", "members.js", "content.js", "prism-motion.js", "autoplay.js"]:
        raise ValueError(f"Expected scripts in config.js → app.js → members.js → content.js → prism-motion.js → autoplay.js order; found {inlined_scripts!r}")

    def image_attribute(match: re.Match[str]) -> str:
        attribute, quote, value = match.groups()
        if urlsplit(html_module.unescape(value)).scheme or value.startswith(("//", "#")):
            return match.group(0)
        return f"{attribute}={quote}{image_data(value, SITE)}{quote}"

    # Script and stylesheet references have been removed. Relative values here
    # are site-owned image files (including favicon links and video thumbnails).
    page = re.sub(r"\b(src|poster|href)\s*=\s*([\"'])(.*?)\2", image_attribute, page,
                  flags=re.IGNORECASE | re.DOTALL)

    def source_set(match: re.Match[str]) -> str:
        quote, value = match.groups()
        if value.strip().startswith("data:"):
            return match.group(0)
        entries = []
        for entry in value.split(","):
            parts = entry.strip().split(maxsplit=1)
            if not parts:
                continue
            entries.append(image_data(parts[0], SITE) + (" " + parts[1] if len(parts) == 2 else ""))
        return f"srcset={quote}" + ", ".join(entries) + quote

    page = re.sub(r"\bsrcset\s*=\s*([\"'])(.*?)\1", source_set, page,
                  flags=re.IGNORECASE | re.DOTALL)
    # Also inline image URLs used by inline style attributes or a small inline style.
    page = inline_css(page, SITE)
    if not re.search(r"</body\s*>", page, flags=re.IGNORECASE):
        raise ValueError("index.html is missing </body>.")
    page = re.sub(r"</body\s*>", lambda _: "\n" + "\n".join(script_bodies) + "\n</body>",
                  page, count=1, flags=re.IGNORECASE)
    return page


def zip_bytes(path: Path, members: dict[str, bytes]) -> None:
    """Stable member order/metadata makes repeated builds easy to compare."""
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, payload in sorted(members.items()):
            info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, payload, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None or "index.html" not in archive.namelist():
            raise RuntimeError(f"ZIP verification failed: {path}")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    print(f"{path.name}: {path.stat().st_size:,} bytes · {len(members)} files · SHA256 {digest}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full-only", action="store_true", help="Create only the full-source ZIP.")
    args = parser.parse_args()
    missing = [name for name in REQUIRED if not (SITE / name).is_file()]
    if missing:
        parser.error("Site is not ready; missing: " + ", ".join(missing))

    members = {
        path.relative_to(SITE).as_posix(): path.read_bytes()
        for path in sorted(SITE.rglob("*"))
        if path.is_file() and path.name not in {".DS_Store"}
        and not any(part.startswith(".") for part in path.relative_to(SITE).parts)
        and path.suffix not in {".zip", ".pyc"}
    }
    members[".nojekyll"] = b""
    # Prepare all content before writing outputs, so a missing asset cannot leave
    # an apparently complete single-file delivery behind.
    single_html = None if args.full_only else make_single_html()
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    zip_bytes(OUTPUTS / "mmcrypto-reference-complete-source.zip", members)

    if single_html is not None:
        SINGLE.mkdir(parents=True, exist_ok=True)
        single_readme = """# MMCRYPTO PRISM BRIGHT · 单文件版

本站的 HTML、CSS、JavaScript 和本地图片已合并到 index.html。
当前为 2026-10-23 PRISM 06 科技风格版：珍珠白、冷银与紫色，使用官方 2026 年访谈合照、金属环与紫色缎带、超大双行标题；精简首屏重复文案和视频卡片按钮，收紧故事控制与内容间距。首屏使用官方 2026 年访谈合照，保留轻微漂移并支持暂停动效。五章固定区域故事、独立文章和会员演示流程均保留。
MMCrypto 标识使用官方 YouTube 频道横幅中的原始深色字形与青蓝符号。动效支持页面暂停开关和系统减少动态效果设置。
上传 GitHub Pages 时，先解压 ZIP，再把 index.html 放在仓库根目录。
不要上传 ZIP 本身，也不要与分文件源码版的 index.html 混淆。
YouTube 视频和外部社媒/交易所链接仍需网络，视频播放取决于平台允许嵌入。
直接双击 HTML 时，视频链接会在 YouTube 打开；HTTP(S) 预览会在视频卡片进入视口后尝试静音循环播放，并支持点击后打开站内弹窗。

主导航、内容筛选、文章阅读、邮箱验证码演示、Member Hub 与账户关联演示均已包含。注册／登录弹窗仅保留邮箱方式，已取消 Discord 登录入口；使用精简单栏布局，通过 Log In / Sign Up 区分登录与注册。
会员功能是前台演示：不发邮件、不创建真实账户、不执行 Discord 登录或 WEEX 校验。
演示验证码会直接显示；交易所邮箱可以与网站邮箱不同。WEEX 匹配成功后显示勾选、账号摘要和返回会员中心按钮，演示成功明确标记为模拟结果。
关联示例邮箱为 exchange.demo@example.com；UID 10000001 显示匹配，10000002 显示邀请码不匹配，10000003 显示未找到，10000004 显示服务不可用。
演示数据仅留在当前浏览器标签页；请使用虚构的示例邮箱。
真实登录、专属推荐、账户校验和正式法律文件须另接后端与配置。

首页仅引导注册 MMCrypto 网站，不展示任何交易所。完成网站注册或登录后，会员中心才展示 WEEX 引导；其他交易所入口已移除。
关联流程包括指定链接注册、回填交易所邮箱+UID、校验邀请码归属。专属链接和校验接口待提供，当前仅演示。
视频区包含 6 支官方视频；缩略图进入视口后会尝试静音循环自动播放，点击仍可打开完整控制弹窗；浏览器、地区或 YouTube 策略不允许时保留真实缩略图。独立文章区包含 3 篇公开短评、2 篇本站原创学习笔记。五章成长故事各配一张不同的真实照片，来源和日期随图保留；近期照片不作为早年经历的历史影像。
活动/VIP 暂未配置。页面没有编造奖励、时间或 VIP 条件。
后续维护建议编辑完整源码，再运行源码内的 package_site.py 重新生成本文件。
pro.weex.com/mmcrypto 必须由 WEEX 域名管理团队配置，本文件不会自动绑定域名。
"""
        single_members = {
            "index.html": single_html.encode("utf-8"),
            "README.md": single_readme.encode("utf-8"),
            ".nojekyll": b"",
        }
        for name, payload in single_members.items():
            (SINGLE / name).write_bytes(payload)
        zip_bytes(OUTPUTS / "mmcrypto-reference-single-file.zip", single_members)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, ValueError, RuntimeError) as error:
        print(f"Packaging stopped: {error}", file=sys.stderr)
        raise SystemExit(1) from error
