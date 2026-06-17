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
        if (!confirm("確定要刪除嗎？")) return;
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

  const atMax = watchlist && watchlist.length >= MAX_CUSTOM;
  ["wlAddBtn", "wlSymbol", "wlName"].forEach((id) => {
    document.getElementById(id).style.display = atMax ? "none" : "";
  });
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
let todosCache = [];

function combineDateTime(dateStr, hour12, minute, ampm) {
  if (!dateStr || !hour12 || minute === "" || !ampm) return null;
  let h = parseInt(hour12, 10) % 12;
  if (ampm === "PM") h += 12;
  return new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).toISOString();
}

function splitDateTime(iso) {
  if (!iso) return { date: "", hour12: "", minute: "", ampm: "" };
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ampm = d.getHours() >= 12 ? "PM" : "AM";
  let hour12 = d.getHours() % 12;
  if (hour12 === 0) hour12 = 12;
  return { date, hour12: String(hour12), minute: String(d.getMinutes()), ampm };
}

function syncFieldPlaceholder(input) {
  input.classList.toggle("has-value", !!input.value);
}

["todoDateInput", "todoEditDate"].forEach((id) => {
  const input = document.getElementById(id);
  input.addEventListener("input", () => syncFieldPlaceholder(input));
});

function fillTimeSelect(select, options, placeholder) {
  select.innerHTML = `<option value="">${placeholder}</option>` + options.map((v) =>
    `<option value="${v}">${String(v).padStart(2, "0")}</option>`
  ).join("");
}

["todoTimeHour", "todoEditTimeHour"].forEach((id) => {
  fillTimeSelect(document.getElementById(id), Array.from({ length: 12 }, (_, i) => i + 1), "時");
});
["todoTimeMinute", "todoEditTimeMinute"].forEach((id) => {
  fillTimeSelect(document.getElementById(id), Array.from({ length: 60 }, (_, i) => i), "分");
});

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

  todosCache = data;

  if (!data.length) {
    el.innerHTML = `<div class="empty">目前沒有待辦事項</div>`;
    return;
  }

  el.innerHTML = data.map((t) => `
    <div class="card" data-id="${t.id}">
      <div class="todo-row">
        <input type="checkbox" class="done-check">
        <div class="content todo-title-click">
          <div class="title">${escapeHtml(t.title)}</div>
          ${t.due_date ? `<div class="meta">${fmtTime(t.due_date)}</div>` : ""}
        </div>
      </div>
    </div>
  `).join("");

  el.querySelectorAll(".todo-title-click").forEach((div) => {
    div.addEventListener("click", () => {
      const id = div.closest(".card").dataset.id;
      const todo = todosCache.find((t) => t.id === id);
      if (todo) showTodoEdit(todo);
    });
  });

  el.querySelectorAll(".done-check").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      if (!confirm("確定要標記完成嗎？完成後會直接刪除這筆待辦。")) {
        cb.checked = false;
        return;
      }
      const card = e.target.closest(".card");
      const id = card.dataset.id;
      cb.disabled = true;
      await sb.from("todos").delete().eq("id", id);
      loadTodos();
    });
  });
}

function showTodoEdit(todo) {
  document.getElementById("todoEditForm").dataset.id = todo.id;
  document.getElementById("todoEditTitle").value = todo.title || "";
  document.getElementById("todoEditContent").value = todo.notes || "";
  const { date, hour12, minute, ampm } = splitDateTime(todo.due_date);
  const dateInput = document.getElementById("todoEditDate");
  dateInput.value = date;
  syncFieldPlaceholder(dateInput);
  document.getElementById("todoEditTimeAmpm").value = ampm;
  document.getElementById("todoEditTimeHour").value = hour12;
  document.getElementById("todoEditTimeMinute").value = minute;
  document.getElementById("todosListView").classList.add("hidden");
  document.getElementById("todoEditView").classList.remove("hidden");
}

