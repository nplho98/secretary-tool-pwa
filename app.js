const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const REFRESH_INTERVAL_MS = 30000;

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ── 每日早報 (daily_briefing) ────────────────────────────────
async function loadBriefing() {
  const el = document.getElementById("briefingCard");
  const { data, error } = await sb
    .from("daily_briefing")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    el.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!data || !data.content) {
    el.innerHTML = `<div class="empty">今天的早報還沒產生</div>`;
    return;
  }

  el.innerHTML = `
    <div class="card">
      <div class="content">
        <div class="title" style="white-space: pre-wrap;">${escapeHtml(data.content)}</div>
        <div class="meta">更新時間：${fmtTime(data.updated_at)}</div>
      </div>
    </div>
  `;
}

// ── 自選股報價 (stock_watchlist / stock_quotes) ─────────────
function fmtNum(n, digits = 2) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtSigned(n, digits = 2) {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  return (v >= 0 ? "+" : "") + v.toFixed(digits);
}

const FIXED_SYMBOLS = ["2330.TW", "^SOX", "^IXIC", "YM=F", "TXFN1", "^TWII"];
const MAX_CUSTOM = 6;

function quoteCardCls(q) {
  let cardCls = "quote-card";
  let pctCls = "";
  if (q.status === "limit_up") cardCls += " limit-up";
  else if (q.status === "limit_down") cardCls += " limit-down";
  else if (q.status === "up") pctCls = "pct-up";
  else if (q.status === "down") pctCls = "pct-down";
  return { cardCls, pctCls };
}

async function loadQuotes() {
  const fixedEl = document.getElementById("fixedQuotesList");
  const customEl = document.getElementById("customQuotesList");

  const [{ data: quotes, error: qError }, { data: watchlist, error: wError }] = await Promise.all([
    sb.from("stock_quotes").select("*").order("sort_order", { ascending: true }),
    sb.from("stock_watchlist").select("*").order("sort_order", { ascending: true }),
  ]);

  if (qError) {
    fixedEl.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(qError.message)}</div>`;
    customEl.innerHTML = "";
    return;
  }

  const quoteMap = {};
  quotes.forEach((q) => { quoteMap[q.symbol] = q; });

  const fixedQuotes = quotes.filter((q) => FIXED_SYMBOLS.includes(q.symbol));
  if (!fixedQuotes.length) {
    fixedEl.innerHTML = `<div class="empty">尚未取得報價，請確認秘書工具是否在執行</div>`;
  } else {
    fixedEl.innerHTML = fixedQuotes.map((q) => {
      const { cardCls, pctCls } = quoteCardCls(q);
      return `
      <div class="${cardCls}">
        <div class="content">
          <div class="title">${escapeHtml(q.name)}（${escapeHtml(q.symbol)}）</div>
          <div class="meta">
            ${fmtNum(q.price)}
            <span class="${pctCls}">${fmtSigned(q.change)}　${fmtSigned(q.pct_change)}%</span>
          </div>
        </div>
      </div>
    `;
    }).join("");
  }

  // ── 自選股 ──
  if (wError) {
    customEl.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(wError.message)}</div>`;
  } else if (!watchlist.length) {
    customEl.innerHTML = `<div class="empty">尚未新增自選股</div>`;
  } else {
    customEl.innerHTML = watchlist.map((w) => {
      const q = quoteMap[w.symbol];
      let priceHtml = "尚無報價";
      let cardCls = "quote-card";
      if (q) {
        const { cardCls: c } = quoteCardCls(q);
        cardCls = c;
        const prevClose = q.price - q.change;
        const dirCls = (q.status === "limit_up" || q.status === "up") ? "up"
          : (q.status === "limit_down" || q.status === "down") ? "down"
          : "flat";
        priceHtml = `${fmtNum(prevClose)} (<span class="cur-price ${dirCls}">${fmtNum(q.price)}</span>) ${fmtSigned(q.change)}`;
      }

      return `
      <div class="${cardCls}" data-id="${w.id}" data-symbol="${escapeHtml(w.symbol)}">
        <div class="content">
          <div class="title">${escapeHtml(w.name)}（${escapeHtml(w.symbol)}）</div>
          <div class="meta">${priceHtml}</div>
        </div>
        <button class="del-btn">刪除</button>
      </div>
    `;
    }).join("");

    customEl.querySelectorAll(".del-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const card = e.target.closest("[data-id]");
        const id = card.dataset.id;
        const symbol = card.dataset.symbol;
        btn.disabled = true;
        await sb.from("stock_watchlist").delete().eq("id", id);
        await sb.from("stock_quotes").delete().eq("symbol", symbol);
        loadQuotes();
      });
    });
  }

  const form = document.getElementById("watchlistForm");
  form.style.display = watchlist && watchlist.length >= MAX_CUSTOM ? "none" : "flex";
}

