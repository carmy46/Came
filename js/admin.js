// js/admin.js

function formatDateIT(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return new Intl.DateTimeFormat("it-IT").format(d);
}

function fmtTime(t) {
  // accetta "HH:MM" o "HH:MM:SS" e restituisce sempre "HH:MM"
  const s = String(t || "").trim();
  if (!s) return "—";
  // formato tipico: 08:30:00
  if (s.length >= 5) return s.slice(0, 5);
  return s;
}

function fmtMonthYear(ym) {
  // "YYYY-MM" -> "MM/YYYY"
  const s = String(ym || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return s || "—";
  return `${m[2]}/${m[1]}`;
}

function fmtMonthYearFile(ym) {
  // per filename: niente "/"
  return fmtMonthYear(ym).replace("/", "-");
}

function timeToMinutes(t) {
  // "HH:MM" o "HH:MM:SS" -> minuti dal giorno (per ordinamenti)
  const s = String(t || "").trim();
  if (!s) return 0;
  const parts = s.split(":").map(Number);
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  return h * 60 + m;
}

function minutesBetween(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  // Gestione turni notturni a cavallo della mezzanotte
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function netMinutes(log) {
  let total = minutesBetween(log.start_time, log.end_time);
  if (log.break_start && log.break_end) total -= minutesBetween(log.break_start, log.break_end);
  return Math.max(0, total);
}

function formatHM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2,"0")}m`;
}

function getTodayISO() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCurrentMonthISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`;
}

let adminCurrentMonthRows = [];
let adminOpenEmployeeKeys = new Set(); // per ricordare quali dipendenti sono aperti (UI)
let adminOpenRequestEmployeeKeys = new Set();
let adminOpenProductEmployeeKeys = new Set();
let adminCurrentRequestRows = [];
let adminCurrentProductGroups = [];

// Dipendenti (barra + scheda dipendente)
let adminEmployees = []; // [{ id, full_name }]
let adminEmpSelected = null; // { id, full_name }
let empHoursRows = [];
let empReqRows = [];

const logoutBtn = document.getElementById("logoutBtn");

// --- Barra dipendenti (sempre visibile) ---
const adminEmployeesCountEl = document.getElementById("adminEmployeesCount");
const adminEmployeesSearchEl = document.getElementById("adminEmployeesSearch");
const adminEmployeesChipsEl = document.getElementById("adminEmployeesChips");

// --- Modale scheda dipendente ---
const adminEmployeeModalEl = document.getElementById("adminEmployeeModal");
const adminEmpModalNameEl = document.getElementById("adminEmpModalName");

const empHoursMonthEl = document.getElementById("empHoursMonth");
const empHoursMonthTotalEl = document.getElementById("empHoursMonthTotal");
const empHoursListEl = document.getElementById("empHoursList");
const empHoursExportXlsxBtn = document.getElementById("empHoursExportXlsxBtn");

const empReqStatusEl = document.getElementById("empReqStatus");
const empReqTypeEl = document.getElementById("empReqType");
const empReqMonthEl = document.getElementById("empReqMonth");
const empReqResetBtn = document.getElementById("empReqReset");
const empReqApplyBtn = document.getElementById("empReqApply");
const empReqExportXlsxBtn = document.getElementById("empReqExportXlsxBtn");
const empReqInfoEl = document.getElementById("empReqInfo");
const empRequestsListEl = document.getElementById("empRequestsList");

const openProductsBtn = document.getElementById("openProductsBtn");

logoutBtn?.addEventListener("click", async () => {
  try { await window.supabaseClient.auth.signOut(); } catch (_) {}
  try { sessionStorage.clear(); } catch (_) {}
  try { localStorage.clear(); } catch (_) {}
  window.location.replace("login.html");
});

function setEmpTab(tab) {
  const t = String(tab || "hours");
  document.querySelectorAll("[data-emp-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-emp-tab") === t);
  });
  document.querySelectorAll(".emp-tab").forEach((el) => el.classList.remove("active"));
  document.getElementById(`emp-tab-${t}`)?.classList.add("active");
}

function openEmployeeModal({ id, full_name }) {
  if (!id) return;
  adminEmpSelected = { id, full_name: (full_name || "").trim() || "Senza nome" };

  if (adminEmpModalNameEl) adminEmpModalNameEl.textContent = adminEmpSelected.full_name;

  // default mesi
  if (empHoursMonthEl && !empHoursMonthEl.value) empHoursMonthEl.value = getCurrentMonthISO();
  if (empReqMonthEl && !empReqMonthEl.value) empReqMonthEl.value = "";

  // apri modale
  if (adminEmployeeModalEl) {
    adminEmployeeModalEl.classList.add("open");
    adminEmployeeModalEl.setAttribute("aria-hidden", "false");
  }

  // blocca scroll della pagina sotto (così non “si muove” mentre scorri la scheda)
  lockBodyScroll();

  setEmpTab("hours");
  loadEmpHours();
  loadEmpRequests();
}

function closeEmployeeModal() {
  if (!adminEmployeeModalEl) return;
  adminEmployeeModalEl.classList.remove("open");
  adminEmployeeModalEl.setAttribute("aria-hidden", "true");
  unlockBodyScroll();
}

// Scroll lock robusto (soprattutto su iPhone/Safari)
let _lockedScrollY = 0;
function lockBodyScroll() {
  if (document.body.classList.contains("modal-open")) return;
  _lockedScrollY = window.scrollY || 0;
  document.body.classList.add("modal-open");
  // evita “scroll bleed” su mobile
  document.body.style.position = "fixed";
  document.body.style.top = `-${_lockedScrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
}

function unlockBodyScroll() {
  if (!document.body.classList.contains("modal-open")) return;
  document.body.classList.remove("modal-open");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, _lockedScrollY || 0);
}

function bindOpenEmployeeButtons(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll("[data-open-emp]").forEach((btn) => {
    if (btn.dataset.boundOpenEmp) return;
    btn.dataset.boundOpenEmp = "1";
    btn.addEventListener("click", (e) => {
      // evita toggle del <summary>
      e.preventDefault();
      e.stopPropagation();

      const id = btn.getAttribute("data-emp-id");
      const name = btn.getAttribute("data-emp-name") || "Senza nome";
      if (!id) return;
      openEmployeeModal({ id, full_name: name });
    });
  });
}

// close modal: backdrop + buttons
document.querySelectorAll("[data-emp-modal-close]").forEach((el) => {
  el.addEventListener("click", () => closeEmployeeModal());
});

// tabs
document.querySelectorAll("[data-emp-tab]").forEach((btn) => {
  btn.addEventListener("click", () => setEmpTab(btn.getAttribute("data-emp-tab")));
});

// ESC chiude modale
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && adminEmployeeModalEl?.classList.contains("open")) closeEmployeeModal();
});

// --- NAV ---
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const view = btn.dataset.view;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${view}`).classList.add("active");

    updateSidebarForView(view);

    if (view === "hours") loadHours();
    if (view === "requests") loadRequests();
    if (view === "products") loadProducts();
    if (view === "catalog") loadCatalogAdmin();
  });
});

function updateSidebarForView(view) {
  const v = String(view || "");
  document.body.classList.toggle("products-mode", v === "products");

  const titleEl = document.querySelector(".sidebar .sidebar-title");
  if (titleEl) titleEl.textContent = (v === "products") ? "Menu" : "Dipendenti";
}

function goToPickView() {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-pick")?.classList.add("active");

  // stato sidebar: togli active da tutto, lascia solo Prodotti se era attivo? Meglio pulito.
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  updateSidebarForView("pick");
}

// Pulsanti "Torna indietro" nelle viste principali (Ore/Richieste/Prodotti)
document.querySelectorAll("[data-admin-back]").forEach((btn) => {
  btn.addEventListener("click", () => goToPickView());
});

const adminMonthPicker = document.getElementById("adminMonthPicker");
const adminMonthTotalEl = document.getElementById("adminMonthTotal");
const adminTodayTotalEl = document.getElementById("adminTodayTotal");
const adminHoursExpandAllBtn = document.getElementById("adminHoursExpandAllBtn");
const adminHoursCollapseAllBtn = document.getElementById("adminHoursCollapseAllBtn");
const adminReqExpandAllBtn = document.getElementById("adminReqExpandAllBtn");
const adminReqCollapseAllBtn = document.getElementById("adminReqCollapseAllBtn");
const adminProdExpandAllBtn = document.getElementById("adminProdExpandAllBtn");
const adminProdCollapseAllBtn = document.getElementById("adminProdCollapseAllBtn");
const adminReqExportXlsxBtn = document.getElementById("adminReqExportXlsxBtn");
const adminProdExportXlsxBtn = document.getElementById("adminProdExportXlsxBtn");

adminHoursExpandAllBtn?.addEventListener("click", () => {
  document.querySelectorAll('#hoursList details[data-emp-key]').forEach((d) => {
    d.open = true;
    const k = d.getAttribute("data-emp-key");
    if (k) adminOpenEmployeeKeys.add(k);
  });
});

adminHoursCollapseAllBtn?.addEventListener("click", () => {
  document.querySelectorAll('#hoursList details[data-emp-key]').forEach((d) => {
    d.open = false;
    const k = d.getAttribute("data-emp-key");
    if (k) adminOpenEmployeeKeys.delete(k);
  });
});

adminReqExpandAllBtn?.addEventListener("click", () => {
  document.querySelectorAll('#requestsList details[data-emp-key]').forEach((d) => {
    d.open = true;
    const k = d.getAttribute("data-emp-key");
    if (k) adminOpenRequestEmployeeKeys.add(k);
  });
});
adminReqCollapseAllBtn?.addEventListener("click", () => {
  document.querySelectorAll('#requestsList details[data-emp-key]').forEach((d) => {
    d.open = false;
    const k = d.getAttribute("data-emp-key");
    if (k) adminOpenRequestEmployeeKeys.delete(k);
  });
});