function showTodosList() {
  document.getElementById("todoEditView").classList.add("hidden");
  document.getElementById("todosListView").classList.remove("hidden");
}

document.getElementById("todoBackBtn").addEventListener("click", showTodosList);

document.getElementById("todoEditForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = e.target.dataset.id;
  const title = document.getElementById("todoEditTitle").value.trim();
  if (!title) return;
  const due_date = combineDateTime(
    document.getElementById("todoEditDate").value,
    document.getElementById("todoEditTimeHour").value,
    document.getElementById("todoEditTimeMinute").value,
    document.getElementById("todoEditTimeAmpm").value
  );
  const notes = document.getElementById("todoEditContent").value.trim();
  await sb.from("todos").update({ title, due_date, notes }).eq("id", id);
  showTodosList();
  loadTodos();
});

document.getElementById("todoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("todoInput");
  const title = input.value.trim();
  if (!title) return;
  const ampmSelect = document.getElementById("todoTimeAmpm");
  const hourSelect = document.getElementById("todoTimeHour");
  const minuteSelect = document.getElementById("todoTimeMinute");
  const due_date = combineDateTime(
    document.getElementById("todoDateInput").value,
    hourSelect.value,
    minuteSelect.value,
    ampmSelect.value
  );
  const contentInput = document.getElementById("todoContentInput");
  const notes = contentInput.value.trim();
  const dateInput = document.getElementById("todoDateInput");
  input.value = "";
  dateInput.value = "";
  syncFieldPlaceholder(dateInput);
  ampmSelect.value = "";
  hourSelect.value = "";
  minuteSelect.value = "";
  contentInput.value = "";
  await sb.from("todos").insert({ title, due_date, notes, source: "mobile" });
  loadTodos();
});

// ── 筆記分類 (note_categories) ────────────────────────────────
let categoriesCache = [];

async function loadCategories() {
  const { data, error } = await sb
    .from("note_categories")
    .select("*")
    .order("name", { ascending: true });

  if (error) return;
  categoriesCache = data;

  const options = data.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  const filter = document.getElementById("noteCategoryFilter");
  const keepFilter = filter.value;
  filter.innerHTML = `<option value="">全部分類</option>${options}`;
  filter.value = keepFilter;

  document.getElementById("noteCategorySelect").innerHTML = `<option value="">未分類</option>${options}`;
  document.getElementById("noteEditCategorySelect").innerHTML = `<option value="">未分類</option>${options}`;

  const manageEl = document.getElementById("categoryManageList");
  manageEl.innerHTML = data.map((c) => `
    <span class="category-chip" data-id="${c.id}">
      ${escapeHtml(c.name)}
      <button type="button" class="category-del-btn">×</button>
    </span>
  `).join("");

  manageEl.querySelectorAll(".category-del-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      if (!confirm("確定要刪除嗎？此分類下的筆記會變回未分類。")) return;
      const id = e.target.closest(".category-chip").dataset.id;
      await sb.from("note_categories").delete().eq("id", id);
      loadCategories();
      loadNotes();
    });
  });
}

document.getElementById("categoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("categoryNameInput");
  const name = input.value.trim();
  if (!name) return;
  input.value = "";
  await sb.from("note_categories").insert({ name });
  loadCategories();
});

document.getElementById("noteCategoryFilter").addEventListener("change", loadNotes);

document.getElementById("categoryManageToggle").addEventListener("click", (e) => {
  const list = document.getElementById("categoryManageList");
  const hidden = list.classList.toggle("hidden");
  e.target.textContent = hidden ? "管理分類 ▾" : "管理分類 ▴";
});

// ── 筆記 (notes) ────────────────────────────────────────────
let notesCache = [];

