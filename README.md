# 文献意图检索（可用原型）

按研究想法自动展开学术检索，融合 **arXiv / Semantic Scholar / Crossref**，支持个人画像加权、今日推送、公众号筛选库；每条结果带摘要与出处链接。

## 快速开始

**方式 A · 本地服务（推荐，更稳）**

```powershell
cd "D:\111-项目\文献查询"
python server.py
# 浏览器打开 http://127.0.0.1:8765
```

**方式 B · 直接打开**

双击或用浏览器打开 `index.html`。若 arXiv/S2 被 CORS 或限流，请改用方式 A（页面会自动探测 `http://127.0.0.1:8765` 代理）。

## 功能对照

| 需求 | 实现 |
|---|---|
| 按想法检索（非关键词） | 中英文意图拆解 → 多路 query（primary / method+scene / failure / survey）→ 融合排序 |
| 真实文献 | arXiv Atom API + Semantic Scholar + Crossref |
| 中文关键词 | 学术词典从标题/摘要抽取（离线可用） |
| 中文摘要 | 原文摘要机器翻译；失败时词典结构化兜底；可切换看英文原文 |
| 出处 | 原文 URL、DOI、arXiv id；可点开核验 |
| 个人画像 | 研究方向 + 关键词，localStorage，检索加权 |
| 每日推送 + idea | 按画像生成 3–5 条精选 + 可执行 idea |
| 公众号筛选 | 贴链接入库、标签过滤、复制带出处引用（不爬未授权内容） |

## 文件

- `index.html` / `style.css` / `app.js` — 前端
- `server.py` — 静态托管 + arXiv/S2/翻译代理（仅标准库）

## 合规

仅调用公开学术 API。公众号侧为用户主动录入链接与笔记，不做批量抓取。