adminProdExpandAllBtn?.addEventListener("click", () => {
  document.querySelectorAll('#productsList details[data-emp-key]').forEach((d) => {
    d.open = true;
    const k = d.getAttribute("data-emp-key");
    if (k) adminOpenProductEmployeeKeys.add(k);
  });
});
adminProdCollapseAllBtn?.addEventListener("click", () => {
  document.querySelectorAll('#productsList details[data-emp-key]').forEach((d) => {
    d.open = false;
    const k = d.getAttribute("data-emp-key");
    if (k) adminOpenProductEmployeeKeys.delete(k);
  });
});

if (adminMonthPicker) adminMonthPicker.value = getCurrentMonthISO();
adminMonthPicker?.addEventListener("change", () => loadHours());

empHoursMonthEl?.addEventListener("change", () => loadEmpHours());
openProductsBtn?.addEventListener("click", () => {
  // Apri la sezione Prodotti della dashboard (fuori dalla scheda dipendente)
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-products")?.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector('.nav-btn[data-view="products"]')?.classList.add("active");

  updateSidebarForView("products");
  loadProducts();
});

empReqApplyBtn?.addEventListener("click", () => loadEmpRequests());
empReqStatusEl?.addEventListener("change", () => loadEmpRequests());
empReqTypeEl?.addEventListener("change", () => loadEmpRequests());
empReqMonthEl?.addEventListener("change", () => loadEmpRequests());
empReqResetBtn?.addEventListener("click", () => {
  if (empReqStatusEl) empReqStatusEl.value = "";
  if (empReqTypeEl) empReqTypeEl.value = "";
  if (empReqMonthEl) empReqMonthEl.value = "";
  loadEmpRequests();
});

// ============================
// EXPORT RICHIESTE (scheda dipendente)
// ============================
empReqExportXlsxBtn?.addEventListener("click", () => {
  if (!adminEmpSelected?.id || !empReqRows || empReqRows.length === 0) {
    alert("Nessun dato da esportare (Richieste).");
    return;
  }

  const status = (empReqStatusEl?.value || "").trim();
  const type = (empReqTypeEl?.value || "").trim();
  const month = (empReqMonthEl?.value || "").trim(); // YYYY-MM

  const suffix = month ? fmtMonthYear(month) : "tutte";
  const fileSuffix = month ? fmtMonthYearFile(month) : "tutte";

  const sorted = empReqRows.slice().sort((a, b) => {
    if (a.start_date !== b.start_date) return String(a.start_date).localeCompare(String(b.start_date));
    if (a.type !== b.type) return String(a.type).localeCompare(String(b.type));
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });

  const columns = ["Data", "Tipo", "Dettaglio", "Stato", "Nota"];
  const rows = sorted.map(r => {
    const dettaglio =
      r.type === "ferie"
        ? `Dal ${formatDateIT(r.start_date)} al ${formatDateIT(r.end_date)}`
        : (r.time ? `${formatDateIT(r.start_date)} • ${fmtTime(r.time)}` : `${formatDateIT(r.start_date)}`);

    return {
      "Data": r.start_date ? formatDateIT(r.start_date) : "",
      "Tipo": labelRequestType(r.type),
      "Dettaglio": dettaglio,
      "Stato": r.status || "",
      "Nota": (r.note || ""),
    };
  });

  const summaryRows = [
    { Voce: "Totale richieste", Valore: String(sorted.length) },
    { Voce: "Filtri", Valore: [month ? `Mese=${fmtMonthYear(month)}` : null, status ? `Stato=${status}` : null, type ? `Tipo=${type}` : null].filter(Boolean).join(" • ") || "—" },
  ];

  exportToExcelElegant({
    filename: `CAME_${adminEmpSelected.full_name}_Richieste_${fileSuffix}.xlsx`,
    sheetName: `Richieste ${suffix}`,
    title: `CAME – Richieste ${adminEmpSelected.full_name} (${suffix})`,
    columns,
    rows,
    summary: { title: `Riepilogo Richieste ${suffix}`, rows: summaryRows }
  });
});

async function loadEmployees() {
  if (!adminEmployeesChipsEl) return;
  adminEmployeesChipsEl.textContent = "Caricamento...";
  if (adminEmployeesCountEl) adminEmployeesCountEl.textContent = "—";

  try {
    // di default: role=employee (se nel DB è impostato così)
    let { data, error } = await supabaseClient
      .from("profiles")
      .select("id, full_name, role")
      .eq("role", "employee")
      .order("full_name", { ascending: true });

    // fallback: se non torna nulla, carica tutti e filtra client-side
    if (!error && (!data || data.length === 0)) {
      const res = await supabaseClient
        .from("profiles")
        .select("id, full_name, role")
        .order("full_name", { ascending: true });
      data = res.data;
      error = res.error;
    }

    if (error) throw error;

    adminEmployees = (data || [])
      .filter(p => p && p.id && String(p.role || "").toLowerCase() !== "admin")
      .map(p => ({ id: p.id, full_name: (p.full_name || "").trim() || "Senza nome" }));

    if (adminEmployeesCountEl) adminEmployeesCountEl.textContent = `${adminEmployees.length} account`;
    renderEmployeesChips();

  } catch (e) {
    console.error(e);
    adminEmployeesChipsEl.textContent = "Errore caricamento dipendenti.";
  }
}

function renderEmployeesChips() {
  if (!adminEmployeesChipsEl) return;
  const q = (adminEmployeesSearchEl?.value || "").trim().toLowerCase();
  const filtered = !q
    ? adminEmployees
    : adminEmployees.filter(p => String(p.full_name || "").toLowerCase().includes(q));

  if (!filtered.length) {
    adminEmployeesChipsEl.innerHTML = `<div class="muted">Nessun dipendente trovato.</div>`;
    return;
  }

  adminEmployeesChipsEl.innerHTML = filtered.map(p => `
    <button class="chip" type="button" data-open-emp data-emp-id="${escapeHtml(p.id)}" data-emp-name="${escapeHtml(p.full_name)}">
      ${escapeHtml(p.full_name)}
    </button>
  `).join("");

  bindOpenEmployeeButtons(adminEmployeesChipsEl);
}

let _empSearchTimer = null;
adminEmployeesSearchEl?.addEventListener("input", () => {
  clearTimeout(_empSearchTimer);
  _empSearchTimer = setTimeout(() => renderEmployeesChips(), 150);
});

async function loadHours() {
  const hoursList = document.getElementById("hoursList");
  if (!hoursList) return;

  try {
    hoursList.textContent = "Caricamento...";
    if (adminMonthTotalEl) adminMonthTotalEl.textContent = "—";
    if (adminTodayTotalEl) adminTodayTotalEl.textContent = "—";

    const ym = adminMonthPicker?.value || getCurrentMonthISO();
    const start = `${ym}-01`;
    const endDate = new Date(ym + "-01T00:00:00");
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0);
    const end = `${ym}-${String(endDate.getDate()).padStart(2, "0")}`;

    const { data, error } = await supabaseClient
      .from("work_logs")
      .select(`
        id,
        user_id,
        work_date,
        start_time,
        end_time,
        break_start,
        break_end,
        location,
        activity,
        created_at,
        profiles ( id, full_name )
      `)
      .gte("work_date", start)
      .lte("work_date", end)
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      hoursList.textContent = "Errore caricamento";
      adminCurrentMonthRows = [];
      return;
    }

    if (!data || data.length === 0) {
      hoursList.textContent = "Nessuna registrazione in questo mese.";
      adminCurrentMonthRows = [];
      return;
    }

    adminCurrentMonthRows = data || [];

    const todayISO = getTodayISO();

    let monthMin = 0;
    let todayMin = 0;

    const grouped = new Map(); // date -> { totalMin, rows[] }
    for (const r of data) {
      const nm = netMinutes(r);
      monthMin += nm;
      if (r.work_date === todayISO) todayMin += nm;

      const g = grouped.get(r.work_date) || { totalMin: 0, rows: [] };
      g.totalMin += nm;
      g.rows.push(r);
      grouped.set(r.work_date, g);
    }

    if (adminMonthTotalEl) adminMonthTotalEl.textContent = formatHM(monthMin);
    if (adminTodayTotalEl) adminTodayTotalEl.textContent = formatHM(todayMin);

  // ============================
  // Raggruppa per dipendente (tutte le ore insieme)
  // ============================
  const byEmployee = new Map(); // user_id -> { userId, full_name, totalMin, rows[] }
  for (const r of data) {
    const userId = r.user_id || r.profiles?.id || "unknown";
    const who = (r.profiles?.full_name || "").trim() || "Senza nome";
    const nm = netMinutes(r);
    const g = byEmployee.get(userId) || { userId, full_name: who, totalMin: 0, rows: [] };
    g.totalMin += nm;
    g.rows.push(r);
    byEmployee.set(userId, g);
  }

  // ordina dipendenti in ordine alfabetico (A->Z)
  const employees = Array.from(byEmployee.entries()).sort(([, aInfo], [, bInfo]) =>
    String(aInfo.full_name).localeCompare(String(bInfo.full_name), "it", { sensitivity: "base" })
  );

  hoursList.innerHTML = employees.map(([userId, info]) => {
    // righe ordinate per data desc, poi created_at desc (già in query, ma teniamolo esplicito)
    const rows = (info.rows || []).slice().sort((a, b) => {
      // ORDINE PER DATA (crescente), poi ora inizio, poi created_at
      if (a.work_date !== b.work_date) return String(a.work_date).localeCompare(String(b.work_date));
      const ta = timeToMinutes(a.start_time);
      const tb = timeToMinutes(b.start_time);
      if (ta !== tb) return ta - tb;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });

    // Raggruppa per giorno: data unica, ma righe separate (luoghi/registrazioni) sotto
    const byDay = new Map(); // work_date -> rows[]
    for (const r of rows) {
      const dayRows = byDay.get(r.work_date) || [];
      dayRows.push(r);
      byDay.set(r.work_date, dayRows);
    }

    const days = Array.from(byDay.entries()).sort(([a],[b]) => String(a).localeCompare(String(b)));

    const rowsHtml = days.map(([day, dayRows]) => {
      const dayTotalMin = (dayRows || []).reduce((acc, r) => acc + netMinutes(r), 0);
      const dayHeader = `
        <div class="rowItem rowGroup">
          <div><strong>${escapeHtml(formatDateIT(day))}</strong></div>
          <div class="muted">${escapeHtml(String(dayRows.length))} registrazione/i</div>
          <div>${escapeHtml(formatHM(dayTotalMin))}</div>
        </div>
      `;

      const dayLines = (dayRows || []).map(r => {
        const pausa = (r.break_start && r.break_end) ? ` • pausa ${fmtTime(r.break_start)}-${fmtTime(r.break_end)}` : "";
        const when = `${fmtTime(r.start_time)}-${fmtTime(r.end_time)}${pausa}`;
        return `
          <div class="rowItem">
            <div><strong>${escapeHtml(when)}</strong></div>
            <div>${escapeHtml(r.location)} • ${escapeHtml(r.activity)}</div>
            <div>${escapeHtml(formatHM(netMinutes(r)))}</div>
          </div>
        `;
      }).join("");

      return dayHeader + dayLines;
    }).join("");

    const empKey = encodeURIComponent(String(userId));
    const openAttr = adminOpenEmployeeKeys.has(empKey) ? "open" : "";

    return `
      <details class="dayCard empCard acc" data-emp-key="${escapeHtml(empKey)}" ${openAttr}>
        <summary class="dayHeader acc-head">
          <div>
            <strong>${escapeHtml(info.full_name)}</strong>
            <div class="muted">${rows.length} righe</div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button class="btn small" type="button" data-open-emp data-emp-id="${escapeHtml(String(userId))}" data-emp-name="${escapeHtml(info.full_name)}">Scheda</button>
          </div>
          <div class="dayTotal">Totale: ${escapeHtml(formatHM(info.totalMin))}</div>
        </summary>
        <div class="rows">${rowsHtml}</div>
      </details>
    `;
  }).join("");

  // Ricorda stato aperto/chiuso (UI)
  hoursList.querySelectorAll('details[data-emp-key]').forEach((d) => {
    d.addEventListener("toggle", () => {
      const k = d.getAttribute("data-emp-key");
      if (!k) return;
      if (d.open) adminOpenEmployeeKeys.add(k);
      else adminOpenEmployeeKeys.delete(k);
    });
  });

    bindOpenEmployeeButtons(hoursList);
  } catch (e) {
    console.error(e);
    hoursList.textContent = "Errore imprevisto (apri la console del browser per i dettagli).";
    adminCurrentMonthRows = [];
    if (adminMonthTotalEl) adminMonthTotalEl.textContent = "—";
    if (adminTodayTotalEl) adminTodayTotalEl.textContent = "—";
  }
}