document.getElementById("watchlistForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const symbol = document.getElementById("wlSymbol").value.trim();
  const name = document.getElementById("wlName").value.trim();
  if (!symbol || !name) return;

  const { data: existing } = await sb.from("stock_watchlist").select("id");
  if (existing && existing.length >= MAX_CUSTOM) return;

  await sb.from("stock_watchlist").insert({
    symbol,
    name,
    source: "yahoo",
    sort_order: 7 + (existing ? existing.length : 0),
  });

  e.target.reset();
  loadQuotes();
});

// ── 大盤趨勢研判 (market_outlook) ────────────────────────────
async function loadOutlook() {
  const el = document.getElementById("outlookCard");
  const { data, error } = await sb
    .from("market_outlook")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data || !data.summary) {
    el.innerHTML = `<div class="empty">尚無研判資料</div>`;
    return;
  }

  el.innerHTML = `
    <div class="card">
      <div class="content">
        <div class="title">${escapeHtml(data.summary)}</div>
        <div class="meta">${fmtTime(data.updated_at)}</div>
      </div>
    </div>
  `;
}

// ── 待辦事項 (todos) ────────────────────────────────────────
async function loadTodos() {
  const el = document.getElementById("todosList");
  const { data, error } = await sb
    .from("todos")
    .select("*")
    .eq("done", false)
    .order("created_at", { ascending: true });

  if (error) {
    el.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!data.length) {
    el.innerHTML = `<div class="empty">目前沒有待辦事項</div>`;
    return;
  }

  el.innerHTML = data.map((t) => `
    <div class="card" data-id="${t.id}">
      <div class="todo-row">
        <input type="checkbox" class="done-check">
        <div class="content">
          <div class="title">${escapeHtml(t.title)}</div>
          <div class="meta">${fmtTime(t.created_at)}</div>
        </div>
      </div>
    </div>
  `).join("");

  el.querySelectorAll(".done-check").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      const card = e.target.closest(".card");
      const id = card.dataset.id;
      cb.disabled = true;
      await sb.from("todos").update({
        done: true,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      loadTodos();
    });
  });
}

document.getElementById("todoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("todoInput");
  const title = input.value.trim();
  if (!title) return;
  input.value = "";
  await sb.from("todos").insert({ title, source: "mobile" });
  loadTodos();
});

// ── 筆記 (notes) ────────────────────────────────────────────
let notesCache = [];

async function loadNotes() {
  const el = document.getElementById("notesList");
  const { data, error } = await sb
    .from("notes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    el.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(error.message)}</div>`;
    return;
  }

  notesCache = data;

  if (!data.length) {
    el.innerHTML = `<div class="empty">目前沒有筆記</div>`;
    return;
  }

  el.innerHTML = data.map((n) => `
    <div class="card" data-id="${n.id}">
      <div class="content note-title-click">
        <div class="title">${escapeHtml(n.title || "(無標題)")}</div>
        <div class="meta">${fmtTime(n.created_at)}</div>
      </div>
      <button class="del-btn">刪除</button>
    </div>
  `).join("");

  el.querySelectorAll(".note-title-click").forEach((div) => {
    div.addEventListener("click", () => {
      const id = div.closest(".card").dataset.id;
      const note = notesCache.find((n) => n.id === id);
      if (note) showNoteDetail(note);
    });
  });

  el.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest(".card").dataset.id;
      btn.disabled = true;
      await sb.from("notes").delete().eq("id", id);
      loadNotes();
    });
  });
}

