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

// ── 確認 (cc_confirms) ──────────────────────────────────────
async function loadConfirms() {
  const el = document.getElementById("confirmsList");
  const { data, error } = await sb
    .from("cc_confirms")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    el.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(error.message)}</div>`;
    setBadge("confirms", 0);
    return;
  }

  setBadge("confirms", data.length);

  if (!data.length) {
    el.innerHTML = `<div class="empty">目前沒有需要確認的項目</div>`;
    return;
  }

  el.innerHTML = data.map((c) => `
    <div class="card confirm" data-id="${c.id}">
      <div class="content">
        <div class="title">[${escapeHtml(c.project_name)}] ${escapeHtml(c.message)}</div>
        <div class="meta">${fmtTime(c.created_at)}</div>
      </div>
      <button class="resolve-btn">已確認</button>
    </div>
  `).join("");

  el.querySelectorAll(".resolve-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const card = e.target.closest(".card");
      const id = card.dataset.id;
      btn.disabled = true;
      await sb.from("cc_confirms").update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
      }).eq("id", id);
      loadConfirms();
    });
  });
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

async function loadQuotes() {
  const el = document.getElementById("quotesList");
  const { data: quotes, error } = await sb
    .from("stock_quotes")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    el.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!quotes.length) {
    el.innerHTML = `<div class="empty">尚未取得報價，請確認秘書工具是否在執行</div>`;
    return;
  }

  el.innerHTML = quotes.map((q) => {
    let cardCls = "quote-card";
    let pctCls = "";
    if (q.status === "limit_up") cardCls += " limit-up";
    else if (q.status === "limit_down") cardCls += " limit-down";
    else if (q.status === "up") pctCls = "pct-up";
    else if (q.status === "down") pctCls = "pct-down";

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

// ── 股票通知 (stock_alerts) ─────────────────────────────────
async function loadStocks() {
  const el = document.getElementById("stocksList");
  const { data, error } = await sb
    .from("stock_alerts")
    .select("*")
    .eq("acknowledged", false)
    .order("created_at", { ascending: true });

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

  el.innerHTML = data.map((a) => {
    const typeLabel = a.alert_type === "profit" ? "🎯 獲利" : "⚠ 停損";
    return `
    <div class="card alert" data-id="${a.id}">
      <div class="content">
        <div class="title">${typeLabel}：${escapeHtml(a.symbol)}（目標 ${a.target_price}，現價 ${a.current_price ?? "-"}）</div>
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
    .select("auto_approve_level, reminder_interval_min")
    .eq("id", 1)
    .single();

  if (error) return;

  const levelRadio = document.querySelector(`input[name="approveLevel"][value="${data.auto_approve_level}"]`);
  if (levelRadio) levelRadio.checked = true;

  const reminderRadio = document.querySelector(`input[name="reminderInterval"][value="${data.reminder_interval_min}"]`);
  if (reminderRadio) reminderRadio.checked = true;
}

document.querySelectorAll('input[name="approveLevel"]').forEach((radio) => {
  radio.addEventListener("change", async (e) => {
    const level = parseInt(e.target.value, 10);
    await sb.from("secretary_settings").update({
      auto_approve_level: level,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
  });
});

document.querySelectorAll('input[name="reminderInterval"]').forEach((radio) => {
  radio.addEventListener("change", async (e) => {
    const minutes = parseInt(e.target.value, 10);
    await sb.from("secretary_settings").update({
      reminder_interval_min: minutes,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
  });
});

// ── Tabs ────────────────────────────────────────────────────
const loaders = {
  confirms: loadConfirms,
  stocks: () => { loadQuotes(); loadStocks(); },
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
switchTab("confirms");
refreshAll();
setInterval(refreshAll, REFRESH_INTERVAL_MS);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