// ============================
// EXPORT ORE – TUTTI I DIPENDENTI (da view-pick)
// ============================
const exportAllMonthPickerEl = document.getElementById("exportAllMonthPicker");
if (exportAllMonthPickerEl && !exportAllMonthPickerEl.value) {
  exportAllMonthPickerEl.value = getCurrentMonthISO();
}

document.getElementById("exportAllHoursBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("exportAllHoursBtn");
  const ym = (exportAllMonthPickerEl?.value || getCurrentMonthISO()).trim();

  if (btn) { btn.disabled = true; btn.textContent = "Caricamento..."; }

  try {
    const start = `${ym}-01`;
    const endDate = new Date(ym + "-01T00:00:00");
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0);
    const end = `${ym}-${String(endDate.getDate()).padStart(2, "0")}`;

    const { data, error } = await supabaseClient
      .from("work_logs")
      .select(`
        id,
        user_id,
        work_date,
        start_time,
        end_time,
        break_start,
        break_end,
        location,
        activity,
        created_at,
        profiles ( id, full_name )
      `)
      .gte("work_date", start)
      .lte("work_date", end)
      .order("work_date", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;

    const allRows = data || [];
    if (!allRows.length) {
      alert(`Nessuna registrazione trovata per ${fmtMonthYear(ym)}.`);
      return;
    }

    // Raggruppa per dipendente
    const byEmployee = new Map();
    for (const r of allRows) {
      const userId = r.user_id || "unknown";
      const name = (r.profiles?.full_name || "").trim() || "Senza nome";
      const g = byEmployee.get(userId) || { userId, full_name: name, totalMin: 0, rows: [] };
      g.totalMin += netMinutes(r);
      g.rows.push(r);
      byEmployee.set(userId, g);
    }

    // Ordina per nome
    const employees = Array.from(byEmployee.values()).sort((a, b) =>
      String(a.full_name).localeCompare(String(b.full_name), "it", { sensitivity: "base" })
    );

    const ymLabel = fmtMonthYear(ym);
    const ymFile = fmtMonthYearFile(ym);
    const columns = ["Data", "Ora inizio", "Ora fine", "Inizio pausa", "Fine pausa", "Luogo", "Attività", "Ore"];

    // Un foglio per ogni dipendente
    const empSheets = employees.map(emp => {
      const sorted = emp.rows.slice().sort((a, b) => {
        if (a.work_date !== b.work_date) return String(a.work_date).localeCompare(String(b.work_date));
        const ta = timeToMinutes(a.start_time);
        const tb = timeToMinutes(b.start_time);
        if (ta !== tb) return ta - tb;
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });

      const rows = sorted.map(r => ({
        "Data": formatDateIT(r.work_date),
        "Ora inizio": fmtTime(r.start_time),
        "Ora fine": fmtTime(r.end_time),
        "Inizio pausa": r.break_start ? fmtTime(r.break_start) : "",
        "Fine pausa": r.break_end ? fmtTime(r.break_end) : "",
        "Luogo": r.location || "",
        "Attività": r.activity || "",
        "Ore": formatHM(netMinutes(r)),
      }));

      return {
        sheetName: emp.full_name.slice(0, 31),
        title: `CAME – Ore ${emp.full_name} (${ymLabel})`,
        columns,
        rows,
      };
    });

    // Foglio riepilogo (primo)
    const summaryColumns = ["Dipendente", "Registrazioni", "Ore totali"];
    const summaryRows = employees.map(emp => ({
      "Dipendente": emp.full_name,
      "Registrazioni": String(emp.rows.length),
      "Ore totali": formatHM(emp.totalMin),
    }));
    const grandTotal = employees.reduce((acc, e) => acc + e.totalMin, 0);
    summaryRows.push(
      { "Dipendente": "", "Registrazioni": "", "Ore totali": "" },
      { "Dipendente": "TOTALE", "Registrazioni": String(allRows.length), "Ore totali": formatHM(grandTotal) }
    );

    exportToExcelMultiSheet({
      filename: `CAME_Admin_Ore_Tutti_${ymFile}.xlsx`,
      sheets: [
        {
          sheetName: "Riepilogo",
          title: `CAME – Riepilogo Ore Tutti (${ymLabel})`,
          columns: summaryColumns,
          rows: summaryRows,
        },
        ...empSheets,
      ],
    });

  } catch (err) {
    console.error(err);
    alert("Errore durante l'esportazione. Controlla la console.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Export Excel (tutti)"; }
  }
});

// Soluzione B: in Admin si parte scegliendo un dipendente (niente caricamento globale automatico)
loadEmployees();

// --- Filtri richieste (admin) ---
(function initRequestFilters() {
  const statusEl = document.getElementById("reqFilterStatus");
  const typeEl = document.getElementById("reqFilterType");
  const monthEl = document.getElementById("reqFilterMonth");
  const employeeEl = document.getElementById("reqFilterEmployee");
  const btnReset = document.getElementById("reqFiltersReset");
  const btnApply = document.getElementById("reqFiltersApply");

  if (!statusEl && !typeEl && !monthEl && !employeeEl && !btnReset && !btnApply) return;

  function apply() {
    // se la view non è attiva, non serve (evitiamo richieste inutili)
    const view = document.getElementById("view-requests");
    if (view && !view.classList.contains("active")) return;
    loadRequests();
  }

  // Applica quando cambia un filtro “semplice”
  statusEl?.addEventListener("change", apply);
  typeEl?.addEventListener("change", apply);
  monthEl?.addEventListener("change", apply);

  // Ricerca nome: debounce leggero
  let t = null;
  employeeEl?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(apply, 250);
  });

  btnApply?.addEventListener("click", apply);
  btnReset?.addEventListener("click", () => {
    if (statusEl) statusEl.value = "";
    if (typeEl) typeEl.value = "";
    if (monthEl) monthEl.value = "";
    if (employeeEl) employeeEl.value = "";
    apply();
  });
})();

function escapeHtml(str) {
  // Compatibilità: evita String.prototype.replaceAll (non supportato su alcuni browser)
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function labelRequestType(t) {
  switch (t) {
    case "ferie": return "Ferie";
    case "permesso_giornaliero": return "Permesso giornaliero";
    case "uscita_anticipata": return "Permesso uscita anticipata";
    case "entrata_posticipata": return "Permesso entrata posticipata";
    default: return t || "—";
  }
}

// ============================
// PRODOTTI (admin)
// ============================

(function initProductFilters() {
  const monthEl = document.getElementById("poFilterMonth");
  const employeeEl = document.getElementById("poFilterEmployee");
  const placeEl = document.getElementById("poFilterPlace");
  const productEl = document.getElementById("poFilterProduct");
  const btnReset = document.getElementById("poFiltersReset");
  const btnApply = document.getElementById("poFiltersApply");

  if (!monthEl && !employeeEl && !placeEl && !productEl && !btnReset && !btnApply) return;

  if (monthEl && !monthEl.value) monthEl.value = getCurrentMonthISO();

  function apply() {
    const view = document.getElementById("view-products");
    if (view && !view.classList.contains("active")) return;
    loadProducts();
  }

  monthEl?.addEventListener("change", apply);

  let t = null;
  function debouncedApply() {
    clearTimeout(t);
    t = setTimeout(apply, 250);
  }
  employeeEl?.addEventListener("input", debouncedApply);
  placeEl?.addEventListener("input", debouncedApply);
  productEl?.addEventListener("input", debouncedApply);

  btnApply?.addEventListener("click", apply);
  btnReset?.addEventListener("click", () => {
    if (monthEl) monthEl.value = getCurrentMonthISO();
    if (employeeEl) employeeEl.value = "";
    if (placeEl) placeEl.value = "";
    if (productEl) productEl.value = "";
    apply();
  });
})();

function setProductKpis({ orders = "—", pieces = "—", places = "—", topProduct = "—" } = {}) {
  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = String(val); };
  set("poKpiOrders", orders);
  set("poKpiPieces", pieces);
  set("poKpiPlaces", places);
  set("poKpiTopProduct", topProduct);
}

