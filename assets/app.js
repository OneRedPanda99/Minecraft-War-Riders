/* global jsyaml */
(() => {
  // mcasset.cloud mirrors official client assets in a stable URL format.
  // minecraft.net does not provide a reliable per-item icon endpoint.
  const MC_ASSET_VERSION = "1.20.4";
  const MC_ASSET_BASE = `https://mcasset.cloud/${MC_ASSET_VERSION}/assets/minecraft/textures`;

  const CATEGORIES = [
    { id: "ALL", file: null, label: "All categories" },
    { id: "Z_EverythingElse", file: "Z_EverythingElse.yml", label: "Everything Else" },
    { id: "Blocks", file: "Blocks.yml", label: "Blocks" },
    { id: "Decoration", file: "Decoration.yml", label: "Decoration" },
    { id: "Redstone", file: "Redstone.yml", label: "Redstone" },
    { id: "Ores", file: "Ores.yml", label: "Ores" },
    { id: "Food", file: "Food.yml", label: "Food" },
    { id: "Farming", file: "Farming.yml", label: "Farming" },
    { id: "Mobs", file: "Mobs.yml", label: "Mobs" },
    { id: "SpawnEggs", file: "SpawnEggs.yml", label: "Spawn Eggs" },
    { id: "Spawners", file: "Spawners.yml", label: "Spawners" },
    { id: "Enchanting", file: "Enchanting.yml", label: "Enchanting" },
    { id: "Potions", file: "Potions.yml", label: "Potions" },
    { id: "Dyes", file: "Dyes.yml", label: "Dyes" },
    { id: "Workstations", file: "Workstations.yml", label: "Workstations" },
    { id: "Music", file: "Music.yml", label: "Music" },
    { id: "Automation", file: "Automation.yml", label: "Automation" },
    { id: "Miscellaneous", file: "Miscellaneous.yml", label: "Miscellaneous" },
  ];

  const $ = (id) => document.getElementById(id);
  const els = {
    categorySelect: $("categorySelect"),
    searchInput: $("searchInput"),
    sortSelect: $("sortSelect"),
    hideNoPrice: $("hideNoPrice"),
    onlyAutosell: $("onlyAutosell"),
    refreshBtn: $("refreshBtn"),
    statusText: $("statusText"),
    statusHint: $("statusHint"),
    resultsTitle: $("resultsTitle"),
    resultsMeta: $("resultsMeta"),
    itemsTbody: $("itemsTbody"),
    toggleTheme: $("toggleTheme"),
    githubLink: $("githubLink"),
  };

  /** @type {Array<any>} */
  let rawItems = [];
  /** @type {string} */
  let currentCategoryId = "";
  /** @type {number | null} */
  let renderTimer = null;

  function safeNumber(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }

  function normalizeText(s) {
    return String(s ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function money(v) {
    if (v === null || v === undefined) return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    if (n < 0) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function decodeLegacyColorCodes(text) {
    // Strip Minecraft formatting codes: &a, &l, §7, etc.
    return String(text ?? "").replace(/(&[0-9a-fk-or])|(§[0-9a-fk-or])/gi, "");
  }

  function setStatus(text, hint = "") {
    els.statusText.textContent = text;
    els.statusHint.textContent = hint;
  }

  function debounceRender(delayMs = 120) {
    if (renderTimer != null) window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => render(rawItems), delayMs);
  }

  function getSort() {
    const [key, dir] = String(els.sortSelect.value || "material:asc").split(":");
    return { key, dir: dir === "desc" ? "desc" : "asc" };
  }

  function getFilters() {
    return {
      q: normalizeText(els.searchInput.value),
      hideNoPrice: Boolean(els.hideNoPrice.checked),
      onlyAutosell: Boolean(els.onlyAutosell.checked),
      sort: getSort(),
    };
  }

  function itemSearchText(item) {
    const parts = [
      item.material,
      item.nameText,
      ...(item.loreTextArr || []),
      item.categoryLabel,
    ];
    return normalizeText(parts.filter(Boolean).join(" "));
  }

  function applyFilters(items) {
    const { q, hideNoPrice, onlyAutosell, sort } = getFilters();

    let out = items;

    if (hideNoPrice) {
      out = out.filter((it) => (it.buy !== null && it.buy >= 0) || (it.sell !== null && it.sell >= 0));
    }

    if (onlyAutosell) {
      out = out.filter((it) => it.autosell === true);
    }

    if (q) {
      out = out.filter((it) => it._search.includes(q));
    }

    out = [...out].sort((a, b) => {
      const dir = sort.dir === "desc" ? -1 : 1;
      const key = sort.key;
      if (key === "buy" || key === "sell") {
        const av = a[key] ?? -Infinity;
        const bv = b[key] ?? -Infinity;
        return (av - bv) * dir;
      }
      const av = normalizeText(a[key] ?? "");
      const bv = normalizeText(b[key] ?? "");
      return av.localeCompare(bv) * dir;
    });

    return out;
  }

  function materialToTextureName(material) {
    return normalizeText(material).replaceAll(" ", "_").toLowerCase();
  }

  function textureCandidates(material) {
    const name = materialToTextureName(material);
    if (!name) return [];

    // Most inventory icons are item textures; many blocks exist only as block textures.
    // We'll try both with a tiny heuristic order for common block-ish names.
    const preferBlock =
      /(_block|_bricks|_brick|_planks|_stairs|_slab|_wall|_log|_wood|_ore|_glass|_terracotta|_concrete|_wool|_sandstone|_stone|_deepslate)$/.test(
        name,
      ) || ["stone", "dirt", "grass_block", "cobblestone", "netherrack", "end_stone"].includes(name);

    const blockUrl = `${MC_ASSET_BASE}/block/${encodeURIComponent(name)}.png`;
    const itemUrl = `${MC_ASSET_BASE}/item/${encodeURIComponent(name)}.png`;

    return preferBlock ? [blockUrl, itemUrl] : [itemUrl, blockUrl];
  }

  function createItemIcon(material) {
    const img = document.createElement("img");
    img.className = "item-icon";
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = material ? `${material} icon` : "Item icon";

    const candidates = textureCandidates(material);
    let idx = 0;

    const tryNext = () => {
      if (idx >= candidates.length) {
        img.removeAttribute("src");
        img.alt = material ? `${material} (icon unavailable)` : "Icon unavailable";
        return;
      }
      img.src = candidates[idx];
      idx += 1;
    };

    img.addEventListener("error", tryNext);
    tryNext();
    return img;
  }

  async function copyText(text) {
    const t = String(text ?? "");
    try {
      await navigator.clipboard.writeText(t);
      setStatus("Copied to clipboard.", t);
    } catch {
      // Fallback for older/locked-down contexts
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setStatus("Copied to clipboard.", t);
      } finally {
        ta.remove();
      }
    }
  }

  function render(items) {
    const filtered = applyFilters(items);
    els.itemsTbody.textContent = "";

    if (filtered.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "empty";
      td.textContent = items.length === 0 ? "No items loaded." : "No results. Try a different search or filter.";
      tr.appendChild(td);
      els.itemsTbody.appendChild(tr);
      els.resultsMeta.textContent = `0 shown / ${items.length.toLocaleString()} loaded`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const it of filtered) {
      const tr = document.createElement("tr");

      const tdIcon = document.createElement("td");
      tdIcon.className = "icon-cell";
      tdIcon.appendChild(createItemIcon(it.material || ""));

      const tdMaterial = document.createElement("td");
      const materialRow = document.createElement("div");
      materialRow.style.display = "flex";
      materialRow.style.alignItems = "center";
      materialRow.style.gap = "10px";

      const materialText = document.createElement("span");
      materialText.className = "mono";
      materialText.textContent = it.material || "—";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn-inline";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", () => copyText(it.material || ""));

      materialRow.append(materialText, copyBtn);
      tdMaterial.appendChild(materialRow);

      const tdBuy = document.createElement("td");
      tdBuy.textContent = money(it.buy);

      const tdSell = document.createElement("td");
      tdSell.textContent = money(it.sell);

      const tdName = document.createElement("td");
      tdName.textContent = it.nameText || "—";

      const tdDetails = document.createElement("td");
      const details = document.createElement("div");
      details.className = "details";

      const pills = document.createElement("div");
      pills.style.display = "flex";
      pills.style.gap = "8px";
      pills.style.flexWrap = "wrap";

      const categoryPill = document.createElement("span");
      categoryPill.className = "pill";
      categoryPill.textContent = it.categoryLabel;
      pills.appendChild(categoryPill);

      if (it.pageId) {
        const pagePill = document.createElement("span");
        pagePill.className = "pill mono";
        pagePill.textContent = it.pageId;
        pills.appendChild(pagePill);
      }

      if (it.autosell === true) {
        const p = document.createElement("span");
        p.className = "pill";
        p.textContent = "autosell";
        pills.appendChild(p);
      }

      if (it.guiRows != null) {
        const p = document.createElement("span");
        p.className = "pill mono";
        p.textContent = `rows:${it.guiRows}`;
        pills.appendChild(p);
      }

      details.appendChild(pills);

      if (it.loreTextArr?.length) {
        const lore = document.createElement("div");
        lore.className = "lore";
        lore.textContent = it.loreTextArr.join(" | ");
        details.appendChild(lore);
      }

      tdDetails.appendChild(details);

      tr.append(tdIcon, tdMaterial, tdBuy, tdSell, tdName, tdDetails);
      frag.appendChild(tr);
    }

    els.itemsTbody.appendChild(frag);

    els.resultsMeta.textContent = `${filtered.length.toLocaleString()} shown / ${items.length.toLocaleString()} loaded`;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function flattenYaml(doc, categoryLabel) {
    /** @type {Array<any>} */
    const flattened = [];

    const pages = doc?.pages;
    if (!pages || typeof pages !== "object") return flattened;

    for (const [pageId, pageObj] of Object.entries(pages)) {
      const guiRows = safeNumber(pageObj?.["gui-rows"]);
      const itemsObj = pageObj?.items;
      if (!itemsObj || typeof itemsObj !== "object") continue;

      for (const [slotOrId, it] of Object.entries(itemsObj)) {
        const material = it?.material ?? null;
        const buy = safeNumber(it?.buy);
        const sell = safeNumber(it?.sell);

        const nameTextRaw = it?.name ?? "";
        const loreRaw = Array.isArray(it?.lore) ? it.lore : [];
        const loreTextArr = loreRaw.map((x) => decodeLegacyColorCodes(x)).filter(Boolean);

        const nameText = decodeLegacyColorCodes(nameTextRaw) || "";
        const autosell = it?.autosell === true;

        const item = {
          id: String(slotOrId),
          pageId,
          guiRows: guiRows ?? null,
          categoryLabel,
          material: material ? String(material) : "",
          buy,
          sell,
          nameText,
          loreTextArr,
          autosell,
        };
        item._search = itemSearchText(item);
        flattened.push(item);
      }
    }

    return flattened;
  }

  async function fetchAndFlattenCategory(cat) {
    if (!cat?.file) return [];
    const res = await fetch(`./${encodeURIComponent(cat.file)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${cat.file}`);
    const text = await res.text();
    const doc = window.jsyaml.load(text);
    return flattenYaml(doc, cat.label);
  }

  async function loadCategory(categoryId) {
    const cat = CATEGORIES.find((c) => c.id === categoryId) || CATEGORIES[0];
    if (!cat) return;

    currentCategoryId = cat.id;
    setStatus(`Loading ${cat.label}…`, cat.file || "");

    if (!window.jsyaml) {
      setStatus("YAML parser failed to load.", "js-yaml missing");
      rawItems = [];
      render(rawItems);
      return;
    }

    try {
      if (cat.id === "ALL") {
        const cats = CATEGORIES.filter((c) => c.file);
        const settled = await Promise.allSettled(cats.map((c) => fetchAndFlattenCategory(c)));

        const okItems = [];
        const failures = [];
        for (let i = 0; i < settled.length; i += 1) {
          const s = settled[i];
          const c = cats[i];
          if (s.status === "fulfilled") okItems.push(...s.value);
          else failures.push(c?.file || c?.id || "unknown");
        }

        rawItems = okItems;
        els.resultsTitle.textContent = `${cat.label}`;
        const hint = failures.length ? `missing: ${failures.join(", ")}` : `${rawItems.length.toLocaleString()} items`;
        setStatus(`Loaded ${cat.label}.`, hint);
        render(rawItems);
        return;
      }

      rawItems = await fetchAndFlattenCategory(cat);
      setStatus(`Loaded ${cat.label}.`, `${rawItems.length.toLocaleString()} items`);
      els.resultsTitle.textContent = `${cat.label}`;
      render(rawItems);
    } catch (err) {
      console.error(err);
      rawItems = [];
      setStatus("Could not load category file.", String(err?.message || err));
      els.resultsTitle.textContent = `${cat.label}`;
      render(rawItems);
    }
  }

  function setupCategorySelect() {
    els.categorySelect.textContent = "";
    for (const c of CATEGORIES) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.label;
      els.categorySelect.appendChild(opt);
    }

    const defaultCat = CATEGORIES.find((c) => c.id === "Z_EverythingElse") || CATEGORIES[0];
    els.categorySelect.value = defaultCat?.id || "";
  }

  function getThemePreference() {
    const stored = localStorage.getItem("mwr-theme");
    if (stored === "light" || stored === "dark") return stored;
    return null;
  }

  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");

    els.toggleTheme.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  }

  function setupThemeToggle() {
    const pref = getThemePreference();
    applyTheme(pref === "dark" ? "dark" : "light");

    els.toggleTheme.addEventListener("click", () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const next = isDark ? "light" : "dark";
      localStorage.setItem("mwr-theme", next);
      applyTheme(next);
    });
  }

  function setupEvents() {
    els.searchInput.addEventListener("input", () => debounceRender(120));
    els.sortSelect.addEventListener("change", () => render(rawItems));
    els.hideNoPrice.addEventListener("change", () => render(rawItems));
    els.onlyAutosell.addEventListener("change", () => render(rawItems));

    els.categorySelect.addEventListener("change", () => loadCategory(els.categorySelect.value));
    els.refreshBtn.addEventListener("click", () => loadCategory(currentCategoryId || els.categorySelect.value));

    // Keyboard shortcut: "/" focuses search (common in dashboards)
    window.addEventListener("keydown", (e) => {
      if (e.key !== "/") return;
      const active = document.activeElement;
      const isTyping =
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.getAttribute("contenteditable") === "true");
      if (isTyping) return;
      e.preventDefault();
      els.searchInput.focus();
    });
  }

  function setupGithubLink() {
    if (!els.githubLink) return;
    // Best-effort guess: if hosted on GitHub Pages, origin is *github.io* and pathname begins with /<repo>/
    const path = window.location.pathname || "/";
    const parts = path.split("/").filter(Boolean);
    const repo = parts.length ? parts[0] : "Minecraft-War-Riders";
    els.githubLink.href = `https://github.com/${repo}`;
    // If you’re not on Pages, at least don’t send users to github.com root.
    els.githubLink.textContent = "Repo";
  }

  function init() {
    setupCategorySelect();
    setupEvents();
    setupThemeToggle();
    setupGithubLink();
    loadCategory(els.categorySelect.value);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

