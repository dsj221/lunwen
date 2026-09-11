/* 文献意图检索 · 前端逻辑（零依赖，可直接打开 index.html） */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- 存储 ----------
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };

  const state = {
    profile: store.get("ls_profile", {
      direction: "",
      keywords: "",
      boost: true,
    }),
    saved: store.get("ls_saved", []),
    wx: store.get("ls_wx", []),
    lastResults: [],
    lastIntent: null,
    serverMode: null, // true = 本地代理可用
  };

  // ---------- 意图拆解 ----------
  const CN_EN = [
    ["扩散模型", ["diffusion model", "denoising diffusion", "DDPM"]],
    ["扩散", ["diffusion model"]],
    ["少样本", ["few-shot", "few shot", "low-shot"]],
    ["小样本", ["few-shot", "few shot"]],
    ["零样本", ["zero-shot", "zero shot"]],
    ["医学图像", ["medical image", "medical imaging", "biomedical image"]],
    ["病理", ["pathology", "histopathology"]],
    ["影像", ["medical imaging", "radiology"]],
    ["图像分割", ["image segmentation", "semantic segmentation"]],
    ["分割", ["segmentation"]],
    ["目标检测", ["object detection"]],
    ["分类", ["classification"]],
    ["生成", ["generative", "generation"]],
    ["对抗", ["adversarial", "GAN"]],
    ["图神经网络", ["graph neural network", "GNN"]],
    ["注意力", ["attention mechanism", "self-attention", "transformer"]],
    ["大模型", ["large language model", "LLM", "foundation model"]],
    ["大语言模型", ["large language model", "LLM"]],
    ["语言模型", ["language model", "LLM"]],
    ["多模态", ["multimodal"]],
    ["强化学习", ["reinforcement learning"]],
    ["对比学习", ["contrastive learning"]],
    ["自监督", ["self-supervised"]],
    ["半监督", ["semi-supervised"]],
    ["迁移学习", ["transfer learning", "domain adaptation"]],
    ["领域自适应", ["domain adaptation", "domain generalization"]],
    ["联邦学习", ["federated learning"]],
    ["知识蒸馏", ["knowledge distillation"]],
    ["检索增强", ["retrieval-augmented", "RAG", "retrieval augmented generation"]],
    ["推荐系统", ["recommendation system", "recommender system"]],
    ["对话系统", ["dialogue system"]],
    ["情感分析", ["sentiment analysis"]],
    ["机器翻译", ["machine translation"]],
    ["问答", ["question answering"]],
    ["机器人", ["robotics", "robot learning"]],
    ["自动驾驶", ["autonomous driving"]],
    ["点云", ["point cloud"]],
    ["视频", ["video understanding"]],
    ["时序", ["time series"]],
    ["异常检测", ["anomaly detection"]],
    ["可解释", ["explainability", "interpretable", "XAI"]],
    ["隐私", ["privacy", "differential privacy"]],
    ["安全", ["security", "adversarial robustness", "safety"]],
    ["失败案例", ["failure case", "failure mode", "limitation"]],
    ["失败", ["failure", "limitation"]],
    ["综述", ["survey", "review", "systematic review"]],
    ["复现", ["reproducibility"]],
    ["基准", ["benchmark"]],
    ["数据集", ["dataset"]],
    ["跨模态", ["cross-modal", "vision-language"]],
    ["视觉语言", ["vision-language", "VLM", "CLIP"]],
    ["医学", ["medical", "clinical", "healthcare", "biomedical"]],
    ["临床", ["clinical", "healthcare"]],
    ["药物", ["drug discovery", "drug design"]],
    ["蛋白质", ["protein", "protein structure"]],
    ["材料", ["materials science"]],
    ["气候", ["climate"]],
    ["教育", ["education"]],
    ["金融", ["finance", "financial"]],
  ];

  const EN_EXPAND = {
    "diffusion model": ["denoising diffusion probabilistic", "DDPM", "score-based generative"],
    "few-shot": ["low-shot", "meta-learning", "one-shot"],
    "medical image": ["medical imaging", "biomedical image analysis"],
    llm: ["large language model", "foundation model"],
    rag: ["retrieval-augmented generation"],
    segmentation: ["semantic segmentation", "instance segmentation"],
    failure: ["limitation", "failure mode", "error analysis"],
    survey: ["systematic review", "literature review"],
  };

  const STOP_EN = new Set(
    "the a an of for on in to and or with i want my research paper papers about how can some any do does is are this that look find search please help me study from by as at be".split(
      " "
    )
  );

  function extractTerms(query) {
    const raw = query.trim();
    const matchedCn = [];
    const matchedEn = [];
    const topics = [];

    const has = (s) => raw.includes(s);
    for (const [cn, ens] of CN_EN) {
      if (!has(cn)) continue;
      matchedCn.push(cn);
      for (const e of ens) {
        if (!matchedEn.some((x) => x.toLowerCase() === e.toLowerCase())) {
          matchedEn.push(e);
          topics.push(e);
        }
      }
    }

    const enWords = raw.match(/[A-Za-z][A-Za-z0-9\-+]{2,}/g) || [];
    for (const w of enWords) {
      const lw = w.toLowerCase();
      if (STOP_EN.has(lw)) continue;
      if (!matchedEn.some((x) => x.toLowerCase() === lw)) {
        matchedEn.push(w);
        topics.push(w);
      }
      for (const [key, exps] of Object.entries(EN_EXPAND)) {
        if (lw.includes(key) || key.split(" ").includes(lw)) {
          for (const e of exps) {
            if (!matchedEn.some((x) => x.toLowerCase() === e.toLowerCase())) {
              matchedEn.push(e);
            }
          }
        }
      }
    }

    let scene = null;
    if (/失败|局限|坑|问题/.test(raw)) scene = "failure";
    if (/综述|survey|review/i.test(raw)) scene = "survey";
    if (/小样本|少样本|few[- ]?shot/i.test(raw)) scene = scene || "few-shot";
    if (/医疗|医学|病理|临床/.test(raw)) scene = scene || "medical";

    // 画像关键词并入
    const kw = String(state.profile.keywords || "")
      .split(/[,，、;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const k of kw) {
      if (/^[A-Za-z]/.test(k)) {
        if (!matchedEn.some((x) => x.toLowerCase() === k.toLowerCase())) matchedEn.push(k);
      }
    }

    return {
      original: raw,
      cn_terms: matchedCn.slice(0, 8),
      en_terms: matchedEn.slice(0, 12),
      topics: [...new Set(topics)].slice(0, 10),
      scene,
      profile_keywords: kw.slice(0, 6),
    };
  }

  function buildQueries(parsed) {
    const en = parsed.en_terms;
    const topics = parsed.topics.length ? parsed.topics : en;
    const queries = [];

    const add = (source, q, kind) => {
      q = (q || "").trim();
      if (!q || q.length < 2) return;
      const key = source + "::" + q.toLowerCase();
      if (queries.some((x) => x._key === key)) return;
      if (queries.filter((x) => x.source === source).length >= 3) return;
      queries.push({ source, q, kind, _key: key });
    };

    if (!topics.length && !en.length) {
      add("arxiv", parsed.original, "raw");
      add("s2", parsed.original, "raw");
      return queries.map(({ _key, ...rest }) => rest);
    }

    const primary = (topics.length ? topics : en).slice(0, 4).join(" ");
    add("arxiv", primary, "primary");
    add("s2", primary, "primary");

    const methods = topics.filter((t) =>
      /diffusion|few-shot|zero-shot|transformer|attention|gnn|graph|contrastive|self-supervised|federated|distill|retrieval|llm|language model|multimodal|reinforcement|adversarial|gan/i.test(
        t
      )
    );
    const scenes = topics.filter((t) => !methods.includes(t)).slice(0, 2);
    if (methods.length && scenes.length) {
      add("s2", `${methods[0]} ${scenes[0]}`, "method+scene");
      add("arxiv", `${methods[0]} AND ${scenes[0]}`, "method+scene");
    }

    if (parsed.scene === "failure") {
      const base = (methods.length ? methods : topics).slice(0, 2).join(" ") || primary;
      add("s2", `${base} failure cases limitations`, "failure");
      add("arxiv", `${base} limitations`, "failure");
    }
    if (parsed.scene === "survey") {
      const base = (methods.length ? methods : topics).slice(0, 2).join(" ") || primary;
      add("s2", `${base} survey review`, "survey");
    }
    if (en.length >= 2) add("s2", en.slice(0, 5).join(" "), "alias");

    return queries.map(({ _key, ...rest }) => rest);
  }

  // ---------- 网络：直连 + 本地代理兜底 ----------
  async function fetchJson(url, timeout = 20000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchText(url, timeout = 20000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }

  let PROXY_BASE = "";

  async function detectServer() {
    if (state.serverMode !== null) return state.serverMode;
    const candidates = ["", "http://127.0.0.1:8765"];
    for (const base of candidates) {
      try {
        const r = await fetch(base + "/api/health", { signal: AbortSignal.timeout(1500) });
        if (r.ok) {
          state.serverMode = true;
          PROXY_BASE = base;
          return true;
        }
      } catch {
        /* try next */
      }
    }
    state.serverMode = false;
    return false;
  }

  async function searchArxiv(query, limit = 5) {
    const q = encodeURIComponent(`all:${query}`);
    const url = `https://export.arxiv.org/api/query?search_query=${q}&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`;
    let xml;
    try {
      xml = await fetchText(url);
    } catch (e) {
      const server = await detectServer();
      if (!server) throw e;
      xml = await fetchText(`${PROXY_BASE}/api/arxiv?q=${encodeURIComponent(query)}&limit=${limit}`);
    }
    return parseArxiv(xml);
  }

  function parseArxiv(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const entries = Array.from(doc.getElementsByTagName("entry"));
    return entries.map((entry) => {
      const text = (tag) => {
        const el = entry.getElementsByTagName(tag)[0];
        return el ? el.textContent.trim() : "";
      };
      const id = text("id");
      const title = text("title").replace(/\s+/g, " ").trim();
      const abstract = text("summary").replace(/\s+/g, " ").trim();
      const published = text("published");
      const year = published ? published.slice(0, 4) : "";
      const authors = Array.from(entry.getElementsByTagName("author"))
        .map((a) => {
          const n = a.getElementsByTagName("name")[0];
          return n ? n.textContent.trim() : "";
        })
        .filter(Boolean);
      return {
        id: id || `arxiv-${Math.random().toString(36).slice(2)}`,
        source: "arxiv",
        title,
        abstract,
        year,
        authors: authors.slice(0, 6),
        url: id || "#",
        venue: "arXiv",
        citations: null,
        externalIds: { ArXiv: id.split("/").pop() },
      };
    });
  }

  async function searchS2(query, limit = 5) {
    const url =
      "https://api.semanticscholar.org/graph/v1/paper/search?query=" +
      encodeURIComponent(query) +
      `&limit=${limit}&fields=title,abstract,year,url,externalIds,citationCount,authors,venue`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (e) {
      const server = await detectServer();
      if (!server) throw e;
      data = await fetchJson(`${PROXY_BASE}/api/s2?q=${encodeURIComponent(query)}&limit=${limit}`);
    }
    return (data.data || []).map((p) => ({
      id: p.paperId || p.externalIds?.DOI || p.url,
      source: "s2",
      title: p.title || "(untitled)",
      abstract: p.abstract || "",
      year: p.year ? String(p.year) : "",
      authors: (p.authors || []).map((a) => a.name).slice(0, 6),
      url: p.url || (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : "#"),
      venue: p.venue || "Semantic Scholar",
      citations: p.citationCount ?? null,
      externalIds: p.externalIds || {},
    }));
  }

  // Crossref 兜底（浏览器通常允许 CORS）
  async function searchCrossref(query, limit = 4) {
    const url =
      "https://api.crossref.org/works?query=" +
      encodeURIComponent(query) +
      `&rows=${limit}&select=DOI,title,author,issued,container-title,is-referenced-by-count,URL`;
    const data = await fetchJson(url, 18000);
    return (data.message?.items || []).map((it) => {
      const title = Array.isArray(it.title) ? it.title[0] : it.title || "";
      const year = it.issued?.["date-parts"]?.[0]?.[0] ? String(it.issued["date-parts"][0][0]) : "";
      const authors = (it.author || [])
        .map((a) => [a.given, a.family].filter(Boolean).join(" "))
        .filter(Boolean)
        .slice(0, 6);
      const venue = Array.isArray(it["container-title"])
        ? it["container-title"][0]
        : it["container-title"] || "Crossref";
      return {
        id: it.DOI,
        source: "crossref",
        title,
        abstract: "",
        year,
        authors,
        url: it.URL || `https://doi.org/${it.DOI}`,
        venue,
        citations: it["is-referenced-by-count"] ?? null,
        externalIds: { DOI: it.DOI },
      };
    });
  }

  // ---------- 排序 ----------
  function normalizeText(s) {
    return String(s || "").toLowerCase();
  }

  function scoreItem(item, parsed) {
    let score = 0;
    const title = normalizeText(item.title);
    const abs = normalizeText(item.abstract);
    const blob = title + " " + abs;

    for (const t of parsed.topics) {
      const lt = t.toLowerCase();
      if (title.includes(lt)) score += 14;
      else if (abs.includes(lt)) score += 6;
    }
    for (const t of parsed.en_terms) {
      const lt = t.toLowerCase();
      if (title.includes(lt)) score += 5;
      else if (abs.includes(lt)) score += 2;
    }

    // 画像加权
    if (state.profile.boost) {
      const kws = parsed.profile_keywords;
      for (const k of kws) {
        const lk = normalizeText(k);
        if (!lk) continue;
        if (title.includes(lk)) score += 8;
        else if (abs.includes(lk)) score += 3;
      }
      const dir = normalizeText(state.profile.direction);
      if (dir && (title.includes(dir) || abs.includes(dir))) score += 4;
    }

    if (item.citations != null) {
      score += Math.min(8, Math.log10(item.citations + 1) * 2.2);
    }
    const yearNum = parseInt(item.year, 10);
    if (!Number.isNaN(yearNum)) {
      const age = new Date().getFullYear() - yearNum;
      if (age <= 1) score += 4;
      else if (age <= 3) score += 2.5;
      else if (age <= 5) score += 1;
      else if (age > 12) score -= 2;
    }
    if (item.source === "arxiv") score += 1.2;
    if (item.source === "s2") score += 1.0;
    if (item.source === "crossref") score += 0.4;

    return score;
  }

  function dedupe(items) {
    const seen = new Set();
    const out = [];
    for (const it of items) {
      const keys = [
        it.externalIds?.DOI && `doi:${it.externalIds.DOI.toLowerCase()}`,
        it.externalIds?.ArXiv && `arxiv:${String(it.externalIds.ArXiv).toLowerCase()}`,
        normalizeText(it.title).replace(/\s+/g, " ").slice(0, 120),
      ].filter(Boolean);
      let dup = false;
      for (const k of keys) {
        if (seen.has(k)) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
      keys.forEach((k) => seen.add(k));
      out.push(it);
    }
    return out;
  }

  function explainReason(item, parsed) {
    const bits = [];
    const title = normalizeText(item.title);
    for (const t of parsed.topics.slice(0, 3)) {
      if (title.includes(t.toLowerCase())) bits.push(`标题命中「${t}」`);
    }
    if (state.profile.boost) {
      for (const k of parsed.profile_keywords) {
        if (k && normalizeText(item.title + item.abstract).includes(normalizeText(k))) {
          bits.push(`匹配画像「${k}」`);
          break;
        }
      }
    }
    if (item.citations != null && item.citations >= 50) bits.push(`高被引 ${item.citations}`);
    const y = parseInt(item.year, 10);
    if (!Number.isNaN(y) && y >= new Date().getFullYear() - 1) bits.push("近一年");
    if (!bits.length) bits.push(`来源 ${item.source.toUpperCase()} 相关召回`);
    return bits.slice(0, 3).join(" · ");
  }

  // ---------- 摘要（可溯源抽取式） ----------
  function extractiveSummary(abstract, max = 220) {
    if (!abstract) return "（本文暂无摘要，请打开原文核验。）";
    const clean = abstract.replace(/\s+/g, " ").trim();
    const sentences = clean.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
    let out = "";
    for (const s of sentences) {
      if ((out + s).length > max) break;
      out += (out ? " " : "") + s;
    }
    if (!out) out = clean.slice(0, max) + (clean.length > max ? "…" : "");
    return out;
  }

  function ideaFrom(parsed, items) {
    const top = items[0];
    const topics = parsed.topics.length ? parsed.topics : parsed.en_terms;
    if (!topics.length) return "把想法再具体一点（方法 + 场景 + 问题），检索会准很多。";
    if (parsed.scene === "failure") {
      return `围绕「${topics.slice(0, 2).join(" + ")}」，优先精读标注了 limitation / failure 的论文，并记录数据集与评测设定是否可比。`;
    }
    if (parsed.scene === "survey") {
      return `先读 1–2 篇近 2 年 survey，抽出分类维度，再按维度扫原始方法论文。`;
    }
    const t = topics.slice(0, 3).join(" / ");
    const extra = top ? `可从《${truncate(top.title, 42)}》的 related work 顺藤摸瓜。` : "";
    return `今天可试：把「${t}」写成一句可检验的研究问题，再搜 1 篇方法 + 1 篇应用交叉验证。${extra}`;
  }

  function truncate(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  // ---------- 检索主流程 ----------
  async function runSearch(query, { silent } = {}) {
    const parsed = extractTerms(query);
    const queries = buildQueries(parsed);
    state.lastIntent = { parsed, queries };

    renderIntent(parsed, queries);

    if (!queries.length) {
      setStatus("未能从输入中提取可检索概念，请补充方法或场景词。", "error");
      renderResults([], parsed);
      return;
    }

    setStatus("正在多路检索 arXiv / Semantic Scholar / Crossref…");
    setSearchBusy(true);

    const jobs = queries.map(async (q) => {
      try {
        if (q.source === "arxiv") {
          const r = await searchArxiv(q.q, 5);
          return r.map((x) => ({ ...x, via: q.q, kind: q.kind }));
        }
        if (q.source === "s2") {
          const r = await searchS2(q.q, 5);
          return r.map((x) => ({ ...x, via: q.q, kind: q.kind }));
        }
        return [];
      } catch {
        return [];
      }
    });

    // Crossref 用 primary
    const primaryQ = queries.find((q) => q.kind === "primary")?.q || parsed.topics.slice(0, 4).join(" ");
    jobs.push(
      searchCrossref(primaryQ, 4)
        .then((r) => r.map((x) => ({ ...x, via: primaryQ, kind: "crossref" })))
        .catch(() => [])
    );

    const batches = await Promise.all(jobs);
    let merged = batches.flat();
    merged = dedupe(merged);
    merged = merged.map((item) => {
      const score = scoreItem(item, parsed);
      return { ...item, score, reason: explainReason(item, parsed), summary: extractiveSummary(item.abstract) };
    });
    merged.sort((a, b) => b.score - a.score);

    const limit = 12;
    state.lastResults = merged.slice(0, limit);
    renderResults(state.lastResults, parsed);
    setSearchBusy(false);

    if (!state.lastResults.length) {
      setStatus("各源均未返回结果。可换更具体的英文术语，或稍后重试（S2 可能限流）。", "error");
    } else {
      const sources = [...new Set(state.lastResults.map((r) => r.source.toUpperCase()))].join(" · ");
      setStatus(`完成：${state.lastResults.length} 条（${sources}）。摘要为原文抽取，出处可点开核验。`, "ok");
      if (!silent) toast(`检索到 ${state.lastResults.length} 条相关文献`);
    }
  }

  async function runDailyDigest() {
    const p = state.profile;
    const kw = String(p.keywords || "")
      .split(/[,，、;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const dir = String(p.direction || "").trim();
    if (!kw.length && !dir) {
      setStatusDaily("请先在「个人画像」填写研究方向或关键词。", "error");
      return;
    }
    const seed = [dir, ...kw].filter(Boolean).join(" ");
    setStatusDaily("根据画像生成今日推送…");
    // 复用检索，但用画像构造 query
    await runSearch(seed, { silent: true });
    // 把结果镜像到日推区
    const items = state.lastResults.slice(0, 5);
    const parsed = state.lastIntent?.parsed || extractTerms(seed);
    renderDigest(items, parsed);
    if (items.length) setStatusDaily(`今日精选 ${items.length} 条，均附出处。`, "ok");
  }

  // ---------- 渲染 ----------
  function setStatus(msg, kind) {
    const el = $("#search-status");
    el.textContent = msg;
    el.className = "status-bar show" + (kind ? " " + kind : "");
  }
  function setStatusDaily(msg, kind) {
    const el = $("#digest-status");
    el.textContent = msg;
    el.className = "status-bar show" + (kind ? " " + kind : "");
  }
  function setSearchBusy(busy) {
    const btn = $("#btn-search");
    btn.disabled = busy;
    btn.innerHTML = busy
      ? '<span class="spinner"></span>检索中'
      : "意图检索";
  }

  function renderIntent(parsed, queries) {
    const panel = $("#intent-panel");
    panel.classList.add("show");
    const chips = [
      ...parsed.cn_terms.map((t) => `<span class="chip">${escapeHtml(t)}</span>`),
      ...parsed.en_terms.slice(0, 8).map((t) => `<span class="chip muted">${escapeHtml(t)}</span>`),
      ...(parsed.scene ? [`<span class="chip muted">场景:${escapeHtml(parsed.scene)}</span>`] : []),
    ].join(" ");
    $("#intent-chips").innerHTML = chips || "<span class='chip muted'>未提取到术语</span>";
    $("#query-list").innerHTML = queries
      .map(
        (q) => `
      <div class="query-item">
        <span class="chip ${q.source === "arxiv" ? "arxiv" : q.source === "s2" ? "s2" : "muted"}">${q.source.toUpperCase()}</span>
        <span class="kind">${escapeHtml(q.kind)}</span>
        <code>${escapeHtml(q.q)}</code>
      </div>`
      )
      .join("");
  }

  function resultCard(item, { showIdea } = {}) {
    const authors = (item.authors || []).slice(0, 4).join(", ") + ((item.authors || []).length > 4 ? " 等" : "");
    const doi = item.externalIds?.DOI;
    const citeLine = [
      item.year && item.year,
      item.venue && item.venue,
      item.citations != null && `被引 ${item.citations}`,
      authors && authors,
    ]
      .filter(Boolean)
      .join(" · ");
    const idHref = escapeHtml(item.url || "#");
    const saved = state.saved.some((s) => s.id === item.id);
    return `
    <article class="result" data-id="${escapeHtml(item.id)}">
      <div class="result-top">
        <h3 class="result-title"><a href="${idHref}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></h3>
      </div>
      <div class="result-meta">
        <span class="chip ${item.source === "arxiv" ? "arxiv" : item.source === "s2" ? "s2" : "muted"}">${item.source.toUpperCase()}</span>
        <span>${escapeHtml(citeLine)}</span>
        <span class="score">score ${item.score?.toFixed?.(1) ?? "—"}</span>
        ${saved ? '<span class="saved-badge">已收藏</span>' : ""}
      </div>
      <p class="result-abs">${escapeHtml(item.summary || item.abstract || "无摘要")}</p>
      <div class="result-foot">
        <span class="reason">${escapeHtml(item.reason || "")}</span>
        <div class="result-actions">
          <button class="linkish" data-act="toggle-abs">展开摘要</button>
          <button class="linkish" data-act="save">${saved ? "取消收藏" : "收藏"}</button>
          ${doi ? `<a class="linkish" href="https://doi.org/${escapeHtml(doi)}" target="_blank" rel="noopener">DOI</a>` : ""}
          <a class="linkish" href="${idHref}" target="_blank" rel="noopener">原文</a>
        </div>
      </div>
      ${showIdea ? "" : ""}
    </article>`;
  }

  function renderResults(items, parsed) {
    const box = $("#result-list");
    if (!items.length) {
      box.innerHTML = `<div class="empty">暂无结果。试试更具体的表述，例如：<br><strong>扩散模型在小样本病理图像分割上的失败案例</strong></div>`;
      return;
    }
    box.innerHTML = items.map((it) => resultCard(it)).join("");
  }

  function renderDigest(items, parsed) {
    const box = $("#digest-list");
    const date = new Date().toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    });
    $("#digest-date").textContent = date;
    if (!items.length) {
      box.innerHTML = `<div class="empty">画像还太弱，先补充关键词再生成日推。</div>`;
      $("#idea-box").innerHTML = "";
      return;
    }
    $("#idea-box").innerHTML = `<strong>今日 idea</strong><br>${escapeHtml(ideaFrom(parsed, items))}`;
    box.innerHTML = items
      .map((it, i) => {
        const card = resultCard(it);
        return card.replace(
          'class="result"',
          `class="result" data-rank="${i + 1}"`
        );
      })
      .join("");
  }

  function renderSaved() {
    const box = $("#saved-list");
    if (!state.saved.length) {
      box.innerHTML = `<div class="empty">还没有收藏。检索后点「收藏」，会保存标题、摘要与出处链接。</div>`;
      return;
    }
    box.innerHTML = state.saved
      .map((item) => resultCard(item))
      .join("");
  }

  function renderWx() {
    const box = $("#wx-list");
    const filter = $("#wx-filter")?.value || "";
    let list = state.wx.slice();
    if (filter) list = list.filter((x) => (x.tags || "").includes(filter) || (x.title || "").includes(filter));
    if (!list.length) {
      box.innerHTML = `<div class="empty">粘贴公众号文章链接，建立你的「已筛选」语料。站内会按标签与研究方向帮你过滤后再展示。</div>`;
      return;
    }
    box.innerHTML = list
      .map((w) => {
        const tags = String(w.tags || "")
          .split(/[,，、\s]+/)
          .filter(Boolean)
          .map((t) => `<span class="chip wx">${escapeHtml(t)}</span>`)
          .join(" ");
        return `
        <div class="wx-item" data-id="${escapeHtml(w.id)}">
          <h4><a href="${escapeHtml(w.url)}" target="_blank" rel="noopener">${escapeHtml(w.title || w.url)}</a></h4>
          <div class="wx-meta">
            ${escapeHtml(w.account || "未知公众号")} · ${escapeHtml(w.date || "")}
            ${tags ? " · " : ""}${tags}
          </div>
          <p class="wx-note">${escapeHtml(w.note || "（可填写你的筛选理由 / 与课题关联，推送时会附上出处）")}</p>
          <div class="wx-actions">
            <button class="linkish" data-act="wx-del">删除</button>
            <button class="linkish" data-act="wx-cite">复制引用</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ---------- 事件 ----------
  function bindEvents() {
    $$(".nav button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.panel;
        $$(".nav button").forEach((b) => b.classList.toggle("active", b === btn));
        $$(".panel").forEach((p) => p.classList.toggle("active", p.id === id));
      });
    });

    $("#btn-search").addEventListener("click", () => {
      const q = $("#q-input").value.trim();
      if (!q) {
        toast("请先描述你的想法");
        $("#q-input").focus();
        return;
      }
      runSearch(q);
    });
    $("#q-input").addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") $("#btn-search").click();
    });
    $("#btn-example").addEventListener("click", () => {
      $("#q-input").value = "扩散模型在小样本病理图像分割上的失败案例与近期综述";
      $("#q-input").focus();
    });
    $("#btn-clear").addEventListener("click", () => {
      $("#q-input").value = "";
      $("#result-list").innerHTML = "";
      $("#intent-panel").classList.remove("show");
      $("#search-status").className = "status-bar";
    });

    $("#btn-save-profile").addEventListener("click", () => {
      state.profile = {
        direction: $("#pf-direction").value.trim(),
        keywords: $("#pf-keywords").value.trim(),
        boost: $("#pf-boost").checked,
      };
      store.set("ls_profile", state.profile);
      toast("画像已保存，检索与日推会加权");
    });

    $("#btn-digest").addEventListener("click", () => runDailyDigest());

    $("#btn-add-wx").addEventListener("click", () => {
      const url = $("#wx-url").value.trim();
      if (!url) return toast("请填写文章链接");
      try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) throw new Error("bad");
      } catch {
        return toast("链接格式不正确");
      }
      const item = {
        id: "wx-" + Date.now(),
        url,
        title: $("#wx-title").value.trim() || url,
        account: $("#wx-account").value.trim(),
        tags: $("#wx-tags").value.trim(),
        note: $("#wx-note").value.trim(),
        date: new Date().toISOString().slice(0, 10),
      };
      state.wx.unshift(item);
      store.set("ls_wx", state.wx);
      ["#wx-url", "#wx-title", "#wx-account", "#wx-tags", "#wx-note"].forEach((s) => ($(s).value = ""));
      renderWx();
      toast("已加入筛选库，出处已保留");
    });

    $("#wx-filter").addEventListener("input", () => renderWx());

    document.body.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      const act = t.dataset.act;
      const card = t.closest(".result, .wx-item");
      if (!card) return;

      if (act === "toggle-abs") {
        const abs = card.querySelector(".result-abs");
        abs.classList.toggle("open");
        t.textContent = abs.classList.contains("open") ? "收起摘要" : "展开摘要";
      }
      if (act === "save") {
        const id = card.dataset.id;
        const idx = state.saved.findIndex((s) => s.id === id);
        const fromResults = state.lastResults.find((r) => r.id === id);
        if (idx >= 0) {
          state.saved.splice(idx, 1);
          toast("已取消收藏");
        } else if (fromResults) {
          state.saved.unshift({ ...fromResults });
          toast("已收藏（含出处）");
        }
        store.set("ls_saved", state.saved);
        if ($("#panel-search").classList.contains("active")) {
          renderResults(state.lastResults, state.lastIntent?.parsed);
        }
        if ($("#panel-saved").classList.contains("active")) renderSaved();
      }
      if (act === "wx-del") {
        const id = card.dataset.id;
        state.wx = state.wx.filter((w) => w.id !== id);
        store.set("ls_wx", state.wx);
        renderWx();
        toast("已删除");
      }
      if (act === "wx-cite") {
        const id = card.dataset.id;
        const w = state.wx.find((x) => x.id === id);
        if (!w) return;
        const cite = `《${w.title}》. ${w.account || "微信公众号"}. ${w.date}. ${w.url}`;
        navigator.clipboard?.writeText(cite).then(
          () => toast("引用格式已复制（含出处链接）"),
          () => toast(cite)
        );
      }
    });

    // 切到收藏/公众号时刷新
    $$(".nav button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.panel === "panel-saved") renderSaved();
        if (btn.dataset.panel === "panel-wx") renderWx();
      });
    });
  }

  function loadProfileForm() {
    $("#pf-direction").value = state.profile.direction || "";
    $("#pf-keywords").value = state.profile.keywords || "";
    $("#pf-boost").checked = !!state.profile.boost;
  }

  // ---------- 启动 ----------
  async function init() {
    bindEvents();
    loadProfileForm();
    renderWx();
    renderSaved();
    await detectServer();
    const mode = state.serverMode
      ? "本地代理已连接（127.0.0.1:8765），检索更稳"
      : "直连模式 · 建议另开终端运行 python server.py 以规避 CORS/限流";
    $("#mode-hint").textContent = mode;
    // 默认示例
    $("#q-input").value = "扩散模型在小样本病理图像分割上的失败案例与近期综述";
  }

  init();
})();