async function loadProducts() {
  const el = document.getElementById("productsList");
  if (!el) return;
  el.textContent = "Caricamento...";
  setProductKpis({ orders: "…", pieces: "…", places: "…", topProduct: "…" });

  const monthEl = document.getElementById("poFilterMonth");
  const employeeEl = document.getElementById("poFilterEmployee");
  const placeEl = document.getElementById("poFilterPlace");
  const productEl = document.getElementById("poFilterProduct");
  const infoEl = document.getElementById("poFiltersInfo");

  const month = (monthEl?.value || getCurrentMonthISO()).trim(); // YYYY-MM
  const employeeQuery = (employeeEl?.value || "").trim().toLowerCase();
  const placeQuery = (placeEl?.value || "").trim();
  const productQuery = (productEl?.value || "").trim();

  try {
    const start = `${month}-01`;
    const endDate = new Date(month + "-01T00:00:00");
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0);
    const end = `${month}-${String(endDate.getDate()).padStart(2, "0")}`;

    let q = supabaseClient
      .from("product_orders")
      .select(`
        id,
        user_id,
        order_date,
        delivery_date,
        place,
        product_name,
        quantity,
        created_at,
        profiles ( id, full_name )
      `)
      .gte("order_date", start)
      .lte("order_date", end)
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false });

    const { data, error } = await q;
    if (error) {
      console.error(error);
      el.textContent = "Errore caricamento prodotti.";
      setProductKpis({ orders: "—", pieces: "—", places: "—", topProduct: "—" });
      return;
    }

    const rawRows = (data || []);

    // Raggruppa in "ordine unico": (dipendente, data, luogo)
    const groupsMap = new Map(); // key -> group
    for (const r of rawRows) {
      const userId = r.user_id || "unknown";
      const date = r.order_date;
      const place = r.place || "";
      const key = `${userId}|${date}|${place}`;

      const g = groupsMap.get(key) || {
        key,
        userId,
        order_date: date,
        delivery_date: r.delivery_date || null,
        place,
        full_name: r.profiles?.full_name || "Senza nome",
        created_at: r.created_at,
        items: [],
      };

      // created_at più recente del gruppo (per ordinare)
      if (r.created_at && (!g.created_at || r.created_at > g.created_at)) g.created_at = r.created_at;
      // se una riga ha delivery_date, teniamo quella (dovrebbero essere uguali nel gruppo)
      if (r.delivery_date && !g.delivery_date) g.delivery_date = r.delivery_date;

      g.items.push({
        product_name: r.product_name,
        quantity: r.quantity,
      });

      groupsMap.set(key, g);
    }

    let groups = Array.from(groupsMap.values());

    // Filtri (client-side) così un "ordine" resta completo anche con filtri prodotto/luogo
    if (employeeQuery) {
      groups = groups.filter(g => String(g.full_name || "").toLowerCase().includes(employeeQuery));
    }
    if (placeQuery) {
      const pq = placeQuery.toLowerCase();
      groups = groups.filter(g => String(g.place || "").toLowerCase().includes(pq));
    }
    if (productQuery) {
      const prq = productQuery.toLowerCase();
      groups = groups.filter(g => g.items.some(it => String(it.product_name || "").toLowerCase().includes(prq)));
    }

    // Ordina per data desc, poi per created_at desc
    groups.sort((a, b) => {
      if (a.order_date !== b.order_date) return String(b.order_date).localeCompare(String(a.order_date));
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });

    const totalPieces = groups.reduce((acc, g) => acc + g.items.reduce((a2, it) => a2 + (Number(it.quantity) || 0), 0), 0);
    const totalLines = groups.reduce((acc, g) => acc + g.items.length, 0);

    if (infoEl) {
      const parts = [`Mese: ${fmtMonthYear(month)}`, `Ordini: ${groups.length}`, `Righe: ${totalLines}`, `Pezzi: ${totalPieces}`];
      if (employeeQuery) parts.push(`Nome: "${employeeQuery}"`);
      if (placeQuery) parts.push(`Luogo: "${placeQuery}"`);
      if (productQuery) parts.push(`Prodotto: "${productQuery}"`);
      infoEl.textContent = parts.join(" • ");
    }

    // KPI del mese (riflettono i dati filtrati mostrati sotto)
    const distinctPlaces = new Set(groups.map(g => String(g.place || "—"))).size;
    const productTotals = new Map();
    for (const g of groups) {
      for (const it of g.items) {
        const name = String(it.product_name || "").trim() || "—";
        productTotals.set(name, (productTotals.get(name) || 0) + (Number(it.quantity) || 0));
      }
    }
    let topProduct = "—", topQty = -1;
    for (const [name, qty] of productTotals.entries()) {
      if (qty > topQty) { topQty = qty; topProduct = name; }
    }
    setProductKpis({
      orders: groups.length,
      pieces: totalPieces,
      places: distinctPlaces,
      topProduct: groups.length ? `${topProduct} (${topQty})` : "—",
    });

    // Salva per export (dati già filtrati come in UI)
    adminCurrentProductGroups = groups.slice();

    if (!groups || groups.length === 0) {
      el.textContent = "Nessun ordine prodotti in questo mese.";
      setProductKpis({ orders: 0, pieces: 0, places: 0, topProduct: "—" });
      return;
    }

    // Niente "card per dipendente": tabella unica con nome dipendente dentro ogni riga
    const byDay = new Map(); // order_date -> groups[]
    for (const g of groups) {
      const arr = byDay.get(g.order_date) || [];
      arr.push(g);
      byDay.set(g.order_date, arr);
    }

    const days = Array.from(byDay.entries()).sort(([a],[b]) => String(b).localeCompare(String(a)));

    const allRowsHtml = days.map(([day, dayGroups]) => {
      const sorted = (dayGroups || []).slice().sort((a, b) => {
        const an = String(a.full_name || "").toLowerCase();
        const bn = String(b.full_name || "").toLowerCase();
        if (an !== bn) return an.localeCompare(bn, "it", { sensitivity: "base" });
        return String(a.place || "").localeCompare(String(b.place || ""), "it", { sensitivity: "base" });
      });

      const dayPieces = sorted.reduce((acc, gg) =>
        acc + gg.items.reduce((a2, it) => a2 + (Number(it.quantity) || 0), 0)
      , 0);

      const header = `
        <div class="rowItem rowGroup">
          <div><strong>${escapeHtml(formatDateIT(day))}</strong></div>
          <div class="muted">${escapeHtml(String(sorted.length))} ordine/i</div>
          <div style="text-align:right;">${escapeHtml(String(dayPieces))} pz</div>
        </div>
      `;

      const lines = sorted.map(g => {
        const pieces = g.items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
        const itemsShort = g.items.map(it => `${it.product_name} (${it.quantity})`).join(", ");

        const placeEnc = encodeURIComponent(g.place || "");
        const deliveryVal = g.delivery_date ? String(g.delivery_date).slice(0, 10) : "";

        return `
          <div class="rowItem">
            <div>
              <strong>${escapeHtml(g.full_name || "Senza nome")}</strong>
              <div class="muted">${escapeHtml(g.place || "—")} • ${escapeHtml(String(pieces))} pz</div>
            </div>
            <div class="muted">${escapeHtml(itemsShort)}</div>
            <div>
              <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px;">
                <input
                  class="input"
                  type="date"
                  style="max-width: 160px;"
                  data-po-delivery-input
                  data-user-id="${escapeHtml(g.userId)}"
                  data-order-date="${escapeHtml(String(g.order_date))}"
                  data-place="${escapeHtml(placeEnc)}"
                  value="${escapeHtml(deliveryVal)}"
                />
              </div>
            </div>
          </div>
        `;
      }).join("");

      return header + lines;
    }).join("");

    el.innerHTML = `<div class="dayCard"><div class="rows">${allRowsHtml}</div></div>`;

    // Bind consegna: autosalvataggio quando cambi la data
    const saveTimers = new Map(); // key -> timer
    el.querySelectorAll("[data-po-delivery-input]").forEach((input) => {
      input.addEventListener("change", async () => {
        const userId = input.getAttribute("data-user-id");
        const orderDate = input.getAttribute("data-order-date");
        const placeEnc = input.getAttribute("data-place") || "";
        const place = decodeURIComponent(placeEnc);
        const deliveryDate = (input.value || "").trim() || null;

        const key = `${userId}|${orderDate}|${placeEnc}`;
        clearTimeout(saveTimers.get(key));

        // debounce leggero (evita update multipli)
        const t = setTimeout(async () => {
          const { error } = await supabaseClient
            .from("product_orders")
            .update({ delivery_date: deliveryDate })
            .eq("user_id", userId)
            .eq("order_date", orderDate)
            .eq("place", place);

          if (error) {
            console.error(error);
            alert("Errore salvataggio data consegna. Controlla console.");
            return;
          }

          await loadProducts();
        }, 250);

        saveTimers.set(key, t);
      });
    });

  } catch (err) {
    console.error(err);
    el.textContent = "Errore imprevisto.";
  }
}