async function loadNotes() {
  const el = document.getElementById("notesList");
  const categoryId = document.getElementById("noteCategoryFilter").value;
  let query = sb.from("notes").select("*").order("created_at", { ascending: false }).limit(30);
  query = categoryId ? query.eq("category_id", categoryId) : query;
  const { data, error } = await query;

  if (error) {
    el.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(error.message)}</div>`;
    return;
  }

  notesCache = data;

  if (!data.length) {
    el.innerHTML = `<div class="empty">目前沒有筆記</div>`;
    return;
  }

  el.innerHTML = data.map((n) => {
    const category = categoriesCache.find((c) => c.id === n.category_id);
    return `
    <div class="card" data-id="${n.id}">
      <div class="content note-title-click">
        <div class="title">${escapeHtml(n.title || "(無標題)")}</div>
        <div class="meta">${fmtTime(n.created_at)}${category ? "　·　" + escapeHtml(category.name) : ""}</div>
      </div>
      <button class="del-btn">刪除</button>
    </div>
  `;
  }).join("");

  el.querySelectorAll(".note-title-click").forEach((div) => {
    div.addEventListener("click", () => {
      const id = div.closest(".card").dataset.id;
      const note = notesCache.find((n) => n.id === id);
      if (note) showNoteDetail(note);
    });
  });

  el.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      if (!confirm("確定要刪除嗎？")) return;
      const id = e.target.closest(".card").dataset.id;
      btn.disabled = true;
      await sb.from("notes").delete().eq("id", id);
      loadNotes();
    });
  });
}

function showNoteDetail(note) {
  document.getElementById("noteEditForm").dataset.id = note.id;
  document.getElementById("noteDetailMeta").textContent = fmtTime(note.created_at);
  document.getElementById("noteEditTitle").value = note.title || "";
  document.getElementById("noteEditContent").value = note.content || "";
  document.getElementById("noteEditCategorySelect").value = note.category_id || "";
  document.getElementById("notesListView").classList.add("hidden");
  document.getElementById("noteDetailView").classList.remove("hidden");
}

function showNotesList() {
  document.getElementById("noteDetailView").classList.add("hidden");
  document.getElementById("notesListView").classList.remove("hidden");
}

document.getElementById("noteBackBtn").addEventListener("click", showNotesList);

document.getElementById("noteEditForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = e.target.dataset.id;
  const title = document.getElementById("noteEditTitle").value.trim();
  const content = document.getElementById("noteEditContent").value.trim();
  const category_id = document.getElementById("noteEditCategorySelect").value || null;
  if (!title && !content) return;
  await sb.from("notes").update({ title, content, category_id }).eq("id", id);
  showNotesList();
  loadNotes();
});

document.getElementById("noteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const titleInput = document.getElementById("noteTitleInput");
  const contentInput = document.getElementById("noteContentInput");
  const categorySelect = document.getElementById("noteCategorySelect");
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  const category_id = categorySelect.value || null;
  if (!title && !content) return;
  titleInput.value = "";
  contentInput.value = "";
  categorySelect.value = "";
  await sb.from("notes").insert({ title, content, category_id, source: "mobile" });
  loadNotes();
});

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
  await sb.from("summary_requests").update({
    content: null,
    result: null,
    status: "idle",
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  btn.textContent = "已新增";
  setTimeout(() => { btn.textContent = "新增到筆記"; }, 2000);
});

document.getElementById("summaryClearBtn").addEventListener("click", async () => {
  if (!confirm("確定要刪除嗎？")) return;
  document.getElementById("summaryInput").value = "";
  document.getElementById("summaryResult").textContent = "";
  document.getElementById("summaryNoteTitle").value = "";
  document.getElementById("summaryToNoteRow").classList.add("hidden");
  await sb.from("summary_requests").update({
    content: null,
    result: null,
    status: "idle",
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
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
      btn.textContent = "更新";
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
      btn.textContent = "立刻匯報";
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
  notes: () => { loadCategories().then(loadNotes); },
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

document.getElementById("refreshBtn").addEventListener("click", (e) => {
  e.currentTarget.classList.add("spinning");
  refreshAll();
});
document.getElementById("refreshBtn").addEventListener("animationend", (e) => {
  e.currentTarget.classList.remove("spinning");
});

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
