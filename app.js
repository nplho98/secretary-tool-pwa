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

function setBadge(tabName, count) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  let badge = btn.querySelector(".badge");
  if (count > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "badge";
      btn.appendChild(badge);
    }
    badge.textContent = count;
  } else if (badge) {
    badge.remove();
  }
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
      const { cardCls, pctCls } = q ? quoteCardCls(q) : { cardCls: "quote-card", pctCls: "" };
      const priceHtml = q
        ? `${fmtNum(q.price)} <span class="${pctCls}">${fmtSigned(q.change)}　${fmtSigned(q.pct_change)}%</span>`
        : "尚無報價";

      return `
      <div class="${cardCls}" data-id="${w.id}" data-symbol="${escapeHtml(w.symbol)}">
        <div class="content">
          <div class="title">${escapeHtml(w.name)}（${escapeHtml(w.symbol)}）</div>
          <div class="meta">${priceHtml}</div>
          <div class="threshold-row">
            <label>漲幅通知%
              <input type="number" step="0.1" min="0" class="pct-up-input" value="${w.alert_pct_up ?? ""}">
            </label>
            <label>跌幅通知%
              <input type="number" step="0.1" min="0" class="pct-down-input" value="${w.alert_pct_down ?? ""}">
            </label>
          </div>
        </div>
        <button class="del-btn">刪除</button>
      </div>
    `;
    }).join("");

    customEl.querySelectorAll(".pct-up-input, .pct-down-input").forEach((input) => {
      input.addEventListener("change", async (e) => {
        const card = e.target.closest("[data-id]");
        const id = card.dataset.id;
        const field = e.target.classList.contains("pct-up-input") ? "alert_pct_up" : "alert_pct_down";
        const val = e.target.value === "" ? null : parseFloat(e.target.value);
        await sb.from("stock_watchlist").update({ [field]: val }).eq("id", id);
      });
    });

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
  const pctUp = document.getElementById("wlPctUp").value;
  const pctDown = document.getElementById("wlPctDown").value;
  if (!symbol || !name) return;

  const { data: existing } = await sb.from("stock_watchlist").select("id");
  if (existing && existing.length >= MAX_CUSTOM) return;

  await sb.from("stock_watchlist").insert({
    symbol,
    name,
    source: "yahoo",
    alert_pct_up: pctUp === "" ? null : parseFloat(pctUp),
    alert_pct_down: pctDown === "" ? null : parseFloat(pctDown),
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

// ── 股票漲/跌達標通知 (stock_alerts) ─────────────────────────
async function loadStocks() {
  const el = document.getElementById("stocksList");
  const [{ data, error }, { data: quotes }] = await Promise.all([
    sb.from("stock_alerts").select("*").eq("acknowledged", false).order("created_at", { ascending: true }),
    sb.from("stock_quotes").select("symbol,name,price"),
  ]);

  if (error) {
    el.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(error.message)}</div>`;
    setBadge("stocks", 0);
    return;
  }

  setBadge("stocks", data.length);

  if (!data.length) {
    el.innerHTML = `<div class="empty">目前沒有股票通知</div>`;
    return;
  }

  const quoteMap = {};
  (quotes || []).forEach((q) => { quoteMap[q.symbol] = q; });

  el.innerHTML = data.map((a) => {
    const q = quoteMap[a.symbol];
    const name = q ? q.name : a.symbol;
    const price = a.current_price ?? q?.price;
    const isProfit = a.alert_type === "profit";
    const tagCls = isProfit ? "tag-profit" : "tag-loss";
    const tagLabel = isProfit ? "獲利了結" : "停損";
    return `
    <div class="card alert" data-id="${a.id}">
      <div class="content">
        <div class="title">${escapeHtml(name)}　${fmtNum(price)}　<span class="${tagCls}">${tagLabel}</span></div>
        <div class="meta">${escapeHtml(a.message ?? "")}</div>
        <div class="meta">${fmtTime(a.created_at)}</div>
      </div>
      <button class="ack-btn">知道了</button>
    </div>
  `;
  }).join("");

  el.querySelectorAll(".ack-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const card = e.target.closest(".card");
      const id = card.dataset.id;
      btn.disabled = true;
      await sb.from("stock_alerts").update({ acknowledged: true }).eq("id", id);
      loadStocks();
    });
  });
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

  if (!data.length) {
    el.innerHTML = `<div class="empty">目前沒有筆記</div>`;
    return;
  }

  el.innerHTML = data.map((n) => `
    <div class="card">
      <div class="content">
        <div class="title">${escapeHtml(n.content)}</div>
        <div class="meta">${fmtTime(n.created_at)}</div>
      </div>
    </div>
  `).join("");
}

document.getElementById("noteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("noteInput");
  const content = input.value.trim();
  if (!content) return;
  input.value = "";
  await sb.from("notes").insert({ content, source: "mobile" });
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
    .select("reminder_interval_min,briefing_topics,briefing_time")
    .eq("id", 1)
    .single();

  if (error) return;

  const reminderRadio = document.querySelector(`input[name="reminderInterval"][value="${data.reminder_interval_min}"]`);
  if (reminderRadio) reminderRadio.checked = true;

  document.getElementById("briefingTime").value = data.briefing_time || "08:00";
  document.getElementById("briefingTopics").value = data.briefing_topics || "";
}

document.querySelectorAll('input[name="reminderInterval"]').forEach((radio) => {
  radio.addEventListener("change", async (e) => {
    const minutes = parseInt(e.target.value, 10);
    await sb.from("secretary_settings").update({
      reminder_interval_min: minutes,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
  });
});

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

// ── Tabs ────────────────────────────────────────────────────
const loaders = {
  briefing: loadBriefing,
  stocks: () => { loadQuotes(); loadOutlook(); loadStocks(); },
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
}