async function loadRequests() {
  const el = document.getElementById("requestsList");
  if (!el) return;
  el.textContent = "Caricamento...";

  const statusEl = document.getElementById("reqFilterStatus");
  const typeEl = document.getElementById("reqFilterType");
  const monthEl = document.getElementById("reqFilterMonth");
  const employeeEl = document.getElementById("reqFilterEmployee");
  const infoEl = document.getElementById("reqFiltersInfo");

  const status = (statusEl?.value || "").trim();
  const type = (typeEl?.value || "").trim();
  const month = (monthEl?.value || "").trim(); // YYYY-MM
  const employeeQuery = (employeeEl?.value || "").trim().toLowerCase();

  try {
    let q = supabaseClient
      .from("requests")
      .select(`
        id,
        user_id,
        type,
        start_date,
        end_date,
        time,
        status,
        note,
        created_at,
        profiles ( id, full_name )
      `)
      .order("created_at", { ascending: false });

    if (status) q = q.eq("status", status);
    if (type) q = q.eq("type", type);

    // filtro mese sulla data richiesta (start_date)
    if (month) {
      const start = `${month}-01`;
      const endDate = new Date(month + "-01T00:00:00");
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0);
      const end = `${month}-${String(endDate.getDate()).padStart(2, "0")}`;
      q = q.gte("start_date", start).lte("start_date", end);
    }

    const { data, error } = await q;

    if (error) {
      console.error(error);
      el.textContent = "Errore caricamento richieste.";
      return;
    }

    let rows = (data || []);

    // filtro per nome dipendente (client-side, perché il join non è sempre filtrabile con semplicità)
    if (employeeQuery) {
      rows = rows.filter(r => String(r.profiles?.full_name || "").toLowerCase().includes(employeeQuery));
    }

    if (infoEl) {
      const parts = [];
      if (status) parts.push(`Stato: ${status}`);
      if (type) parts.push(`Tipo: ${type}`);
      if (month) parts.push(`Mese: ${fmtMonthYear(month)}`);
      if (employeeQuery) parts.push(`Nome: "${employeeQuery}"`);
      infoEl.textContent = `${rows.length} risultato/i` + (parts.length ? ` • ${parts.join(" • ")}` : "");
    }

    // Salva per export (dati già filtrati come in UI)
    adminCurrentRequestRows = rows.slice();

    if (!rows || rows.length === 0) {
      el.textContent = "Nessuna richiesta.";
      return;
    }

    // Raggruppa per dipendente, poi per giorno (start_date)
    const byEmployee = new Map(); // user_id -> rows[]
    for (const r of rows) {
      const userId = r.user_id || r.profiles?.id || "unknown";
      const arr = byEmployee.get(userId) || [];
      arr.push(r);
      byEmployee.set(userId, arr);
    }

    const employees = Array.from(byEmployee.entries()).sort(([, aArr], [, bArr]) => {
      const aName = (aArr?.[0]?.profiles?.full_name || "Senza nome");
      const bName = (bArr?.[0]?.profiles?.full_name || "Senza nome");
      return String(aName).localeCompare(String(bName), "it", { sensitivity: "base" });
    });

    el.innerHTML = employees.map(([userId, empRows]) => {
      const sorted = (empRows || []).slice().sort((a, b) => {
        // ORDINE PER DATA (crescente), poi tipo, poi created_at
        if (a.start_date !== b.start_date) return String(a.start_date).localeCompare(String(b.start_date));
        if (a.type !== b.type) return String(a.type).localeCompare(String(b.type));
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });

      const byDay = new Map(); // start_date -> rows[]
      for (const r of sorted) {
        const arr = byDay.get(r.start_date) || [];
        arr.push(r);
        byDay.set(r.start_date, arr);
      }

      const days = Array.from(byDay.entries()).sort(([a],[b]) => String(a).localeCompare(String(b)));

      const rowsHtml = days.map(([day, dayRows]) => {
        const header = `
          <div class="rowItem rowGroup">
            <div><strong>${escapeHtml(formatDateIT(day))}</strong></div>
            <div class="muted">${escapeHtml(String(dayRows.length))} richiesta/e</div>
            <div>—</div>
          </div>
        `;

        const lines = (dayRows || []).map(r => {
          const when =
            r.type === "ferie"
              ? `Dal ${formatDateIT(r.start_date)} al ${formatDateIT(r.end_date)}`
              : (r.time ? `${formatDateIT(r.start_date)} • ${fmtTime(r.time)}` : `${formatDateIT(r.start_date)}`);

          const statusPill =
            r.status === "approvata"
              ? `<span class="pill ok">Approvata</span>`
              : (r.status === "rifiutata"
                  ? `<span class="pill warn" style="border-color: rgba(255,107,107,.35); background: rgba(255,107,107,.12);">Rifiutata</span>`
                  : `<span class="pill">Inviata</span>`);

          const note = r.note ? String(r.note).trim() : "";
          const noteSmall = note ? ` • ${note}` : "";

          const actions =
            r.status === "inviata"
              ? `
                  <span class="req-actions">
                    <button class="btn small" data-req-action="approve" data-req-id="${r.id}">Approva</button>
                    <button class="btn small" data-req-action="reject" data-req-id="${r.id}" style="border-color: rgba(255,107,107,.35);">Rifiuta</button>
                  </span>
                `
              : "";

          return `
            <div class="rowItem">
              <div><strong>${escapeHtml(labelRequestType(r.type))}</strong></div>
              <div class="muted">${escapeHtml(when + noteSmall)}</div>
              <div>
                ${statusPill}
                ${actions}
              </div>
            </div>
          `;
        }).join("");

        return header + lines;
      }).join("");

      const who = (sorted?.[0]?.profiles?.full_name || "Senza nome");
      const empKey = encodeURIComponent(String(userId));
      const openAttr = adminOpenRequestEmployeeKeys.has(empKey) ? "open" : "";

      return `
        <details class="dayCard empCard acc" data-emp-key="${escapeHtml(empKey)}" ${openAttr}>
          <summary class="dayHeader acc-head">
            <div style="display:flex; align-items:center; gap:10px;">
              <strong>${escapeHtml(who)}</strong>
              <button class="btn small" type="button" data-open-emp data-emp-id="${escapeHtml(String(userId))}" data-emp-name="${escapeHtml(who)}">Scheda</button>
              <span class="muted">${escapeHtml(String(sorted.length))} righe</span>
            </div>
          </summary>
          <div class="rows">${rowsHtml}</div>
        </details>
      `;
    }).join("");

    el.querySelectorAll("[data-req-action]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-req-id");
        const action = btn.getAttribute("data-req-action");
        if (!id || !action) return;

        const nextStatus = action === "approve" ? "approvata" : "rifiutata";
        const { error } = await supabaseClient
          .from("requests")
          .update({ status: nextStatus })
          .eq("id", id);

        if (error) {
          console.error(error);
          alert("Errore aggiornamento stato. Controlla console.");
          return;
        }

        await loadRequests();
      });
    });

    // Ricorda stato aperto/chiuso (UI)
    el.querySelectorAll('details[data-emp-key]').forEach((d) => {
      d.addEventListener("toggle", () => {
        const k = d.getAttribute("data-emp-key");
        if (!k) return;
        if (d.open) adminOpenRequestEmployeeKeys.add(k);
        else adminOpenRequestEmployeeKeys.delete(k);
      });
    });

    bindOpenEmployeeButtons(el);

  } catch (err) {
    console.error(err);
    el.textContent = "Errore imprevisto.";
  }
}

// ============================
// SCHEDA DIPENDENTE (modale)
// ============================
async function loadEmpHours() {
  if (!adminEmpSelected?.id || !empHoursListEl) return;
  empHoursListEl.textContent = "Caricamento...";
  if (empHoursMonthTotalEl) empHoursMonthTotalEl.textContent = "—";

  const ym = (empHoursMonthEl?.value || getCurrentMonthISO()).trim();
  if (empHoursMonthEl && empHoursMonthEl.value !== ym) empHoursMonthEl.value = ym;

  const start = `${ym}-01`;
  const endDate = new Date(ym + "-01T00:00:00");
  endDate.setMonth(endDate.getMonth() + 1);
  endDate.setDate(0);
  const end = `${ym}-${String(endDate.getDate()).padStart(2, "0")}`;

  const { data, error } = await supabaseClient
    .from("work_logs")
    .select("id,user_id,work_date,start_time,end_time,break_start,break_end,location,activity,created_at")
    .eq("user_id", adminEmpSelected.id)
    .gte("work_date", start)
    .lte("work_date", end)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    empHoursListEl.textContent = "Errore caricamento ore.";
    empHoursRows = [];
    return;
  }

  empHoursRows = data || [];

  if (!empHoursRows.length) {
    empHoursListEl.textContent = "Nessuna registrazione in questo mese.";
    return;
  }

  // raggruppa per giorno
  const byDay = new Map(); // work_date -> rows[]
  let totalMin = 0;
  for (const r of empHoursRows) {
    totalMin += netMinutes(r);
    const arr = byDay.get(r.work_date) || [];
    arr.push(r);
    byDay.set(r.work_date, arr);
  }
  if (empHoursMonthTotalEl) empHoursMonthTotalEl.textContent = formatHM(totalMin);

  const days = Array.from(byDay.entries()).sort(([a],[b]) => String(b).localeCompare(String(a)));

  // Tabella unica "continua": un solo contenitore, righe attaccate (niente card distanziate)
  const allRowsHtml = days.map(([day, rows]) => {
    const sorted = (rows || []).slice().sort((a, b) => {
      const ta = timeToMinutes(a.start_time);
      const tb = timeToMinutes(b.start_time);
      if (ta !== tb) return ta - tb;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });

    const dayTotalMin = sorted.reduce((acc, r) => acc + netMinutes(r), 0);
    const groupRow = `
      <div class="rowItem rowGroup">
        <div><strong>${escapeHtml(formatDateIT(day))}</strong></div>
        <div class="muted">${escapeHtml(String(sorted.length))} registrazione/i</div>
        <div>${escapeHtml(formatHM(dayTotalMin))}</div>
      </div>
    `;

    const lines = sorted.map(r => {
      const pausa = (r.break_start && r.break_end) ? ` • pausa ${fmtTime(r.break_start)}-${fmtTime(r.break_end)}` : "";
      const when = `${fmtTime(r.start_time)}-${fmtTime(r.end_time)}${pausa}`;
      return `
        <div class="rowItem">
          <div><strong>${escapeHtml(when)}</strong></div>
          <div>${escapeHtml(r.location)} • ${escapeHtml(r.activity)}</div>
          <div>${escapeHtml(formatHM(netMinutes(r)))}</div>
        </div>
      `;
    }).join("");

    return groupRow + lines;
  }).join("");

  empHoursListEl.innerHTML = `<div class="emp-hours-table"><div class="rows">${allRowsHtml}</div></div>`;
}