function showNoteDetail(note) {
  document.getElementById("noteDetailTitle").textContent = note.title || "(無標題)";
  document.getElementById("noteDetailMeta").textContent = fmtTime(note.created_at);
  document.getElementById("noteDetailContent").textContent = note.content || "";
  document.getElementById("notesListView").classList.add("hidden");
  document.getElementById("noteDetailView").classList.remove("hidden");
}

function showNotesList() {
  document.getElementById("noteDetailView").classList.add("hidden");
  document.getElementById("notesListView").classList.remove("hidden");
}

document.getElementById("noteBackBtn").addEventListener("click", showNotesList);

document.getElementById("noteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const titleInput = document.getElementById("noteTitleInput");
  const contentInput = document.getElementById("noteContentInput");
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title && !content) return;
  titleInput.value = "";
  contentInput.value = "";
  await sb.from("notes").insert({ title, content, source: "mobile" });
  loadNotes();
});

// ── 行程 (schedule) ─────────────────────────────────────────
async function loadSchedule() {
  const el = document.getElementById("scheduleList");
  const { data, error } = await sb
    .from("schedule")
    .select("*")
    .order("start_time", { ascending: true })
    .limit(30);

  if (error) {
    el.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!data.length) {
    el.innerHTML = `<div class="empty">目前沒有行程</div>`;
    return;
  }

  el.innerHTML = data.map((s) => `
    <div class="card">
      <div class="content">
        <div class="title">${escapeHtml(s.title)}</div>
        <div class="meta">${fmtTime(s.start_time)}${s.end_time ? " ~ " + fmtTime(s.end_time) : ""}</div>
        ${s.notes ? `<div class="meta">${escapeHtml(s.notes)}</div>` : ""}
      </div>
    </div>
  `).join("");
}

// ── 設定 (secretary_settings) ──────────────────────────────
async function loadSettings() {
  const { data, error } = await sb
    .from("secretary_settings")
    .select("briefing_topics,briefing_time")
    .eq("id", 1)
    .single();

  if (!error) {
    document.getElementById("briefingTime").value = data.briefing_time || "08:00";
    document.getElementById("briefingTopics").value = data.briefing_topics || "";
  }

  const { data: sumData } = await sb
    .from("summary_requests")
    .select("content,result,status")
    .eq("id", 1)
    .maybeSingle();

  if (sumData) {
    document.getElementById("summaryInput").value = sumData.content || "";
    const done = sumData.status === "done";
    document.getElementById("summaryResult").textContent = done ? (sumData.result || "") : "";
    document.getElementById("summaryToNoteRow").classList.toggle("hidden", !done);
  }
}

