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

/* ponytail: 股票功能已整組移除（報價/自選股/大盤研判），要復原去 git 翻 2026-07-17 前的版本 */
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
    .order("created_at", { ascending: false });

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
      if (!confirm("確定要標記完成嗎？（之後可在已完成清單復原）")) {
        cb.checked = false;
        return;
      }
      const card = e.target.closest(".card");
      const id = card.dataset.id;
      cb.disabled = true;
      await sb.from("todos").update({ done: true, updated_at: new Date().toISOString() }).eq("id", id);
      loadTodos();
      loadDoneTodos();
    });
  });
}

// ── 已完成待辦清單（可復原/永久刪除） ─────────────────────
async function loadDoneTodos() {
  const el = document.getElementById("todoDoneList");
  if (el.classList.contains("hidden")) return;

  const { data, error } = await sb
    .from("todos")
    .select("*")
    .eq("done", true)
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) {
    el.innerHTML = `<div class="empty">讀取失敗：${escapeHtml(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    el.innerHTML = `<div class="empty">還沒有已完成的待辦</div>`;
    return;
  }

  el.innerHTML = data.map((t) => `
    <div class="card" data-id="${t.id}">
      <div class="content">
        <div class="title">${escapeHtml(t.title)}</div>
        <div class="meta">完成於 ${fmtTime(t.updated_at)}</div>
      </div>
      <button class="undo-btn">復原</button>
      <button class="del-btn">刪除</button>
    </div>
  `).join("");

  el.querySelectorAll(".undo-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest(".card").dataset.id;
      btn.disabled = true;
      await sb.from("todos").update({ done: false, updated_at: new Date().toISOString() }).eq("id", id);
      loadTodos();
      loadDoneTodos();
    });
  });

  el.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      if (!confirm("確定要永久刪除嗎？刪除後無法復原。")) return;
      const id = e.target.closest(".card").dataset.id;
      btn.disabled = true;
      await sb.from("todos").delete().eq("id", id);
      loadDoneTodos();
    });
  });
}

document.getElementById("todoHistoryToggle").addEventListener("click", (e) => {
  const list = document.getElementById("todoDoneList");
  const hidden = list.classList.toggle("hidden");
  e.target.textContent = hidden ? "已完成清單 ▾" : "已完成清單 ▴";
  if (!hidden) loadDoneTodos();
});

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
  filter.innerHTML = `<option value="">顯示全部分類</option>${options}`;
  filter.value = keepFilter;

  document.getElementById("noteCategorySelect").innerHTML = `<option value="">未分類</option>${options}`;
  document.getElementById("noteEditCategorySelect").innerHTML = `<option value="">未分類</option>${options}`;
  document.getElementById("summaryNoteCategorySelect").innerHTML = `<option value="">未分類</option>${options}`;

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

let noteSearchTimer;
document.getElementById("noteSearchInput").addEventListener("input", () => {
  clearTimeout(noteSearchTimer);
  noteSearchTimer = setTimeout(loadNotes, 300);
});

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
  // ponytail: 逗號/括號是 PostgREST or 語法保留字，直接換成空白，不做完整跳脫
  const keyword = document.getElementById("noteSearchInput").value.trim().replace(/[,()]/g, " ").trim();
  if (keyword) query = query.or(`title.ilike.%${keyword}%,content.ilike.%${keyword}%`);
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
let summaryProjectsCache = [];
let selectedSummaryProject = "";
let summaryEntriesCache = [];
let summaryResultText = "";
let summaryInputSavePromise = Promise.resolve();
let summaryRequestTimer = null;

function parseSummaryContent(content) {
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) return [];

  const headerPattern = /^@@ENTRY ([^\r\n]+)@@[ \t]*(?:\r?\n|$)/gm;
  const headers = [...text.matchAll(headerPattern)];
  if (!headers.length) {
    return [{ timestamp: "", question: "", answer: text, legacy: true }];
  }

  const entries = headers.map((header, index) => {
    const bodyStart = header.index + header[0].length;
    const bodyEnd = index + 1 < headers.length ? headers[index + 1].index : text.length;
    let body = text.slice(bodyStart, bodyEnd).replace(/(?:\r?\n)+$/, "");
    const questionMarker = /^@@Q@@[ \t]*(?:\r?\n|$)/m.exec(body);
    const answerMarker = /^@@A@@[ \t]*(?:\r?\n|$)/m.exec(body);
    let question = "";
    let answer = "";

    if (questionMarker) {
      const questionStart = questionMarker.index + questionMarker[0].length;
      const questionEnd = answerMarker && answerMarker.index > questionMarker.index
        ? answerMarker.index
        : body.length;
      question = body.slice(questionStart, questionEnd).replace(/(?:\r?\n)+$/, "");
    }
    if (answerMarker) {
      const answerStart = answerMarker.index + answerMarker[0].length;
      answer = body.slice(answerStart).replace(/(?:\r?\n)+$/, "");
    } else if (!questionMarker) {
      answer = body;
    }

    return { timestamp: header[1], question, answer };
  });
  const legacyPrefix = text.slice(0, headers[0].index).replace(/(?:\r?\n)+$/, "");
  return legacyPrefix.trim()
    ? [{ timestamp: "", question: "", answer: legacyPrefix, legacy: true }, ...entries]
    : entries;
}

function serializeSummaryEntry(entry) {
  if (entry.legacy || !entry.timestamp) return entry.answer || "";
  const lines = [`@@ENTRY ${entry.timestamp}@@`];
  if (entry.question) lines.push("@@Q@@", entry.question);
  if (entry.answer) lines.push("@@A@@", entry.answer);
  return lines.join("\n");
}

function serializeSummaryEntries(entries) {
  return entries.map(serializeSummaryEntry).filter(Boolean).join("\n\n");
}

function localIsoSeconds(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatSummaryTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function appendSummaryContent(oldContent, entry) {
  if (!oldContent) return entry;
  return oldContent.replace(/[\r\n]+$/, "") + "\n\n" + entry;
}

function formatSummaryRequestContent(entries) {
  return entries.map((entry) => {
    const lines = [];
    const time = formatSummaryTime(entry.timestamp);
    if (time) lines.push(`【${time}】`);
    if (entry.question) lines.push(`問：${entry.question}`);
    if (entry.answer) lines.push(`答：${entry.answer}`);
    return lines.join("\n");
  }).filter(Boolean).join("\n\n");
}

function renderSummaryCards(content) {
  const container = document.getElementById("summaryCards");
  summaryEntriesCache = parseSummaryContent(content);
  container.replaceChildren();

  [...summaryEntriesCache].map((entry, index) => ({ entry, index })).reverse().forEach(({ entry, index }) => {
    const card = document.createElement("article");
    card.className = "summary-entry-card";
    card.dataset.entryIndex = String(index);

    const header = document.createElement("div");
    header.className = "summary-entry-header";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "summary-check";
    checkbox.value = String(index);
    checkbox.setAttribute("aria-label", "選取這則紀錄");
    header.append(checkbox);
    const time = formatSummaryTime(entry.timestamp);
    if (time) {
      const timeElement = document.createElement("time");
      timeElement.className = "summary-entry-time";
      timeElement.textContent = time;
      header.append(timeElement);
    }
    card.append(header);

    if (entry.question.trim()) {
      const question = document.createElement("div");
      question.className = "summary-question";
      const label = document.createElement("span");
      label.className = "summary-entry-label";
      label.textContent = "問：";
      const text = document.createElement("span");
      text.className = "summary-entry-text";
      text.textContent = entry.question;
      question.append(label, text);
      card.append(question);
    }

    if (entry.answer) {
      const answer = document.createElement("div");
      answer.className = "summary-answer";
      const label = document.createElement("span");
      label.className = "summary-entry-label";
      label.textContent = "答：";
      const text = document.createElement("span");
      text.className = "summary-entry-text";
      text.textContent = entry.answer;
      answer.append(label, text);
      card.append(answer);
    }
    container.append(card);
  });

  if (!summaryEntriesCache.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "尚無紀錄";
    container.append(empty);
  }
}

function renderSummaryResult(result) {
  summaryResultText = String(result ?? "");
  const container = document.getElementById("summaryResult");
  container.replaceChildren();
  summaryResultText.split(/\r?\n/).filter((line) => line.trim()).forEach((line) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    container.append(paragraph);
  });
}

function getSummaryResultText() {
  return summaryResultText || [...document.querySelectorAll("#summaryResult p")]
    .map((paragraph) => paragraph.textContent)
    .join("\n");
}

window.__summarySelfTest = function __summarySelfTest() {
  const source = "@@ENTRY 2026-09-16T11:15:03@@\n@@Q@@\n問題\n第二行\n@@A@@\n回答\n第二行\n\n@@ENTRY 2026-09-16T11:20:41@@\n@@A@@\n手動內容";
  const entries = parseSummaryContent(source);
  if (serializeSummaryEntries(entries) !== source) throw new Error("summary round-trip failed");
  if (parseSummaryContent(serializeSummaryEntries(entries.slice(0, 1))).length !== 1) {
    throw new Error("summary single-entry parse failed");
  }
  const legacy = "舊資料\n第二行";
  if (parseSummaryContent(legacy).length !== 1 || parseSummaryContent(legacy)[0].answer !== legacy) {
    throw new Error("summary legacy parse failed");
  }
  const mixed = appendSummaryContent(legacy, serializeSummaryEntry(entries[1]));
  if (parseSummaryContent(mixed).length !== 2 || parseSummaryContent(mixed)[0].answer !== legacy) {
    throw new Error("summary mixed legacy parse failed");
  }
  return "summary self-test passed";
};

async function loadSettings() {
  try {
  const { data, error } = await sb
    .from("secretary_settings")
    .select("briefing_topics,briefing_time,todo_lead_minutes")
    .eq("id", 1)
    .single();

  if (!error && data) {
    document.getElementById("briefingTime").value = data.briefing_time || "08:00";
    document.getElementById("briefingTopics").value = data.briefing_topics || "";
    if (!todoLeadSaving && document.activeElement !== document.getElementById("todoLeadMinutes")) {
      document.getElementById("todoLeadMinutes").value = String(data.todo_lead_minutes || 10);
    }
  } else if (error) {
    // 舊資料庫尚未加提醒欄位時，晨報設定仍可獨立載入。
    const fallback = await sb.from("secretary_settings").select("briefing_topics,briefing_time").eq("id", 1).single();
    if (!fallback.error && fallback.data) {
      document.getElementById("briefingTime").value = fallback.data.briefing_time || "08:00";
      document.getElementById("briefingTopics").value = fallback.data.briefing_topics || "";
    }
    document.getElementById("todoLeadStatus").textContent = "待辦提醒設定讀取失敗";
  }
  } catch (error) {
    document.getElementById("todoLeadStatus").textContent = "設定讀取失敗，請稍後再試";
  }
}

let meetingsLoading = false;
let todoLeadSaving = false;
function meetingEditing() {
  const list = document.getElementById("meetingsList");
  return list.contains(document.activeElement) || !!list.querySelector('[data-dirty="true"]');
}

function addMeetingCard(meeting = null) {
  const list = document.getElementById("meetingsList");
  list.querySelectorAll(".empty").forEach((el) => el.remove());
  const card = document.createElement("div");
  card.className = "card meeting-card";
  card.dataset.dirty = meeting ? "false" : "true";
  card.innerHTML = `<div class="content">
    <label>名稱<input class="meeting-title" type="text" autocomplete="off"></label>
    <label>頻率<select class="meeting-frequency"><option value="weekly">每週</option><option value="monthly">每月</option></select></label>
    <div class="meeting-month-weeks hidden"><span>第幾個</span>${[[1,"第1個"],[2,"第2個"],[3,"第3個"],[4,"第4個"],[-1,"最後一個"]].map(([value,label]) => `<label><input type="checkbox" class="meeting-week" value="${value}">${label}</label>`).join("")}</div>
    <div class="meeting-weekdays">${Array.from("一二三四五六日", (day, i) => `<label><input type="checkbox" class="meeting-day" value="${i + 1}">週${day}</label>`).join("")}</div>
    <label>時間</label><div class="time-select-row">
      <select class="meeting-ampm" aria-label="上午或下午"><option value="">--</option><option value="AM">上午</option><option value="PM">下午</option></select>
      <select class="meeting-hour" aria-label="時"></select><select class="meeting-minute" aria-label="分"></select>
    </div><label>提前分鐘 <select class="meeting-lead">${[5,10,15,30].map(n => `<option value="${n}">${n}</option>`).join("")}</select></label>
    <label><input class="meeting-enabled" type="checkbox">啟用</label>
    <div class="meeting-actions"><button type="button" class="meeting-save btn-blue">儲存</button><button type="button" class="meeting-delete del-btn">刪除</button></div>
    <div class="meta meeting-status" role="status"></div></div>`;
  const find = (selector) => card.querySelector(selector);
  fillTimeSelect(find(".meeting-hour"), Array.from({length:12}, (_,i) => i+1), "時");
  fillTimeSelect(find(".meeting-minute"), Array.from({length:60}, (_,i) => i), "分");
  find(".meeting-title").value = meeting?.title || "";
  find(".meeting-lead").value = String(meeting?.lead_minutes || 10);
  find(".meeting-enabled").checked = meeting?.enabled ?? true;
  const monthWeeks = meeting?.month_weeks || [];
  find(".meeting-frequency").value = monthWeeks.length ? "monthly" : "weekly";
  card.querySelectorAll(".meeting-week").forEach(el => { el.checked = monthWeeks.includes(Number(el.value)); });
  const updateFrequency = () => {
    find(".meeting-month-weeks").classList.toggle("hidden", find(".meeting-frequency").value !== "monthly");
  };
  find(".meeting-frequency").addEventListener("change", updateFrequency);
  updateFrequency();
  card.querySelectorAll(".meeting-day").forEach(el => { el.checked = (meeting?.weekdays || []).includes(Number(el.value)); });
  if (meeting?.meeting_time) {
    const [hour, minute] = meeting.meeting_time.split(":").map(Number);
    find(".meeting-ampm").value = hour >= 12 ? "PM" : "AM";
    find(".meeting-hour").value = String(hour % 12 || 12);
    find(".meeting-minute").value = String(minute);
  }
  let id = meeting?.id;
  card.addEventListener("input", () => { card.dataset.dirty = "true"; });
  card.addEventListener("change", () => { card.dataset.dirty = "true"; });
  find(".meeting-save").addEventListener("click", async () => {
    const title = find(".meeting-title").value.trim();
    const weekdays = [...card.querySelectorAll(".meeting-day:checked")].map(el => Number(el.value));
    const monthly = find(".meeting-frequency").value === "monthly";
    const month_weeks = monthly ? [...card.querySelectorAll(".meeting-week:checked")].map(el => Number(el.value)) : [];
    if (monthly && !month_weeks.length) {
      alert("請至少勾選第幾個");
      return;
    }
    const ampm = find(".meeting-ampm").value, hour = find(".meeting-hour").value, minute = find(".meeting-minute").value;
    if (!title || !weekdays.length || !ampm || !hour || minute === "") {
      alert(!title ? "請輸入會議名稱" : !weekdays.length ? "請至少勾選一天" : "請完整選擇時間");
      return;
    }
    const body = { title, weekdays, meeting_time: `${String(Number(hour)%12+(ampm==="PM"?12:0)).padStart(2,"0")}:${String(minute).padStart(2,"0")}`,
      month_weeks, lead_minutes: Number(find(".meeting-lead").value), enabled: find(".meeting-enabled").checked, updated_at: new Date().toISOString() };
    const buttons = [...card.querySelectorAll("button")];
    const fields = [...card.querySelectorAll("input,select")];
    [...buttons,...fields].forEach(el => { el.disabled = true; });
    try {
      const query = id ? sb.from("meeting_reminders").update(body).eq("id", id) : sb.from("meeting_reminders").insert(body);
      const {data,error} = await query.select("id").single();
      if (error) throw error;
      id = data.id;
      card.dataset.dirty = "false";
      find(".meeting-status").textContent = "已儲存";
    } catch (error) { find(".meeting-status").textContent = `儲存失敗：${error.message || "請稍後再試"}`; }
    finally { [...buttons,...fields].forEach(el => { el.disabled = false; }); }
  });
  find(".meeting-delete").addEventListener("click", async () => {
    if (!confirm("這會直接從資料庫刪除，電腦與手機兩邊都會消失，無法復原。")) return;
    const buttons = [...card.querySelectorAll("button")];
    buttons.forEach(el => { el.disabled = true; });
    try {
      if (id) { const {error} = await sb.from("meeting_reminders").delete().eq("id", id); if(error) throw error; }
      card.remove();
    } catch(error) { find(".meeting-status").textContent = `刪除失敗：${error.message || "請稍後再試"}`; }
    finally { buttons.forEach(el => { el.disabled = false; }); }
  });
  list.append(card);
  return card;
}

async function loadMeetings() {
  if (meetingsLoading || meetingEditing()) return;
  meetingsLoading = true;
  const list = document.getElementById("meetingsList");
  try {
    const {data,error} = await sb.from("meeting_reminders").select("*").order("created_at");
    if (error) throw error;
    if (meetingEditing()) return;
    list.replaceChildren();
    (data || []).forEach(addMeetingCard);
    if (!data?.length) list.innerHTML = '<div class="empty">尚無會議</div>';
  } catch(error) {
    if (!meetingEditing()) list.innerHTML = `<div class="empty">開會提醒讀取失敗：${escapeHtml(error.message || "請稍後再試")}</div>`;
  } finally { meetingsLoading = false; }
}
document.getElementById("addMeetingBtn").addEventListener("click", () => { addMeetingCard().querySelector("input").focus(); });
document.getElementById("todoLeadMinutes").addEventListener("change", async (e) => {
  const select = e.target;
  todoLeadSaving = true; select.disabled = true;
  try {
    const {error} = await sb.from("secretary_settings").update({todo_lead_minutes:Number(select.value),updated_at:new Date().toISOString()}).eq("id",1);
    if(error) throw error;
    document.getElementById("todoLeadStatus").textContent = "已儲存";
  } catch(error) { document.getElementById("todoLeadStatus").textContent = `儲存失敗：${error.message || "請稍後再試"}`; }
  finally { todoLeadSaving = false; select.disabled = false; }
});

function clearSummaryResult() {
  renderSummaryResult("");
  document.getElementById("summaryNoteTitle").value = "";
  document.getElementById("summaryNoteCategorySelect").value = "";
  document.getElementById("summaryToNoteBtn").disabled = true;
  document.getElementById("summaryToNoteRow").classList.add("hidden");
}

function setSummaryControlsDisabled(disabled) {
  document.getElementById("summaryProjectSelect").disabled = disabled;
  document.getElementById("summaryReceiveToggle").disabled = disabled;
  document.getElementById("summaryInput").disabled = disabled;
  document.getElementById("summaryRemoveBtn").disabled = disabled;
  document.getElementById("summaryClearBtn").disabled = disabled;
}

function renderSummaryProject(project, forceInput = false) {
  const input = document.getElementById("summaryInput");
  const hasProject = Boolean(project);
  setSummaryControlsDisabled(!hasProject);

  if (!hasProject) {
    input.value = "";
    document.getElementById("summaryReceiveToggle").checked = false;
    renderSummaryCards("");
    return;
  }

  if (forceInput || document.activeElement !== input) {
    input.value = "";
  }
  renderSummaryCards(project.content || "");
  document.getElementById("summaryReceiveToggle").checked = Boolean(project.receive);
}

async function loadSummaryRequest() {
  const { data: sumData } = await sb
    .from("summary_requests")
    .select("content,result,status")
    .eq("id", 1)
    .maybeSingle();

  if (sumData) {
    const done = sumData.status === "done";
    renderSummaryResult(done ? (sumData.result || "") : "");
    document.getElementById("summaryToNoteRow").classList.toggle("hidden", !done);
    document.getElementById("summaryToNoteBtn").disabled = !done || !document.getElementById("summaryNoteTitle").value.trim();
  } else {
    clearSummaryResult();
  }
}

async function loadSummary() {
  const { data, error } = await sb
    .from("summary_projects")
    .select("project,content,receive,updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    summaryProjectsCache = [];
    selectedSummaryProject = "";
    const select = document.getElementById("summaryProjectSelect");
    select.innerHTML = "<option value=\"\">（尚無專案）</option>";
    renderSummaryProject(null, true);
    return;
  }

  const previousProject = selectedSummaryProject || document.getElementById("summaryProjectSelect").value;
  summaryProjectsCache = data || [];
  const project = summaryProjectsCache.find((item) => item.project === previousProject) || summaryProjectsCache[0] || null;
  const selectionChanged = (project?.project || "") !== selectedSummaryProject;
  selectedSummaryProject = project?.project || "";

  const select = document.getElementById("summaryProjectSelect");
  select.innerHTML = summaryProjectsCache.length
    ? summaryProjectsCache.map((item) => `<option value="${escapeHtml(item.project)}">${escapeHtml(item.project)}</option>`).join("")
    : "<option value=\"\">（尚無專案）</option>";
  select.value = selectedSummaryProject;
  renderSummaryProject(project, selectionChanged);
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

document.getElementById("summaryProjectSelect").addEventListener("change", (e) => {
  selectedSummaryProject = e.target.value;
  const project = summaryProjectsCache.find((item) => item.project === selectedSummaryProject) || null;
  renderSummaryProject(project, true);
});

document.getElementById("summaryProjectAddBtn").addEventListener("click", async () => {
  const projectName = prompt("輸入專案資料夾名稱，要與電腦上的資料夾名完全一致：");
  if (projectName === null) return;
  const trimmedName = projectName.trim();
  if (!trimmedName) return;
  if (summaryProjectsCache.some((item) => item.project === trimmedName)) {
    alert("這個專案已經在清單裡了");
    return;
  }

  const { error } = await sb.from("summary_projects").insert({
    project: trimmedName,
    receive: false,
    content: null,
  });
  if (error) {
    alert(`新增專案失敗：${error.message}`);
    return;
  }

  selectedSummaryProject = trimmedName;
  await loadSummary();
  alert(`已新增專案「${trimmedName}」。

名字必須與電腦上的資料夾名完全一致，否則收不到對話也不會有錯誤訊息。`);
});

document.getElementById("summaryProjectDeleteBtn").addEventListener("click", async () => {
  if (!selectedSummaryProject) return;
  const projectName = selectedSummaryProject;
  if (!confirm(`確定要刪除專案「${projectName}」嗎？

這個專案底下的所有對話會一起從資料庫刪除，電腦與手機兩邊都會消失，無法復原。`)) return;

  const { error } = await sb.from("summary_projects").delete().eq("project", projectName);
  if (error) {
    alert(`刪除專案失敗：${error.message}`);
    return;
  }

  selectedSummaryProject = "";
  await loadSummary();
});

document.getElementById("summaryReceiveToggle").addEventListener("change", async (e) => {
  if (!selectedSummaryProject) return;
  const updatedAt = new Date().toISOString();
  await sb.from("summary_projects").update({
    receive: e.target.checked,
    updated_at: updatedAt,
  }).eq("project", selectedSummaryProject);
  const project = summaryProjectsCache.find((item) => item.project === selectedSummaryProject);
  if (project) {
    project.receive = e.target.checked;
    project.updated_at = updatedAt;
  }
});

document.getElementById("summaryInput").addEventListener("change", async (e) => {
  if (!selectedSummaryProject) return;
  const input = e.target;
  const entryContent = input.value.trim();
  if (!entryContent) return;
  input.value = "";
  const projectName = selectedSummaryProject;
  summaryInputSavePromise = summaryInputSavePromise.then(async () => {
    const { data } = await sb
      .from("summary_projects")
      .select("content")
      .eq("project", projectName)
      .maybeSingle();
    const entry = serializeSummaryEntry({
      timestamp: localIsoSeconds(),
      question: "",
      answer: entryContent,
    });
    const content = appendSummaryContent(data?.content || "", entry);
    const updatedAt = new Date().toISOString();
    await sb.from("summary_projects").update({
      content,
      updated_at: updatedAt,
    }).eq("project", projectName);
    const project = summaryProjectsCache.find((item) => item.project === projectName);
    if (project) {
      project.content = content;
      project.updated_at = updatedAt;
    }
    if (selectedSummaryProject === projectName) renderSummaryCards(content);
  });
  await summaryInputSavePromise;
});

document.getElementById("summaryBtn").addEventListener("click", async (e) => {
  const btn = e.target;
  const input = document.getElementById("summaryRequestInput");
  const content = input.value.trim();
  if (!content) return;
  if (summaryRequestTimer) clearInterval(summaryRequestTimer);
  btn.disabled = true;
  btn.textContent = "整理中…";
  renderSummaryResult("");
  document.getElementById("summaryToNoteRow").classList.add("hidden");

  await sb.from("summary_requests").update({
    content,
    result: null,
    status: "pending",
    updated_at: new Date().toISOString(),
  }).eq("id", 1);

  const requestedAt = Date.now();
  summaryRequestTimer = setInterval(async () => {
    const { data } = await sb
      .from("summary_requests")
      .select("status,result")
      .eq("id", 1)
      .maybeSingle();

    if (data && data.status === "done") {
      clearInterval(summaryRequestTimer);
      summaryRequestTimer = null;
      btn.disabled = false;
      btn.textContent = "整理重點";
      renderSummaryResult(data.result || "");
      document.getElementById("summaryNoteTitle").value = "";
      document.getElementById("summaryToNoteBtn").disabled = true;
      document.getElementById("summaryToNoteRow").classList.remove("hidden");
    } else if (data && data.status === "error") {
      clearInterval(summaryRequestTimer);
      summaryRequestTimer = null;
      btn.disabled = false;
      btn.textContent = "整理重點";
      renderSummaryResult("整理失敗，請稍後再試");
    } else if (Date.now() - requestedAt > 60000) {
      clearInterval(summaryRequestTimer);
      summaryRequestTimer = null;
      btn.disabled = false;
      btn.textContent = "整理重點";
      renderSummaryResult("整理逾時，請確認秘書工具是否在執行");
    }
  }, 3000);
});

document.getElementById("summaryNoteTitle").addEventListener("input", (e) => {
  document.getElementById("summaryToNoteBtn").disabled = !e.target.value.trim();
});

document.getElementById("summaryToNoteBtn").addEventListener("click", async (e) => {
  const btn = e.target;
  const title = document.getElementById("summaryNoteTitle").value.trim();
  const content = getSummaryResultText().trim();
  const category_id = document.getElementById("summaryNoteCategorySelect").value || null;
  if (!title || !content) return;
  btn.disabled = true;
  await sb.from("notes").insert({ title, content, category_id, source: "mobile" });
  document.getElementById("summaryRequestInput").value = "";
  renderSummaryResult("");
  document.getElementById("summaryNoteTitle").value = "";
  document.getElementById("summaryNoteCategorySelect").value = "";
  document.getElementById("summaryToNoteBtn").disabled = true;
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

document.getElementById("summaryPageClearBtn").addEventListener("click", async () => {
  if (summaryRequestTimer) {
    clearInterval(summaryRequestTimer);
    summaryRequestTimer = null;
  }
  document.getElementById("summaryRequestInput").value = "";
  clearSummaryResult();
  await sb.from("summary_requests").update({
    content: null,
    result: null,
    status: "idle",
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
});

document.getElementById("summaryRemoveBtn").addEventListener("click", async () => {
  if (!selectedSummaryProject) return;
  const selected = [...document.querySelectorAll("#summaryCards .summary-check:checked")]
    .map((checkbox) => Number(checkbox.value));
  if (!selected.length) return;
  if (!confirm(`確定要移除勾選的 ${selected.length} 則嗎？

這會直接從資料庫刪除，電腦與手機兩邊都會消失，無法復原。`)) return;

  const selectedSet = new Set(selected);
  const remaining = summaryEntriesCache.filter((_, index) => !selectedSet.has(index));
  const content = serializeSummaryEntries(remaining);
  await sb.from("summary_projects").update({
    content: content || null,
    updated_at: new Date().toISOString(),
  }).eq("project", selectedSummaryProject);
  const project = summaryProjectsCache.find((item) => item.project === selectedSummaryProject);
  if (project) project.content = content || null;
  renderSummaryCards(content);
});

document.getElementById("summaryClearBtn").addEventListener("click", async () => {
  if (!selectedSummaryProject) return;
  if (!confirm(`確定要清空「${selectedSummaryProject}」的全部內容嗎？

這會直接從資料庫刪除，電腦與手機兩邊都會消失，無法復原。`)) return;
  await sb.from("summary_projects").update({
    content: null,
    updated_at: new Date().toISOString(),
  }).eq("project", selectedSummaryProject);
  const project = summaryProjectsCache.find((item) => item.project === selectedSummaryProject);
  if (project) project.content = null;
  document.getElementById("summaryInput").value = "";
  renderSummaryCards("");
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
  todos: loadTodos,
  notes: () => { loadCategories().then(loadNotes); },
  terminal: loadSummary,
  summary: () => { loadCategories(); loadSummaryRequest(); },
  settings: loadSettings,
};

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById(`tab-${name}`).classList.add("active");
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add("active");
  if (name !== "notes") showNotesList();
  loaders[name]();
  if (name === "settings") loadMeetings();
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
  Object.entries(loaders).forEach(([name, fn]) => {
    if (name === "terminal" && document.getElementById("tab-summary").classList.contains("active")) return;
    fn();
  });
}

// ── Init ────────────────────────────────────────────────────
switchTab("briefing");
loadMeetings();
refreshAll();
setInterval(refreshAll, REFRESH_INTERVAL_MS);

// 待辦即時同步：外部訊息（如異常監控軟件）一寫入就刷新，不用等 30 秒輪詢或手動更新
sb.channel("todos-live")
  .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, () => { loadTodos(); loadDoneTodos(); })
  .subscribe();

sb.channel("summary-live")
  .on("postgres_changes", { event: "*", schema: "public", table: "summary_projects" }, () => {
    if (document.getElementById("tab-terminal").classList.contains("active")) loadSummary();
  })
  .subscribe();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  });
}