empHoursExportXlsxBtn?.addEventListener("click", () => {
  if (!adminEmpSelected?.id || !empHoursRows || empHoursRows.length === 0) {
    alert("Nessun dato da esportare (Ore).");
    return;
  }
  const ym = (empHoursMonthEl?.value || "mese");
  const columns = ["Data", "Ora inizio", "Ora fine", "Inizio pausa", "Fine pausa", "Luogo", "Attività", "Ore"];

  const rows = empHoursRows.slice().sort((a, b) => {
    if (a.work_date !== b.work_date) return String(a.work_date).localeCompare(String(b.work_date));
    const ta = timeToMinutes(a.start_time);
    const tb = timeToMinutes(b.start_time);
    if (ta !== tb) return ta - tb;
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  }).map(r => ({
    "Data": formatDateIT(r.work_date),
    "Ora inizio": fmtTime(r.start_time),
    "Ora fine": fmtTime(r.end_time),
    "Inizio pausa": r.break_start ? fmtTime(r.break_start) : "",
    "Fine pausa": r.break_end ? fmtTime(r.break_end) : "",
    "Luogo": r.location || "",
    "Attività": r.activity || "",
    "Ore": formatHM(netMinutes(r)),
  }));

  exportToExcelElegant({
    filename: `CAME_${adminEmpSelected.full_name}_Ore_${fmtMonthYearFile(ym)}.xlsx`,
    sheetName: `Ore ${fmtMonthYear(ym)}`,
    title: `CAME – Ore ${adminEmpSelected.full_name} (${fmtMonthYear(ym)})`,
    columns,
    rows,
  });
});

async function loadEmpRequests() {
  if (!adminEmpSelected?.id || !empRequestsListEl) return;
  empRequestsListEl.textContent = "Caricamento...";
  if (empReqInfoEl) empReqInfoEl.textContent = "";

  const status = (empReqStatusEl?.value || "").trim();
  const type = (empReqTypeEl?.value || "").trim();
  const month = (empReqMonthEl?.value || "").trim(); // YYYY-MM

  try {
    let q = supabaseClient
      .from("requests")
      .select("id,user_id,type,start_date,end_date,time,status,note,created_at")
      .eq("user_id", adminEmpSelected.id)
      .order("created_at", { ascending: false });

    if (status) q = q.eq("status", status);
    if (type) q = q.eq("type", type);

    if (month) {
      const start = `${month}-01`;
      const endDate = new Date(month + "-01T00:00:00");
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0);
      const end = `${month}-${String(endDate.getDate()).padStart(2, "0")}`;
      q = q.gte("start_date", start).lte("start_date", end);
    }

    const { data, error } = await q;
    if (error) throw error;

    empReqRows = data || [];

    if (empReqInfoEl) {
      const parts = [];
      if (status) parts.push(`Stato: ${status}`);
      if (type) parts.push(`Tipo: ${type}`);
      if (month) parts.push(`Mese: ${fmtMonthYear(month)}`);
      empReqInfoEl.textContent = `${empReqRows.length} risultato/i` + (parts.length ? ` • ${parts.join(" • ")}` : "");
    }

    if (!empReqRows.length) {
      empRequestsListEl.textContent = "Nessuna richiesta.";
      return;
    }

    // raggruppa per giorno (start_date)
    const byDay = new Map();
    for (const r of empReqRows) {
      const k = r.start_date || "—";
      const arr = byDay.get(k) || [];
      arr.push(r);
      byDay.set(k, arr);
    }

    const days = Array.from(byDay.entries()).sort(([a],[b]) => String(b).localeCompare(String(a)));

    // Tabella unica "continua": righe attaccate (niente card distanziate)
    const allRowsHtml = days.map(([day, rows]) => {
      const sorted = (rows || []).slice().sort((a, b) => {
        if (a.start_date !== b.start_date) return String(a.start_date).localeCompare(String(b.start_date));
        if (a.type !== b.type) return String(a.type).localeCompare(String(b.type));
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });

      const groupRow = `
        <div class="rowItem rowGroup">
          <div><strong>${escapeHtml(day === "—" ? "—" : formatDateIT(day))}</strong></div>
          <div class="muted">${escapeHtml(String(sorted.length))} richiesta/e</div>
          <div style="text-align:right;">—</div>
        </div>
      `;

      const lines = sorted.map(r => {
        const when =
          r.type === "ferie"
            ? `Dal ${formatDateIT(r.start_date)} al ${formatDateIT(r.end_date)}`
            : (r.time ? `${formatDateIT(r.start_date)} • ${fmtTime(r.time)}` : `${formatDateIT(r.start_date)}`);

        const statusPill =
          r.status === "approvata"
            ? `<span class="pill ok">Approvata</span>`
            : (r.status === "rifiutata"
                ? `<span class="pill warn" style="border-color: rgba(255,107,107,.35); background: rgba(255,107,107,.12);">Rifiutata</span>`
                : `<span class="pill">Inviata</span>`);

        const note = r.note ? String(r.note).trim() : "";
        const noteSmall = note ? ` • ${note}` : "";

        const actions =
          r.status === "inviata"
            ? `
                <span class="req-actions">
                  <button class="btn small" data-emp-req-action="approve" data-req-id="${r.id}">Approva</button>
                  <button class="btn small" data-emp-req-action="reject" data-req-id="${r.id}" style="border-color: rgba(255,107,107,.35);">Rifiuta</button>
                </span>
              `
            : "";

        return `
          <div class="rowItem">
            <div><strong>${escapeHtml(labelRequestType(r.type))}</strong></div>
            <div class="muted">${escapeHtml(when + noteSmall)}</div>
            <div style="text-align:right;">
              ${statusPill}
              ${actions}
            </div>
          </div>
        `;
      }).join("");

      return groupRow + lines;
    }).join("");

    empRequestsListEl.innerHTML = `<div class="emp-req-table"><div class="rows">${allRowsHtml}</div></div>`;

    // azioni approva/rifiuta
    empRequestsListEl.querySelectorAll("[data-emp-req-action]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-req-id");
        const action = btn.getAttribute("data-emp-req-action");
        if (!id || !action) return;
        const nextStatus = action === "approve" ? "approvata" : "rifiutata";
        const { error } = await supabaseClient.from("requests").update({ status: nextStatus }).eq("id", id);
        if (error) {
          console.error(error);
          alert("Errore aggiornamento stato. Controlla console.");
          return;
        }
        await loadEmpRequests();
        const view = document.getElementById("view-requests");
        if (view?.classList.contains("active")) loadRequests();
      });
    });

  } catch (e) {
    console.error(e);
    empRequestsListEl.textContent = "Errore caricamento richieste.";
  }
}

const adminExportXlsxBtn = document.getElementById("adminExportXlsxBtn");

adminExportXlsxBtn?.addEventListener("click", () => {
  if (!adminCurrentMonthRows || adminCurrentMonthRows.length === 0) {
    alert("Nessun dato da esportare per il mese selezionato.");
    return;
  }

  const ym = (adminMonthPicker?.value || "mese");
  const todayISO = getTodayISO();
  const ymLabel = fmtMonthYear(ym);

  const columns = ["Dipendente", "Data", "Ora inizio", "Ora fine", "Inizio pausa", "Fine pausa", "Luogo", "Attività", "Ore"];

  const sortedForExport = adminCurrentMonthRows.slice().sort((a, b) => {
    // ORDINE PER DATA (crescente), poi dipendente, poi ora inizio
    if (a.work_date !== b.work_date) return String(a.work_date).localeCompare(String(b.work_date));
    const an = String(a.profiles?.full_name || "").toLowerCase();
    const bn = String(b.profiles?.full_name || "").toLowerCase();
    if (an !== bn) return an.localeCompare(bn, "it", { sensitivity: "base" });
    const ta = timeToMinutes(a.start_time);
    const tb = timeToMinutes(b.start_time);
    if (ta !== tb) return ta - tb;
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });

  const dataRows = sortedForExport.map(r => {
    const oreMin = netMinutes(r);
    return {
      "Dipendente": r.profiles?.full_name || "",
      "Data": formatDateIT(r.work_date),
      "Ora inizio": fmtTime(r.start_time),
      "Ora fine": fmtTime(r.end_time),
      "Inizio pausa": r.break_start ? fmtTime(r.break_start) : "",
      "Fine pausa": r.break_end ? fmtTime(r.break_end) : "",
      "Luogo": r.location,
      "Attività": r.activity,
      "Ore": formatHM(oreMin),
    };
  });

  // Riepilogo generale
  let monthMin = 0, todayMin = 0;
  const byDay = new Map();
  for (const r of adminCurrentMonthRows) {
    const m = netMinutes(r);
    monthMin += m;
    if (r.work_date === todayISO) todayMin += m;
    byDay.set(r.work_date, (byDay.get(r.work_date) || 0) + m);
  }

  const summaryRows = [
    { Voce: "Totale mese (tutti)", Ore: formatHM(monthMin) },
    { Voce: "Totale oggi (tutti)", Ore: formatHM(todayMin) },
    { Voce: "", Ore: "" },
    ...Array.from(byDay.entries())
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([day, min]) => ({ Voce: `Giorno ${formatDateIT(day)}`, Ore: formatHM(min) }))
  ];

  exportToExcelElegant({
    filename: `CAME_Admin_Ore_${fmtMonthYearFile(ym)}.xlsx`,
    sheetName: `Ore ${ymLabel}`,
    title: `CAME – Ore (Admin) ${ymLabel}`,
    columns,
    rows: dataRows,
    summary: { title: `Riepilogo ${ymLabel}`, rows: summaryRows }
  });
});