document.getElementById("briefingTime").addEventListener("change", async (e) => {
  await sb.from("secretary_settings").update({
    briefing_time: e.target.value,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
});

document.getElementById("briefingTopics").addEventListener("change", async (e) => {
  await sb.from("secretary_settings").update({
    briefing_topics: e.target.value,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
});

document.getElementById("summaryBtn").addEventListener("click", async (e) => {
  const btn = e.target;
  const content = document.getElementById("summaryInput").value.trim();
  if (!content) return;
  btn.disabled = true;
  btn.textContent = "整理中…";
  document.getElementById("summaryResult").textContent = "";
  document.getElementById("summaryToNoteRow").classList.add("hidden");

  await sb.from("summary_requests").update({
    content,
    result: null,
    status: "pending",
    updated_at: new Date().toISOString(),
  }).eq("id", 1);

  const requestedAt = Date.now();
  const timer = setInterval(async () => {
    const { data } = await sb
      .from("summary_requests")
      .select("status,result,updated_at")
      .eq("id", 1)
      .maybeSingle();

    const updatedAfter = data && new Date(data.updated_at).getTime() >= requestedAt;

    if (data && data.status === "done" && updatedAfter) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = "整理重點";
      document.getElementById("summaryResult").textContent = data.result || "";
      document.getElementById("summaryNoteTitle").value = "";
      document.getElementById("summaryToNoteBtn").disabled = true;
      document.getElementById("summaryToNoteRow").classList.remove("hidden");
    } else if (data && data.status === "error" && updatedAfter) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = "整理重點";
      document.getElementById("summaryResult").textContent = "整理失敗，請稍後再試";
    } else if (Date.now() - requestedAt > 60000) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = "整理重點";
      document.getElementById("summaryResult").textContent = "整理逾時，請確認秘書工具是否在執行";
    }
  }, 3000);
});

document.getElementById("summaryNoteTitle").addEventListener("input", (e) => {
  document.getElementById("summaryToNoteBtn").disabled = !e.target.value.trim();
});

document.getElementById("summaryToNoteBtn").addEventListener("click", async (e) => {
  const btn = e.target;
  const title = document.getElementById("summaryNoteTitle").value.trim();
  const content = document.getElementById("summaryResult").textContent.trim();
  if (!title || !content) return;
  btn.disabled = true;
  await sb.from("notes").insert({ title, content, source: "mobile" });
  document.getElementById("summaryInput").value = "";
  document.getElementById("summaryResult").textContent = "";
  document.getElementById("summaryNoteTitle").value = "";
  document.getElementById("summaryToNoteRow").classList.add("hidden");
  btn.textContent = "已新增";
  setTimeout(() => { btn.textContent = "新增到筆記"; }, 2000);
});

document.getElementById("stockRefreshBtn").addEventListener("click", async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = "更新中…";

  await sb.from("secretary_settings").update({
    instant_stock_refresh_requested: true,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);

  const requestedAt = Date.now();
  const timer = setInterval(async () => {
    const { data } = await sb
      .from("stock_quotes")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const done = data && new Date(data.updated_at).getTime() >= requestedAt;
    if (done || Date.now() - requestedAt > 90000) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = "即時更新股票";
      if (done) loadQuotes();
    }
  }, 3000);
});

document.getElementById("instantBriefingBtn").addEventListener("click", async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = "產生中…";

  // 立馬匯報前先確保自訂內容已存檔
  await sb.from("secretary_settings").update({
    briefing_topics: document.getElementById("briefingTopics").value,
    briefing_time: document.getElementById("briefingTime").value,
    instant_briefing_requested: true,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);

  const requestedAt = Date.now();
  const timer = setInterval(async () => {
    const { data } = await sb
      .from("daily_briefing")
      .select("updated_at")
      .eq("id", 1)
      .maybeSingle();

    const done = data && new Date(data.updated_at).getTime() >= requestedAt;
    if (done || Date.now() - requestedAt > 60000) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = "立馬匯報";
      if (done) {
        switchTab("briefing");
      }
    }
  }, 3000);
});

// ── Tabs ────────────────────────────────────────────────────
const loaders = {
  briefing: loadBriefing,
  stocks: () => { loadQuotes(); loadOutlook(); },
  todos: loadTodos,
  notes: loadNotes,
  schedule: loadSchedule,
  settings: loadSettings,
};

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById(`tab-${name}`).classList.add("active");
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add("active");
  if (name !== "notes") showNotesList();
  loaders[name]();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.getElementById("refreshBtn").addEventListener("click", refreshAll);

function refreshAll() {
  Object.values(loaders).forEach((fn) => fn());
}

// ── Init ────────────────────────────────────────────────────
switchTab("briefing");
refreshAll();
setInterval(refreshAll, REFRESH_INTERVAL_MS);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  });
}
