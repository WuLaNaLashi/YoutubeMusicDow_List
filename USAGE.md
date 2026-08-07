# 使用说明（三步走）

> 前置：已装好 Python 依赖（`pip install -r requirements.txt`）和 ffmpeg。

---

## 第一步：导出 cookies

下载需要 YouTube 登录态，先导出 cookies。

```bash
# 装依赖（仅第一次）
pip install browser-cookie3

# 从 Chrome 导出（默认输出到项目根 cookies.txt）
python src/export_cookies.py
```

**如果上面失败**（Chrome 新版加密 / 报错 / 导出后下载仍报登录错误）：

1. Chrome 装扩展 **"Get cookies.txt LOCALLY"**（免费）
2. 浏览器打开 [youtube.com](https://www.youtube.com) 并**确认已登录**
3. 点扩展图标 → `Export` → 下载 `youtube.com_cookies.txt`
4. 覆盖到项目根目录：
   ```bash
   mv ~/Downloads/youtube.com_cookies.txt ./cookies.txt
   ```

验证：第一行应为 `# Netscape HTTP Cookie File`。

---

## 第二步：填歌单

编辑 `songs_list.txt`，**每行一首**，格式：

```
歌名-艺人
```

示例：

```
起风了-买辣椒也用券
两两相忘 - 辛晓琪
Monica-
```

规则：
- 分隔符是**最后一个** `-`（歌名含 `-` 也没事）
- 多艺人用 ` _ ` 分隔：`Letting Go-汪苏泷 _ 吉克隽逸`
- 缺艺人可写 `歌名-`（精度会下降）
- UTF-8 编码

---

## 第三步：运行下载

```bash
# 先测试 2 首，确认 cookies 和环境正常
python src/main.py --test 2

# 没问题再全量下
python src/main.py --all

# 中途断了，续跑（跳过已成功的）
python src/main.py --all --resume
```

下载结果在 `downloads/`，日志在 `logs/`。

---

## 常见问题

| 现象 | 原因 / 解决 |
|------|------------|
| 报 `Sign in to confirm you're not a bot` | cookies 失效，回第一步重导 |
| 报 `Requested format is not available` | 缺 JS 运行时，装 deno：`curl -fsSL https://deno.land/install.sh \| sh` |
| 下载被限流（429） | cookies 过期或没配代理，见 `config.py` 的 `PROXY` |
| 某首歌下错版本 | 跑 `python src/check_matches.py` 看 `logs/match_report.md`，重点看 `mismatch` 段 |

更多细节见 [README.md](README.md)。