// ============================
// EXPORT RICHIESTE (admin)
// ============================
adminReqExportXlsxBtn?.addEventListener("click", () => {
  if (!adminCurrentRequestRows || adminCurrentRequestRows.length === 0) {
    alert("Nessun dato da esportare per i filtri attuali (Richieste).");
    return;
  }

  const statusEl = document.getElementById("reqFilterStatus");
  const typeEl = document.getElementById("reqFilterType");
  const monthEl = document.getElementById("reqFilterMonth");

  const status = (statusEl?.value || "").trim();
  const type = (typeEl?.value || "").trim();
  const month = (monthEl?.value || "").trim();
  const monthLabel = month ? fmtMonthYear(month) : "tutte";
  const monthFile = month ? fmtMonthYearFile(month) : "tutte";

  const sorted = adminCurrentRequestRows.slice().sort((a, b) => {
    if (a.start_date !== b.start_date) return String(a.start_date).localeCompare(String(b.start_date));
    const an = String(a.profiles?.full_name || "").toLowerCase();
    const bn = String(b.profiles?.full_name || "").toLowerCase();
    if (an !== bn) return an.localeCompare(bn, "it", { sensitivity: "base" });
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });

  const columns = ["Dipendente", "Data", "Tipo", "Dettaglio", "Stato", "Nota"];

  const rows = sorted.map(r => {
    const who = r.profiles?.full_name || "";
    const data = r.start_date ? formatDateIT(r.start_date) : "";

    const dettaglio =
      r.type === "ferie"
        ? `Dal ${formatDateIT(r.start_date)} al ${formatDateIT(r.end_date)}`
        : (r.time ? `${formatDateIT(r.start_date)} • ${fmtTime(r.time)}` : `${formatDateIT(r.start_date)}`);

    return {
      "Dipendente": who,
      "Data": data,
      "Tipo": labelRequestType(r.type),
      "Dettaglio": dettaglio,
      "Stato": r.status || "",
      "Nota": (r.note || ""),
    };
  });

  // Riepilogo: conteggi per stato/tipo
  const byStatus = new Map();
  const byType = new Map();
  for (const r of sorted) {
    const st = r.status || "—";
    byStatus.set(st, (byStatus.get(st) || 0) + 1);
    const tp = labelRequestType(r.type);
    byType.set(tp, (byType.get(tp) || 0) + 1);
  }

  const summaryRows = [
    { Voce: "Totale richieste", Valore: String(sorted.length) },
    { Voce: "Filtri", Valore: [month ? `Mese=${fmtMonthYear(month)}` : null, status ? `Stato=${status}` : null, type ? `Tipo=${type}` : null].filter(Boolean).join(" • ") || "—" },
    { Voce: "", Valore: "" },
    ...Array.from(byStatus.entries()).sort(([a],[b]) => String(a).localeCompare(String(b), "it", { sensitivity: "base" })).map(([k, v]) => ({ Voce: `Stato: ${k}`, Valore: String(v) })),
    { Voce: "", Valore: "" },
    ...Array.from(byType.entries()).sort(([a],[b]) => String(a).localeCompare(String(b), "it", { sensitivity: "base" })).map(([k, v]) => ({ Voce: `Tipo: ${k}`, Valore: String(v) })),
  ];

  const suffix = monthLabel;
  exportToExcelElegant({
    filename: `CAME_Admin_Richieste_${monthFile}.xlsx`,
    sheetName: `Richieste ${suffix}`,
    title: `CAME – Richieste (Admin) ${suffix}`,
    columns,
    rows,
    summary: { title: `Riepilogo Richieste ${suffix}`, rows: summaryRows }
  });
});

// ============================
// EXPORT PRODOTTI (admin)
// ============================
adminProdExportXlsxBtn?.addEventListener("click", () => {
  if (!adminCurrentProductGroups || adminCurrentProductGroups.length === 0) {
    alert("Nessun dato da esportare per i filtri attuali (Prodotti).");
    return;
  }

  const monthEl = document.getElementById("poFilterMonth");
  const month = (monthEl?.value || "").trim() || "mese";
  const monthLabel = fmtMonthYear(month);

  const sorted = adminCurrentProductGroups.slice().sort((a, b) => {
    if (a.order_date !== b.order_date) return String(a.order_date).localeCompare(String(b.order_date));
    const an = String(a.full_name || "").toLowerCase();
    const bn = String(b.full_name || "").toLowerCase();
    if (an !== bn) return an.localeCompare(bn, "it", { sensitivity: "base" });
    return String(a.place || "").localeCompare(String(b.place || ""), "it", { sensitivity: "base" });
  });

  const columns = ["Dipendente", "Data ordine", "Luogo", "Data consegna", "Prodotti", "Righe", "Pezzi"];

  const rows = sorted.map(g => {
    const items = (g.items || []).map(it => `${it.product_name} x${it.quantity}`).join(", ");
    const pieces = (g.items || []).reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
    return {
      "Dipendente": g.full_name || "",
      "Data ordine": g.order_date ? formatDateIT(g.order_date) : "",
      "Luogo": g.place || "",
      "Data consegna": g.delivery_date ? formatDateIT(String(g.delivery_date).slice(0, 10)) : "",
      "Prodotti": items,
      "Righe": String((g.items || []).length),
      "Pezzi": String(pieces),
    };
  });

  const totalPieces = sorted.reduce((acc, g) => acc + (g.items || []).reduce((a2, it) => a2 + (Number(it.quantity) || 0), 0), 0);
  const totalLines = sorted.reduce((acc, g) => acc + (g.items || []).length, 0);

  const summaryRows = [
    { Voce: "Mese", Valore: monthLabel },
    { Voce: "Ordini (gruppi)", Valore: String(sorted.length) },
    { Voce: "Righe (prodotti)", Valore: String(totalLines) },
    { Voce: "Pezzi (totale)", Valore: String(totalPieces) },
  ];

  exportToExcelElegant({
    filename: `CAME_Admin_Prodotti_${fmtMonthYearFile(month)}.xlsx`,
    sheetName: `Prodotti ${monthLabel}`,
    title: `CAME – Prodotti (Admin) ${monthLabel}`,
    columns,
    rows,
    summary: { title: `Riepilogo Prodotti ${monthLabel}`, rows: summaryRows }
  });
});

// ============================
// REPORT CONSUMI PRODOTTI (admin): un unico file Excel per l'ANNO scelto
// (l'anno viene dal campo "Mese" dei filtri). Foglio "Riepilogo" con la
// classifica dei luoghi per consumo + un foglio per luogo con i prodotti in
// riga e i 12 mesi in colonna. Conta TUTTE le richieste inviate (consegnate
// o no) e ignora gli altri filtri: sempre tutti i luoghi e tutti i dipendenti.
// ============================

const MONTH_LABELS_IT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

document.getElementById("adminProdConsumptionBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("adminProdConsumptionBtn");
  const origLabel = btn ? btn.innerHTML : "";
  const month = (document.getElementById("poFilterMonth")?.value || getCurrentMonthISO()).trim(); // YYYY-MM
  const year = month.slice(0, 4);
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  try {
    if (btn) { btn.disabled = true; btn.textContent = "Genero..."; }

    const { data, error } = await supabaseClient
      .from("product_orders")
      .select("place,product_name,quantity,order_date")
      .gte("order_date", start)
      .lte("order_date", end);

    if (error) { console.error(error); alert("Errore nel caricamento dei dati per il report."); return; }
    if (!data || data.length === 0) { alert(`Nessun ordine prodotti nel ${year}.`); return; }

    // luogo -> prodotto -> [12 quantità mensili]
    const byPlace = new Map();
    for (const r of data) {
      const place = String(r.place || "").trim() || "—";
      const product = String(r.product_name || "").trim() || "—";
      const qty = Number(r.quantity) || 0;
      const monthIdx = Number(String(r.order_date).slice(5, 7)) - 1;
      if (monthIdx < 0 || monthIdx > 11) continue;

      let products = byPlace.get(place);
      if (!products) { products = new Map(); byPlace.set(place, products); }
      let monthly = products.get(product);
      if (!monthly) { monthly = new Array(12).fill(0); products.set(product, monthly); }
      monthly[monthIdx] += qty;
    }

    // Statistiche per luogo (per il Riepilogo e per l'ordinamento dei fogli)
    const placeStats = Array.from(byPlace.entries()).map(([place, products]) => {
      let pieces = 0, topProduct = "—", topQty = -1;
      const monthlyTotals = new Array(12).fill(0);
      for (const [name, monthly] of products.entries()) {
        const t = monthly.reduce((a, b) => a + b, 0);
        pieces += t;
        monthly.forEach((q, i) => { monthlyTotals[i] += q; });
        if (t > topQty) { topQty = t; topProduct = name; }
      }
      return { place, products, pieces, distinct: products.size, topProduct, monthlyTotals };
    });

    // Luoghi ordinati per consumo decrescente: Riepilogo e fogli seguono quest'ordine
    placeStats.sort((a, b) => b.pieces - a.pieces || a.place.localeCompare(b.place, "it", { sensitivity: "base" }));

    const grandPieces = placeStats.reduce((a, p) => a + p.pieces, 0);

    // Foglio Riepilogo (classifica luoghi)
    const summaryHeader = ["Luogo", "Pezzi (anno)", "Prodotti diversi", "Prodotto più usato"];
    const summaryRows = placeStats.map(p => [p.place, p.pieces, p.distinct, p.topProduct]);
    const summaryTotalsRow = ["TOTALE", grandPieces, "", ""];

    // Un foglio per luogo: prodotti (righe) x 12 mesi + Totale
    const placeSheets = placeStats.map(p => {
      const productRows = Array.from(p.products.entries())
        .map(([name, monthly]) => {
          const total = monthly.reduce((a, b) => a + b, 0);
          return [name, ...monthly.map(q => q || ""), total];
        })
        .sort((a, b) => (b[b.length - 1] - a[a.length - 1]) || String(a[0]).localeCompare(String(b[0]), "it", { sensitivity: "base" }));

      const totalsRow = ["TOTALE MESE", ...p.monthlyTotals.map(q => q || ""), p.pieces];

      return {
        place: p.place,
        title: `Consumo ${year} — ${p.place}`,
        subtitle: `${p.pieces} pezzi nell'anno • ${p.distinct} prodotti diversi`,
        header: ["Prodotto", ...MONTH_LABELS_IT, "Totale"],
        productRows,
        totalsRow,
      };
    });

    const genStr = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date());

    exportConsumptionReport({
      filename: `CAME_Consumi_Prodotti_${year}.xlsx`,
      title: `CAME — Consumi prodotti ${year}`,
      subtitle: `Tutti i luoghi • ${placeStats.length} luoghi • ${grandPieces} pezzi totali • generato il ${genStr}`,
      summaryHeader,
      summaryRows,
      summaryTotalsRow,
      placeSheets,
    });
  } catch (e) {
    console.error(e);
    alert("Errore imprevisto nella generazione del report.");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
  }
});

// ============================
// CATALOGHI (admin): gestione prodotti / luoghi / attività
// Tabella catalog_items. Solo l'admin può modificare (regole RLS).
// ============================
const catalogListEl = document.getElementById("catalogList");
const catalogNewNameEl = document.getElementById("catalogNewName");
const catalogAddBtn = document.getElementById("catalogAddBtn");
const catalogMsgEl = document.getElementById("catalogMsg");

let catalogCurrentType = "product"; // product | place | activity
const CATALOG_LABEL = { product: "prodotto", place: "luogo", activity: "attività" };

function setCatalogMsg(text, type = "info") {
  if (!catalogMsgEl) return;
  catalogMsgEl.textContent = text || "";
  catalogMsgEl.className = `msg ${type}`;
}

// Carica e mostra le voci del tipo selezionato (incluse quelle nascoste)
async function loadCatalogAdmin() {
  if (!catalogListEl) return;
  catalogListEl.textContent = "Caricamento...";
  try {
    const { data, error } = await supabaseClient
      .from("catalog_items")
      .select("id,name,active,sort_order,category")
      .eq("type", catalogCurrentType)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
      catalogListEl.textContent = "Errore nel caricamento del catalogo.";
      return;
    }
    renderCatalogList(data || []);
  } catch (e) {
    console.error(e);
    catalogListEl.textContent = "Errore imprevisto.";
  }
}

function renderCatalogList(items) {
  if (!items.length) {
    catalogListEl.innerHTML = `<p class="muted">Nessuna voce. Aggiungine una qui sopra.</p>`;
    return;
  }

  const isProduct = catalogCurrentType === "product";

  // Datalist con le categorie già usate, per suggerirle mentre si scrive
  // (restano comunque testo libero: si può scrivere una categoria nuova).
  const categoryOptionsHtml = isProduct
    ? Array.from(new Set(items.map(it => (it.category || "").trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }))
        .map(c => `<option value="${escapeHtml(c)}"></option>`)
        .join("")
    : "";

  const listHtml = items.map((it, idx) => `
    <div class="catalog-item">
      <div class="catalog-item-main">
        <input class="input catalog-name" data-id="${it.id}" value="${escapeHtml(it.name)}" />
        ${isProduct ? `<input class="input" list="catalogCategoryList" data-cat-category="${it.id}" style="max-width:170px; margin-left:8px;" placeholder="Categoria..." value="${escapeHtml(it.category || "")}" />` : ""}
        ${it.active ? "" : `<span class="pill" style="margin-left:8px;">nascosto</span>`}
      </div>
      <div class="catalog-item-actions">
        <button class="btn small" data-cat-move="up" data-id="${it.id}" ${idx === 0 ? "disabled" : ""} title="Sposta su">↑</button>
        <button class="btn small" data-cat-move="down" data-id="${it.id}" ${idx === items.length - 1 ? "disabled" : ""} title="Sposta giù">↓</button>
        <button class="btn small" data-cat-rename="${it.id}">Salva nome</button>
        <button class="btn small" data-cat-toggle="${it.id}" data-active="${it.active}">${it.active ? "Nascondi" : "Mostra"}</button>
        <button class="btn small danger" data-cat-delete="${it.id}">Elimina</button>
      </div>
    </div>
  `).join("");

  catalogListEl.innerHTML = (isProduct ? `<datalist id="catalogCategoryList">${categoryOptionsHtml}</datalist>` : "") + listHtml;
  bindCatalogActions(items);
}

function bindCatalogActions(items) {
  // Salva nome (rinomina)
  catalogListEl.querySelectorAll("[data-cat-rename]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-cat-rename");
      const input = catalogListEl.querySelector(`.catalog-name[data-id="${id}"]`);
      const name = (input?.value || "").trim();
      if (!name) { setCatalogMsg("Il nome non può essere vuoto.", "error"); return; }
      const { error } = await supabaseClient.from("catalog_items").update({ name }).eq("id", id);
      if (error) {
        if (error.code === "23505") setCatalogMsg("Esiste già una voce con questo nome.", "error");
        else { console.error(error); setCatalogMsg("Errore nel salvataggio.", "error"); }
        return;
      }
      setCatalogMsg("Nome salvato ✅", "ok");
      await loadCatalogAdmin();
    });
  });

  // Categoria (solo prodotti): autosalvataggio al cambio, come la data di consegna in Prodotti
  catalogListEl.querySelectorAll("[data-cat-category]").forEach((input) => {
    input.addEventListener("change", async () => {
      const id = input.getAttribute("data-cat-category");
      const category = (input.value || "").trim() || null;
      const { error } = await supabaseClient.from("catalog_items").update({ category }).eq("id", id);
      if (error) {
        console.error(error);
        setCatalogMsg("Errore nel salvataggio della categoria.", "error");
        return;
      }
      setCatalogMsg("Categoria salvata ✅", "ok");
    });
  });

  // Mostra / Nascondi
  catalogListEl.querySelectorAll("[data-cat-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-cat-toggle");
      const active = btn.getAttribute("data-active") === "true";
      const { error } = await supabaseClient.from("catalog_items").update({ active: !active }).eq("id", id);
      if (error) { console.error(error); setCatalogMsg("Errore.", "error"); return; }
      await loadCatalogAdmin();
    });
  });

  // Elimina
  catalogListEl.querySelectorAll("[data-cat-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-cat-delete");
      if (!confirm("Eliminare questa voce dal catalogo?\nGli ordini e le ore già registrati NON vengono toccati.")) return;
      const { error } = await supabaseClient.from("catalog_items").delete().eq("id", id);
      if (error) { console.error(error); setCatalogMsg("Errore nell'eliminazione.", "error"); return; }
      setCatalogMsg("Voce eliminata ✅", "ok");
      await loadCatalogAdmin();
    });
  });

  // Sposta su / giù (scambia l'ordine con la voce vicina)
  catalogListEl.querySelectorAll("[data-cat-move]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const dir = btn.getAttribute("data-cat-move");
      const idx = items.findIndex((x) => String(x.id) === String(id));
      if (idx < 0) return;
      const swapIdx = dir === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= items.length) return;

      const a = items[idx];
      const b = items[swapIdx];
      const { error: e1 } = await supabaseClient.from("catalog_items").update({ sort_order: b.sort_order }).eq("id", a.id);
      const { error: e2 } = await supabaseClient.from("catalog_items").update({ sort_order: a.sort_order }).eq("id", b.id);
      if (e1 || e2) { console.error(e1 || e2); setCatalogMsg("Errore nel riordino.", "error"); return; }
      await loadCatalogAdmin();
    });
  });
}

// Cambia scheda (Prodotti / Luoghi / Attività)
document.querySelectorAll("[data-catalog-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    catalogCurrentType = btn.getAttribute("data-catalog-tab") || "product";
    document.querySelectorAll("[data-catalog-tab]").forEach((b) => b.classList.toggle("active", b === btn));
    setCatalogMsg("");
    loadCatalogAdmin();
  });
});

// Aggiungi nuova voce
catalogAddBtn?.addEventListener("click", async () => {
  const name = (catalogNewNameEl?.value || "").trim();
  if (!name) { setCatalogMsg(`Scrivi il nome del ${CATALOG_LABEL[catalogCurrentType]}.`, "error"); return; }
  try {
    // metti la nuova voce in fondo: sort_order = (massimo attuale) + 10
    const { data: maxRow } = await supabaseClient
      .from("catalog_items")
      .select("sort_order")
      .eq("type", catalogCurrentType)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = ((maxRow?.sort_order) || 0) + 10;

    const { error } = await supabaseClient
      .from("catalog_items")
      .insert({ type: catalogCurrentType, name, sort_order: nextOrder });

    if (error) {
      if (error.code === "23505") setCatalogMsg("Esiste già una voce con questo nome.", "error");
      else { console.error(error); setCatalogMsg("Errore nell'aggiunta.", "error"); }
      return;
    }
    if (catalogNewNameEl) catalogNewNameEl.value = "";
    setCatalogMsg("Voce aggiunta ✅", "ok");
    await loadCatalogAdmin();
  } catch (e) {
    console.error(e);
    setCatalogMsg("Errore imprevisto.", "error");
  }
});


