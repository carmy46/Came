// js/employee.js

// --- UI helpers ---
const msgEl = document.getElementById("msg");
const sendBtn = document.getElementById("sendBtn");
const logoutBtn = document.getElementById("logoutBtn");
const profileBox = document.getElementById("profileBox");
const fullNameEl = document.getElementById("fullName");
const saveNameBtn = document.getElementById("saveNameBtn");
const profileMsg = document.getElementById("profileMsg");
const topbarUserEl = document.getElementById("topbarUser");
const homeBtn = document.getElementById("homeBtn");
const toastEl = document.getElementById("toast");
const archiveSearchEl = document.getElementById("archiveSearch");
const archiveCountHoursEl = document.getElementById("archiveCountHours");
const archiveCountRequestsEl = document.getElementById("archiveCountRequests");
const archiveCountProductsEl = document.getElementById("archiveCountProducts");
const monthPickerLabelEl = document.getElementById("monthPickerLabel");
const monthPickerLabelInnerEl = document.getElementById("monthPickerLabelInner");

// Home
const homeLastRefreshEl = document.getElementById("homeLastRefresh");
const homeTodayHoursEl = document.getElementById("homeTodayHours");
const homeWeekHoursEl = document.getElementById("homeWeekHours");
const homeReqPendingEl = document.getElementById("homeReqPending");
const homeReqApprovedEl = document.getElementById("homeReqApproved");
const homePoOpenEl = document.getElementById("homePoOpen");
const homePoDeliveredEl = document.getElementById("homePoDelivered");

function setMsg(text, type = "info") {
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.className = `msg ${type}`;
}

function setProfileMsg(t, type="info"){ profileMsg.textContent=t; profileMsg.className=`msg ${type}`; }

let toastTimer = null;
function showToast(text, type = "ok", timeoutMs = 2200) {
  if (!toastEl) return;
  toastEl.textContent = text || "";
  toastEl.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "toast";
    toastEl.textContent = "";
  }, timeoutMs);
}

let currentMonthRows = []; // righe work_logs del mese selezionato

// Ore (multi-riga)
const hoursForm = document.getElementById("hoursForm");
const workDateEl = document.getElementById("work_date");
const hoursRowsEl = document.getElementById("hoursRows");
const addHoursRowBtn = document.getElementById("addHoursRowBtn");
const clearHoursRowsBtn = document.getElementById("clearHoursRowsBtn");

function toMinutes(t) {
  // "HH:MM" -> minuti
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isEmptyRowValues(v) {
  return !v.start_time && !v.end_time && !v.break_start && !v.break_end && !v.location && !v.activity;
}

function validateWorkLogLike({ start_time, end_time, break_start, break_end }, prefixMsg = "") {
  if (!start_time || !end_time) return { ok: false, msg: `${prefixMsg}Seleziona ora inizio e fine.`.trim() };

  const startMin = toMinutes(start_time);
  const endMin = toMinutes(end_time);
  // Calcola durata tenendo conto del passaggio mezzanotte (turni notturni)
  let durationMin = endMin - startMin;
  if (durationMin < 0) durationMin += 24 * 60;
  if (durationMin === 0) return { ok: false, msg: `${prefixMsg}L'ora fine deve essere diversa dall'ora inizio.`.trim() };

  if ((break_start && !break_end) || (!break_start && break_end)) {
    return { ok: false, msg: `${prefixMsg}Se inserisci la pausa, compila sia inizio che fine pausa.`.trim() };
  }
  if (break_start && break_end) {
    const bs = toMinutes(break_start);
    const be = toMinutes(break_end);
    if (be <= bs) {
      return { ok: false, msg: `${prefixMsg}La fine pausa deve essere dopo l'inizio pausa.`.trim() };
    }
    // Verifica che la pausa stia dentro l'orario di lavoro (anche per turni notturni)
    let bsRel = bs - startMin;
    let beRel = be - startMin;
    if (bsRel < 0) bsRel += 24 * 60;
    if (beRel < 0) beRel += 24 * 60;
    if (bsRel >= durationMin || beRel > durationMin) {
      return { ok: false, msg: `${prefixMsg}La pausa deve essere dentro l'orario di lavoro.`.trim() };
    }
  }
  return { ok: true, msg: "" };
}

function formatDateIT(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return String(dateStr);
  return new Intl.DateTimeFormat("it-IT").format(d);
}

function fmtMonthYear(ym) {
  // "YYYY-MM" -> "MM/YYYY"
  const s = String(ym || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return s || "—";
  return `${m[2]}/${m[1]}`;
}

function fmtMonthYearFile(ym) {
  return fmtMonthYear(ym).replace("/", "-");
}

function minutesBetween(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  // Se il risultato è negativo, significa che si è passata la mezzanotte
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function netMinutes(log) {
  let total = minutesBetween(log.start_time, log.end_time);
  if (log.break_start && log.break_end) {
    total -= minutesBetween(log.break_start, log.break_end);
  }
  return Math.max(0, total);
}

function getDatalistValues(listId) {
  const dl = document.getElementById(listId);
  if (!dl) return [];
  const options = Array.from(dl.querySelectorAll("option"));
  return options
    .map(o => (o.getAttribute("value") || "").trim())
    .filter(Boolean);
}

// ============================================================
// CATALOGO: prodotti, luoghi e attività caricati dal database
// (tabella catalog_items). Gestibili dall'admin senza toccare il codice.
// ============================================================

// Riempie un <datalist> (luoghi o attività) con i valori dal DB
function fillDatalist(listId, values) {
  const dl = document.getElementById(listId);
  if (!dl) return;
  dl.innerHTML = (values || [])
    .map(v => `<option value="${escapeHtml(v)}"></option>`)
    .join("");
}

// Stepper quantità: bottone −, numero, bottone +.
// L'input mantiene data-po-qty così tutta la logica d'invio resta invariata.
function stepperHtml(value = 0) {
  const v = Number(value) || 0;
  return (
    `<div class="qty-stepper">` +
      `<button type="button" class="qty-btn" data-qty-dec aria-label="Diminuisci">−</button>` +
      `<input class="qty-input" data-po-qty type="number" min="0" step="1" inputmode="numeric" value="${v}" data-zero="${v === 0}" />` +
      `<button type="button" class="qty-btn" data-qty-inc aria-label="Aumenta">+</button>` +
    `</div>`
  );
}

function makeProductRow(name) {
  const row = document.createElement("div");
  row.className = "product-row";
  row.setAttribute("data-po-item", name);
  row.innerHTML =
    `<div class="product-name">${escapeHtml(name)}</div>` +
    stepperHtml(0);
  return row;
}

// Aggiorna lo stato visivo "vuoto" (0) di un input quantità
function refreshQtyVisual(input) {
  if (!input) return;
  const v = Number(input.value) || 0;
  input.setAttribute("data-zero", String(v === 0));
}

// Somma le quantità di una categoria e aggiorna la pill "N pz" nell'intestazione
function updateCategoryPieces(acc) {
  if (!acc) return;
  let sum = 0;
  acc.querySelectorAll("[data-po-qty]").forEach((i) => { sum += Number(i.value) || 0; });
  const pill = acc.querySelector("[data-cat-pieces]");
  if (!pill) return;
  if (sum > 0) { pill.textContent = `${sum} pz`; pill.hidden = false; }
  else { pill.hidden = true; }
}

function updateCategoryPiecesFor(input) {
  updateCategoryPieces(input?.closest?.(".product-acc"));
}

function refreshAllCategoryPieces() {
  document.querySelectorAll(".product-acc").forEach(updateCategoryPieces);
}

// Rigenera il carrello prodotti raggruppato per categoria (sezioni pieghevoli),
// tenendo sempre la riga "Altro" in fondo, fuori dalle categorie.
function renderProductRows(groupedProducts) {
  const cart = document.getElementById("poCart");
  if (!cart) return;
  const otherRow = cart.querySelector('.product-row[data-po-item="Altro"]');

  // rimuovi tutto il contenuto precedente (categorie/righe), tranne "Altro"
  Array.from(cart.children).forEach((child) => {
    if (child !== otherRow) child.remove();
  });

  // crea le sezioni per categoria prima di "Altro"
  const frag = document.createDocumentFragment();
  for (const group of (groupedProducts || [])) {
    const acc = document.createElement("div");
    acc.className = "acc product-acc";
    acc.setAttribute("data-category", group.category);

    const head = document.createElement("div");
    head.className = "acc-head";
    head.setAttribute("data-acc-toggle", "");
    head.innerHTML =
      `<div class="acc-title">${escapeHtml(group.category)}</div>
      <div class="acc-head-right">
        <span class="cat-pieces" data-cat-pieces hidden>0 pz</span>
        <span class="acc-chev">▾</span>
      </div>`;

    const body = document.createElement("div");
    body.className = "acc-body";
    for (const name of group.names) body.appendChild(makeProductRow(name));

    acc.appendChild(head);
    acc.appendChild(body);
    frag.appendChild(acc);
  }

  if (otherRow) cart.insertBefore(frag, otherRow);
  else cart.appendChild(frag);

  poApplySearch();
  refreshAllCategoryPieces();
}

// Carica il catalogo dal DB e aggiorna liste prodotti (raggruppati per categoria)/luoghi/attività
async function loadCatalog() {
  try {
    const { data, error } = await supabaseClient
      .from("catalog_items")
      .select("type,name,category")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("Errore caricamento catalogo:", error);
      return;
    }

    const productGroups = []; // [{ category, names: [...] }], nell'ordine di comparsa
    const groupIndexByCategory = new Map();
    const places = [];
    const activities = [];

    for (const it of (data || [])) {
      if (it.type === "product") {
        const cat = (it.category || "").trim() || "Altri prodotti";
        let idx = groupIndexByCategory.get(cat);
        if (idx === undefined) {
          idx = productGroups.length;
          groupIndexByCategory.set(cat, idx);
          productGroups.push({ category: cat, names: [] });
        }
        productGroups[idx].names.push(it.name);
      } else if (it.type === "place") {
        places.push(it.name);
      } else if (it.type === "activity") {
        activities.push(it.name);
      }
    }

    renderProductRows(productGroups);
    fillDatalist("placesList", places);
    fillDatalist("activitiesList", activities);
  } catch (e) {
    console.error("Errore imprevisto nel catalogo:", e);
  }
}

function attachAutocomplete({ inputEl, listId, menuEl, onSelect }) {
  if (!inputEl || !menuEl) return;
  let values = null; // lazy
  let hideT = null;
  let pd = null; // pointer tracking (per distinguere tap vs scroll)

  function ensureValues() {
    // Rilegge sempre il datalist: così vede le voci caricate dal database
    // (catalogo dinamico) anche se popolate dopo la creazione della riga.
    return getDatalistValues(listId);
  }

  function hideMenu() {
    menuEl.setAttribute("hidden", "");
    menuEl.innerHTML = "";
  }

  function showMenu() {
    menuEl.removeAttribute("hidden");
  }

  function render() {
    const all = ensureValues();
    const q = (inputEl.value || "").trim().toLowerCase();

    // se l'utente non ha scritto niente, mostra comunque le prime opzioni (così su smartphone "si apre")
    const matches = (q
      ? all.filter(v => v.toLowerCase().includes(q))
      : all
    );

    if (matches.length === 0) {
      menuEl.innerHTML = `<div class="auto-empty">Nessun risultato</div>`;
      showMenu();
      return;
    }

    menuEl.innerHTML = matches
      .map(v => `<button type="button" class="auto-item" data-auto-item="${escapeHtml(v)}">${escapeHtml(v)}</button>`)
      .join("");
    showMenu();
  }

  inputEl.addEventListener("focus", () => {
    clearTimeout(hideT);
    render();
  });

  inputEl.addEventListener("input", () => {
    clearTimeout(hideT);
    render();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideMenu();
  });

  inputEl.addEventListener("blur", () => {
    // piccola attesa per permettere il tap su un elemento del menu (mobile)
    clearTimeout(hideT);
    hideT = setTimeout(() => hideMenu(), 180);
  });

  // Importante UX: scroll nel menu NON deve selezionare una voce.
  // Quindi: seleziona solo se è un "tap/click" (rilascio senza trascinare).
  menuEl.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest?.("[data-auto-item]");
    if (!btn) return;

    // se l'input ha appena fatto blur, non chiudere mentre interagisci col menu
    clearTimeout(hideT);

    // Su mouse: evita che il click sposti il focus (così non parte il blur dell'input)
    if (e.pointerType === "mouse") e.preventDefault();

    pd = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
  });

  menuEl.addEventListener("pointermove", (e) => {
    if (!pd || pd.id !== e.pointerId) return;
    // se stai trascinando (scroll), non considerarlo "tap"
    if (Math.abs(e.clientX - pd.x) + Math.abs(e.clientY - pd.y) > 8) pd.moved = true;
    clearTimeout(hideT);
  });

  menuEl.addEventListener("pointerup", (e) => {
    if (!pd || pd.id !== e.pointerId) return;
    const wasMoved = pd.moved;
    pd = null;
    if (wasMoved) return; // era uno scroll

    const btn = e.target.closest?.("[data-auto-item]");
    if (!btn) return;
    const v = btn.getAttribute("data-auto-item") || "";
    inputEl.value = v;
    hideMenu();
    // IMPORTANT: su smartphone, forzare il focus qui può far aprire input "time" (orologio)
    // perché il browser passa al campo successivo. Quindi NON forziamo il focus.
    try { onSelect?.(v); } catch (_) {}
  });

  menuEl.addEventListener("pointercancel", (e) => {
    if (pd && pd.id === e.pointerId) pd = null;
  });
}

function getHoursRowElements() {
  if (!hoursRowsEl) return [];
  return Array.from(hoursRowsEl.querySelectorAll(".hours-row"));
}

function updateHoursRowUi() {
  const rows = getHoursRowElements();
  rows.forEach((row, idx) => {
    const titleEl = row.querySelector("[data-hours-row-title]");
    if (titleEl) titleEl.textContent = `Riga ${idx + 1}`;

    const removeBtn = row.querySelector("[data-remove-hours-row]");
    if (removeBtn) {
      removeBtn.style.display = rows.length <= 1 ? "none" : "";
      removeBtn.disabled = rows.length <= 1;
    }
  });
}

function makeHoursRow(initial = {}) {
  const row = document.createElement("div");
  row.className = "hours-row";
  row.innerHTML = `
    <div class="hours-row-head">
      <div class="hours-row-title" data-hours-row-title>Riga</div>
      <button class="btn small danger" type="button" data-remove-hours-row>Rimuovi</button>
    </div>

    <div class="grid2">
      <div>
        <label class="label">Ora inizio</label>
        <input class="input" type="time" step="300" data-field="start_time" placeholder="HH:MM" />
      </div>
      <div>
        <label class="label">Ora fine</label>
        <input class="input" type="time" step="300" data-field="end_time" placeholder="HH:MM" />
      </div>
    </div>

    <div class="grid2">
      <div>
        <label class="label">Inizio pausa (opzionale)</label>
        <input class="input" type="time" step="300" data-field="break_start" placeholder="HH:MM" />
      </div>
      <div>
        <label class="label">Fine pausa (opzionale)</label>
        <input class="input" type="time" step="300" data-field="break_end" placeholder="HH:MM" />
      </div>
    </div>

    <label class="label">Luogo</label>
    <div class="auto">
      <input class="input" list="placesList" data-field="location" placeholder="Seleziona o scrivi liberamente..." autocomplete="off" />
      <div class="auto-menu" data-auto-menu="placesList" hidden></div>
    </div>

    <label class="label">Attività</label>
    <div class="auto">
      <input class="input" list="activitiesList" data-field="activity" placeholder="Seleziona o scrivi liberamente..." autocomplete="off" />
      <div class="auto-menu" data-auto-menu="activitiesList" hidden></div>
    </div>
  `;

  // preset valori (se servisse in futuro)
  const setVal = (field, value) => {
    const el = row.querySelector(`[data-field="${field}"]`);
    if (el) el.value = value || "";
  };
  setVal("start_time", initial.start_time);
  setVal("end_time", initial.end_time);
  setVal("break_start", initial.break_start);
  setVal("break_end", initial.break_end);
  setVal("location", initial.location);
  setVal("activity", initial.activity);

  row.querySelector("[data-remove-hours-row]")?.addEventListener("click", () => {
    row.remove();
    // garantisci almeno 1 riga
    if (getHoursRowElements().length === 0) addHoursRow();
    updateHoursRowUi();
  });

  // Autocomplete mobile-friendly (fallback per datalist su smartphone)
  try {
    const locInput = row.querySelector(`[data-field="location"]`);
    const locMenu = row.querySelector(`[data-auto-menu="placesList"]`);
    attachAutocomplete({
      inputEl: locInput,
      listId: "placesList",
      menuEl: locMenu,
      onSelect: () => {
        // Dopo aver scelto il luogo, porta direttamente su "Attività"
        row.querySelector('[data-field="activity"]')?.focus?.();
      }
    });

    const actInput = row.querySelector(`[data-field="activity"]`);
    const actMenu = row.querySelector(`[data-auto-menu="activitiesList"]`);
    attachAutocomplete({
      inputEl: actInput,
      listId: "activitiesList",
      menuEl: actMenu,
      // Dopo aver scelto l'attività, non forzare focus su altri campi
      // (evita apertura automatica dell'orologio su mobile)
      onSelect: () => {}
    });
  } catch (e) {
    console.error(e);
  }

  return row;
}

function addHoursRow(initial = {}) {
  if (!hoursRowsEl) return;
  hoursRowsEl.appendChild(makeHoursRow(initial));
  updateHoursRowUi();
}

function resetHoursRows() {
  if (!hoursRowsEl) return;
  hoursRowsEl.innerHTML = "";
  addHoursRow();
}

function initHoursFormUi() {
  // default data = oggi
  if (workDateEl && !workDateEl.value) workDateEl.value = getTodayISO();

  // se la pagina è appena caricata e non ci sono righe, crea la prima
  if (hoursRowsEl && getHoursRowElements().length === 0) addHoursRow();

  addHoursRowBtn?.addEventListener("click", () => {
    setMsg("");
    addHoursRow();
  });

  clearHoursRowsBtn?.addEventListener("click", () => {
    setMsg("");
    resetHoursRows();
  });
}

function formatHM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
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
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

// --- Logout ---
logoutBtn.addEventListener("click", async () => {
  try { await supabaseClient.auth.signOut(); } catch (_) {}
  try { sessionStorage.clear(); } catch (_) {}
  try { localStorage.clear(); } catch (_) {}
  window.location.replace("login.html");
});

// --- Profilo: nome e cognome (una volta sola) ---
(async () => {
  try {
    const p = await getMyProfile();
    if (topbarUserEl) {
      const name = (p?.full_name || "").trim() || "Dipendente";
      topbarUserEl.textContent = `${name} • Dipendente`;
    }
    if (p && (!p.full_name || p.full_name.trim() === "")) {
      profileBox.style.display = "block";
    }
  } catch(e){ console.error(e); }
})();

// Home: carica subito il riepilogo all'apertura pagina
setActiveView("home");
loadHomeSummary();
initHoursFormUi();
loadCatalog(); // carica prodotti/luoghi/attività dal database

saveNameBtn?.addEventListener("click", async () => {
  const name = fullNameEl.value.trim();
  if (!name) return setProfileMsg("Inserisci nome e cognome.", "error");

  try {
    const user = await getCurrentUser();
    const { error } = await supabaseClient
      .from("profiles")
      .update({ full_name: name })
      .eq("id", user.id);

    if (error) throw error;

    setProfileMsg("Salvato ✅", "ok");
    showToast("Nome salvato ✅", "ok");
    profileBox.style.display = "none";
  } catch (e) {
    console.error(e);
    setProfileMsg("Errore salvataggio nome.", "error");
    showToast("Errore salvataggio nome", "error");
  }
});

// --- Tabs ---
// Click su "CAME" => torna alla Home
document.querySelector(".topbar h2")?.addEventListener("click", () => {
  setActiveView("home");
  loadHomeSummary();
});

homeBtn?.addEventListener("click", () => {
  setActiveView("home");
  loadHomeSummary();
});

function setActiveView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add("active");

  // mostra/nasconde bottone Home in base alla view
  if (homeBtn) homeBtn.style.display = (view && view !== "home") ? "" : "none";

  // Mobile UX: quando cambi sezione vai sempre in alto, così non “intravedi” contenuti della sezione precedente
  try { window.scrollTo(0, 0); } catch (_) {}
}

function setArchiveSection(section) {
  // cards
  document.querySelectorAll("[data-archive]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-archive") === section);
  });
  // sections
  const secIds = ["hours", "requests", "products"];
  secIds.forEach(s => {
    const el = document.getElementById(`archive-section-${s}`);
    if (el) el.classList.toggle("active", s === section);
  });

  // Su smartphone: mostra i filtri solo nella sezione "Ore" (riduce la pagina lunga).
  // Su PC/desktop: i filtri devono restare sempre visibili.
  const filtersCard = document.getElementById("archiveFiltersCard");
  if (filtersCard) {
    const isMobile = window.matchMedia && window.matchMedia("(max-width: 520px)").matches;
    filtersCard.style.display = (!isMobile || section === "hours") ? "" : "none";
  }

  // Mobile UX: quando cambi sottosezione in Archivio vai in alto,
  // così non resti “in mezzo” e non intravedi contenuti della sezione precedente.
  try { window.scrollTo(0, 0); } catch (_) {}
}

function initArchiveCards() {
  const cards = document.querySelectorAll("[data-archive]");
  if (!cards || cards.length === 0) return;

  cards.forEach(btn => {
    btn.addEventListener("click", () => {
      const section = btn.getAttribute("data-archive");
      if (!section) return;
      setArchiveSection(section);
      // migliora UX mobile: vai all'inizio della sezione scelta
      document.getElementById(`archive-section-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// Home quick nav
document.querySelectorAll("[data-nav]").forEach(btn => {
  btn.addEventListener("click", () => {
    const v = btn.getAttribute("data-nav");
    if (!v) return;
    setActiveView(v);
    if (v === "home") loadHomeSummary();
    if (v === "archive") loadArchive();
    if (v === "requests") initRequestsUI();
    if (v === "products") initProductsUI();
    if (v === "products" || v === "hours") loadCatalog();
  });
});

async function goToArchiveAndRefresh({ section } = {}) {
  setActiveView("archive");
  initArchiveCards();
  setArchiveSection(section || "hours");
  await loadArchive();

  document.getElementById(`archive-section-${section || "hours"}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function fmtTimeIT(d) {
  return new Intl.DateTimeFormat("it-IT", { timeStyle: "short" }).format(d);
}

async function loadHomeSummary() {
  try {
    if (homeLastRefreshEl) homeLastRefreshEl.textContent = "Caricamento...";
    if (homeTodayHoursEl) homeTodayHoursEl.textContent = "—";
    if (homeWeekHoursEl) homeWeekHoursEl.textContent = "—";
    if (homeReqPendingEl) homeReqPendingEl.textContent = "—";
    if (homeReqApprovedEl) homeReqApprovedEl.textContent = "—";
    if (homePoOpenEl) homePoOpenEl.textContent = "—";
    if (homePoDeliveredEl) homePoDeliveredEl.textContent = "—";

    const user = await getCurrentUser();
    if (!user) return;

    const todayISO = getTodayISO();

    // range settimana (lun->dom)
    const now = new Date();
    const day = now.getDay(); // 0=dom
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekStart = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,"0")}-${String(monday.getDate()).padStart(2,"0")}`;
    const weekEnd = `${sunday.getFullYear()}-${String(sunday.getMonth()+1).padStart(2,"0")}-${String(sunday.getDate()).padStart(2,"0")}`;

    const ym = getCurrentMonthISO();
    const mStart = `${ym}-01`;
    const mEndDate = new Date(ym + "-01T00:00:00");
    mEndDate.setMonth(mEndDate.getMonth() + 1);
    mEndDate.setDate(0);
    const mEnd = `${ym}-${String(mEndDate.getDate()).padStart(2, "0")}`;

    // Filtra sempre per user_id: riduce carico e dipendenza dalle policy RLS
    const pWorkWeek = supabaseClient
      .from("work_logs")
      .select("work_date,start_time,end_time,break_start,break_end")
      .eq("user_id", user.id)
      .gte("work_date", weekStart)
      .lte("work_date", weekEnd);

    const pReqPending = supabaseClient
      .from("requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "inviata");

    const pReqApproved = supabaseClient
      .from("requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "approvata")
      .gte("start_date", mStart)
      .lte("start_date", mEnd);

    const pPoOpen = supabaseClient
      .from("product_orders")
      .select("order_date,place,delivery_date")
      .eq("user_id", user.id)
      .gte("order_date", mStart)
      .lte("order_date", mEnd)
      .is("delivery_date", null);

    const pPoDelivered = supabaseClient
      .from("product_orders")
      .select("order_date,place,delivery_date")
      .eq("user_id", user.id)
      .gte("order_date", mStart)
      .lte("order_date", mEnd)
      .not("delivery_date", "is", null);

    const [
      { data: workW, error: e1 },
      { count: reqPending, error: e2 },
      { count: reqApproved, error: e3 },
      { data: openPo, error: e4 },
      { data: delPo, error: e5 },
    ] = await Promise.all([pWorkWeek, pReqPending, pReqApproved, pPoOpen, pPoDelivered]);

    if (e1) throw e1;
    if (e2) throw e2;
    if (e3) throw e3;
    if (e4) throw e4;
    if (e5) throw e5;

    const rows = workW || [];
    let weekMin = 0;
    let todayMin = 0;
    for (const r of rows) {
      const nm = netMinutes(r);
      weekMin += nm;
      if (r.work_date === todayISO) todayMin += nm;
    }

    if (homeWeekHoursEl) homeWeekHoursEl.textContent = formatHM(weekMin);
    if (homeTodayHoursEl) homeTodayHoursEl.textContent = formatHM(todayMin);
    if (homeReqPendingEl) homeReqPendingEl.textContent = String(reqPending ?? 0);
    if (homeReqApprovedEl) homeReqApprovedEl.textContent = String(reqApproved ?? 0);

    // ordini non consegnati: conta ordini unici (data+luogo)
    const grp = new Set((openPo || []).map(r => `${r.order_date}|${r.place || ""}`));
    if (homePoOpenEl) homePoOpenEl.textContent = String(grp.size);

    const grpDel = new Set((delPo || []).map(r => `${r.order_date}|${r.place || ""}`));
    if (homePoDeliveredEl) homePoDeliveredEl.textContent = String(grpDel.size);

    if (homeLastRefreshEl) homeLastRefreshEl.textContent = `Aggiornato alle ${fmtTimeIT(new Date())}`;
  } catch (e) {
    console.error(e);
    if (homeLastRefreshEl) homeLastRefreshEl.textContent = "Errore caricamento.";
    showToast("Errore caricamento Home", "error");
  }
}

function initArchiveToolbar() {
  // Filtri:
  // - su PC/desktop: sempre visibili
  // - su smartphone: apri/chiudi (chiusi di default), ma se l'utente li apre/chiude non forziamo più
  const filtersToggle = document.querySelector(".archive-filters-toggle");
  if (filtersToggle) {
    // consideriamo "desktop" solo schermi larghi con puntatore fine (evita tablet/telefono in modalità desktop)
    const isDesktop =
      window.matchMedia &&
      window.matchMedia("(min-width: 900px) and (pointer: fine)").matches;

    // registra interazione utente (una volta)
    if (!filtersToggle.dataset.boundToggle) {
      filtersToggle.dataset.boundToggle = "1";
      filtersToggle.addEventListener("toggle", () => {
        filtersToggle.dataset.userToggled = "1";
      });
    }

    if (isDesktop) {
      filtersToggle.setAttribute("open", "");
    } else {
      // mobile: chiuso di default finché l'utente non interagisce
      if (!filtersToggle.dataset.userToggled) {
        filtersToggle.removeAttribute("open");
      }
    }
  }

  // Quick month chips
  document.querySelectorAll("[data-month-quick]").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-month-quick");
      const d = new Date();
      if (k === "last") d.setMonth(d.getMonth() - 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (monthPicker) monthPicker.value = ym;
      loadArchive();
    });
  });

  // Search (filters visible list only)
  let t = null;
  archiveSearchEl?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => applyArchiveSearch(), 120);
  });

  // Request chips
  document.querySelectorAll("[data-req-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.getAttribute("data-req-filter");
      document.querySelectorAll("[data-req-filter]").forEach(b => b.classList.toggle("active", b === btn));
      const pendingWrap = document.getElementById("requestsPendingList");
      const doneWrap = document.getElementById("requestsArchiveList");
      if (pendingWrap && doneWrap) {
        pendingWrap.style.display = (v === "done") ? "none" : "";
        doneWrap.style.display = (v === "pending") ? "none" : "";
      }
      applyArchiveSearch();
    });
  });

  // Product chips
  document.querySelectorAll("[data-po-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.getAttribute("data-po-filter");
      document.querySelectorAll("[data-po-filter]").forEach(b => b.classList.toggle("active", b === btn));
      document.querySelectorAll("[data-po-group]").forEach(card => {
        const delivered = card.getAttribute("data-delivered") === "1";
        const show = (v === "all") || (v === "open" && !delivered) || (v === "delivered" && delivered);
        card.style.display = show ? "" : "none";
      });
      applyArchiveSearch();
    });
  });

  // Shortcut mobile: "Cambia mese" (porta a Ore e mostra i filtri)
  document.querySelectorAll("[data-archive-month-shortcut]").forEach(btn => {
    btn.addEventListener("click", () => {
      setArchiveSection("hours");
      const fc = document.getElementById("archiveFiltersCard");
      fc?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("monthPicker")?.focus?.();
    });
  });
}

function applyArchiveSearch() {
  const q = (archiveSearchEl?.value || "").trim().toLowerCase();
  // filtra solo elementi marcati con data-search
  document.querySelectorAll("[data-search]").forEach(el => {
    if (!q) { el.style.display = ""; return; }
    const hay = String(el.getAttribute("data-search") || "").toLowerCase();
    el.style.display = hay.includes(q) ? "" : "none";
  });
}

// ============================
// MODIFICA ORE (Archivio)
// ============================

function bindHoursEditButtons(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll("[data-edit-worklog]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rowItem = btn.closest(".rowItem");
      if (!rowItem) return;
      const id = rowItem.getAttribute("data-worklog-id");
      if (!id) return alert("ID riga mancante (ricarica la pagina).");
      if (rowItem.querySelector("[data-worklog-editor]")) return; // già in edit
      startEditWorkLog(rowItem);
    });
  });
}

function startEditWorkLog(rowItemEl) {
  const id = rowItemEl.getAttribute("data-worklog-id");
  if (!id) return;

  const r = currentMonthRows.find(x => String(x.id) === String(id));
  if (!r) {
    alert("Riga non trovata. Prova a ricaricare l'archivio.");
    return;
  }

  const editor = document.createElement("div");
  editor.className = "inline-editor";
  editor.setAttribute("data-worklog-editor", "1");
  editor.innerHTML = `
    <div class="grid2">
      <div>
        <label class="label">Ora inizio</label>
        <input class="input" type="time" step="300" data-e="start_time" value="${escapeHtml(r.start_time || "")}" />
      </div>
      <div>
        <label class="label">Ora fine</label>
        <input class="input" type="time" step="300" data-e="end_time" value="${escapeHtml(r.end_time || "")}" />
      </div>
    </div>

    <div class="grid2">
      <div>
        <label class="label">Inizio pausa (opzionale)</label>
        <input class="input" type="time" step="300" data-e="break_start" value="${escapeHtml(r.break_start || "")}" />
      </div>
      <div>
        <label class="label">Fine pausa (opzionale)</label>
        <input class="input" type="time" step="300" data-e="break_end" value="${escapeHtml(r.break_end || "")}" />
      </div>
    </div>

    <label class="label">Luogo</label>
    <div class="auto">
      <input class="input" list="placesList" data-e="location" autocomplete="off" value="${escapeHtml(r.location || "")}" />
      <div class="auto-menu" data-auto-menu="placesList" hidden></div>
    </div>

    <label class="label">Attività</label>
    <div class="auto">
      <input class="input" list="activitiesList" data-e="activity" autocomplete="off" value="${escapeHtml(r.activity || "")}" />
      <div class="auto-menu" data-auto-menu="activitiesList" hidden></div>
    </div>

    <div class="inline-actions">
      <button type="button" class="btn small primary" data-save>Salva</button>
      <button type="button" class="btn small" data-cancel>Annulla</button>
    </div>
    <p class="msg" data-editor-msg></p>
  `;

  // Autocomplete mobile-friendly
  try {
    const locInput = editor.querySelector(`[data-e="location"]`);
    const locMenu = editor.querySelector(`[data-auto-menu="placesList"]`);
    attachAutocomplete({
      inputEl: locInput,
      listId: "placesList",
      menuEl: locMenu,
      onSelect: () => {
        editor.querySelector('[data-e="activity"]')?.focus?.();
      }
    });
    const actInput = editor.querySelector(`[data-e="activity"]`);
    const actMenu = editor.querySelector(`[data-auto-menu="activitiesList"]`);
    attachAutocomplete({
      inputEl: actInput,
      listId: "activitiesList",
      menuEl: actMenu,
      onSelect: () => {}
    });
  } catch (_) {}

  const msg = (t, type = "info") => {
    const el = editor.querySelector("[data-editor-msg]");
    if (!el) return;
    el.textContent = t || "";
    el.className = `msg ${type}`;
  };

  editor.querySelector("[data-cancel]")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    editor.remove();
  });

  editor.querySelector("[data-save]")?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const saveBtn = editor.querySelector("[data-save]");
    try {
      msg("");
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvo..."; }

      const start_time = (editor.querySelector('[data-e="start_time"]')?.value || "").trim();
      const end_time = (editor.querySelector('[data-e="end_time"]')?.value || "").trim();
      const break_start = (editor.querySelector('[data-e="break_start"]')?.value || "").trim() || null;
      const break_end = (editor.querySelector('[data-e="break_end"]')?.value || "").trim() || null;
      const location = (editor.querySelector('[data-e="location"]')?.value || "").trim();
      const activity = (editor.querySelector('[data-e="activity"]')?.value || "").trim();

      if (!location || !activity) {
        msg("Compila luogo e attività.", "error");
        return;
      }

      const v = validateWorkLogLike({ start_time, end_time, break_start, break_end });
      if (!v.ok) { msg(v.msg, "error"); return; }

      const { error } = await supabaseClient
        .from("work_logs")
        .update({ start_time, end_time, break_start, break_end, location, activity })
        .eq("id", id);

      if (error) {
        console.error(error);
        msg("Errore salvataggio. Controlla console e RLS.", "error");
        return;
      }

      msg("Salvato ✅", "ok");
      showToast("Ore modificate ✅", "ok");
      await loadArchive();
    } catch (err) {
      console.error(err);
      msg("Errore imprevisto. Controlla console.", "error");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Salva"; }
    }
  });

  // inserisci editor sotto le info della riga
  rowItemEl.appendChild(editor);
  editor.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}

// Accordion toggle (event delegation)
document.addEventListener("click", (e) => {
  const head = e.target.closest?.("[data-acc-toggle]");
  if (!head) return;
  const acc = head.closest(".acc");
  if (!acc) return;
  acc.classList.toggle("open");
});

// Se passi da mobile a desktop (o viceversa) aggiorna la visibilità dei filtri Archivio
try {
  const mq = window.matchMedia("(min-width: 900px) and (pointer: fine)");
  mq.addEventListener?.("change", () => {
    const t = document.querySelector(".archive-filters-toggle");
    if (!t) return;
    if (mq.matches) {
      t.setAttribute("open", "");
    } else {
      // tornando su mobile, chiudi di default se l'utente non ha scelto esplicitamente
      if (!t.dataset.userToggled) t.removeAttribute("open");
    }
  });
} catch (_) {}

// ============================
// RICHIESTE (dipendente)
// ============================

const reqForm = document.getElementById("requestsForm");
const reqTypeEl = document.getElementById("req_type");
const reqDatesRangeBox = document.getElementById("req_dates_range");
const reqDateSingleBox = document.getElementById("req_date_single");
const reqTimeBox = document.getElementById("req_time_box");

const reqStartDateEl = document.getElementById("req_start_date");
const reqEndDateEl = document.getElementById("req_end_date");
const reqSingleDateEl = document.getElementById("req_single_date");
const reqTimeEl = document.getElementById("req_time");
const reqNoteEl = document.getElementById("req_note");
const reqMsgEl = document.getElementById("reqMsg");
const reqSendBtn = document.getElementById("reqSendBtn");
const requestsPendingListEl = document.getElementById("requestsPendingList");
const requestsArchiveListEl = document.getElementById("requestsArchiveList");
const productsArchiveListEl = document.getElementById("productsArchiveList");

// ============================
// PRODOTTI (dipendente)
// ============================

const productsForm = document.getElementById("productsForm");
const poDateEl = document.getElementById("po_date");
const poPlaceEl = document.getElementById("po_place");
const poSearchEl = document.getElementById("poSearch");
const poCartEl = document.getElementById("poCart");
const poOtherNameEl = document.getElementById("poOtherName");
const poClearCartBtn = document.getElementById("poClearCartBtn");
const poFill1Btn = document.getElementById("poFill1Btn");
const poSendBtn = document.getElementById("poSendBtn");
const poMsgEl = document.getElementById("poMsg");

let productsUiInitialized = false;

function setPoMsg(text, type = "info") {
  if (!poMsgEl) return;
  poMsgEl.textContent = text || "";
  poMsgEl.className = `msg ${type}`;
}

function poGetRows() {
  return Array.from(poCartEl?.querySelectorAll(".product-row") || []);
}

function poApplySearch() {
  const q = (poSearchEl?.value || "").trim().toLowerCase();

  // Per ogni categoria: mostra solo i prodotti che combaciano (o tutti, se combacia
  // il nome della categoria), nascondi la categoria se non ha risultati e, mentre
  // si cerca, aprila automaticamente così i risultati si vedono subito.
  document.querySelectorAll(".product-acc").forEach((acc) => {
    const categoryMatches = !!q && String(acc.getAttribute("data-category") || "").toLowerCase().includes(q);
    let hasVisible = false;

    acc.querySelectorAll(".product-row").forEach((row) => {
      const name = String(row.getAttribute("data-po-item") || "").toLowerCase();
      const visible = !q || categoryMatches || name.includes(q);
      row.style.display = visible ? "grid" : "none";
      if (visible) hasVisible = true;
    });

    acc.style.display = hasVisible ? "" : "none";
    acc.classList.toggle("open", !!q && hasVisible);
  });

  // "Altro" è il campo libero: resta sempre visibile, non è dentro una categoria
  const otherRow = document.querySelector('#poCart > .product-row[data-po-item="Altro"]');
  if (otherRow) otherRow.style.display = "grid";
}

function poClearQuantities() {
  for (const row of poGetRows()) {
    const qtyEl = row.querySelector("[data-po-qty]");
    if (qtyEl) { qtyEl.value = 0; refreshQtyVisual(qtyEl); }
  }
  if (poOtherNameEl) poOtherNameEl.value = "";
  refreshAllCategoryPieces();
}

function poFillVisibleOnes() {
  for (const row of poGetRows()) {
    if (row.style.display === "none") continue;
    if (row.offsetParent === null) continue; // dentro una categoria chiusa: non è visibile
    const qtyEl = row.querySelector("[data-po-qty]");
    if (!qtyEl) continue;
    const v = Number(qtyEl.value || 0);
    if (!Number.isFinite(v) || v <= 0) { qtyEl.value = 1; refreshQtyVisual(qtyEl); }
  }
  refreshAllCategoryPieces();
}

// Stepper +/− e digitazione manuale: un solo listener sul contenitore (delega)
function initProductStepper() {
  if (!poCartEl) return;

  poCartEl.addEventListener("click", (e) => {
    const dec = e.target.closest?.("[data-qty-dec]");
    const inc = e.target.closest?.("[data-qty-inc]");
    if (!dec && !inc) return;
    const stepper = (dec || inc).closest(".qty-stepper");
    const input = stepper?.querySelector("[data-po-qty]");
    if (!input) return;
    let v = Number(input.value) || 0;
    v = inc ? v + 1 : Math.max(0, v - 1);
    input.value = v;
    refreshQtyVisual(input);
    updateCategoryPiecesFor(input);
    setPoMsg("");
  });

  poCartEl.addEventListener("input", (e) => {
    const input = e.target.closest?.("[data-po-qty]");
    if (!input) return;
    if ((Number(input.value) || 0) < 0) input.value = 0;
    refreshQtyVisual(input);
    updateCategoryPiecesFor(input);
  });
}

function initProductsUI() {
  if (productsUiInitialized) return;
  productsUiInitialized = true;

  // default date e mese
  const today = getTodayISO();
  if (poDateEl && !poDateEl.value) poDateEl.value = today;

  // stepper quantità (+/−) + digitazione manuale
  initProductStepper();

  // ricerca rapida
  let t = null;
  poSearchEl?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      setPoMsg("");
      poApplySearch();
    }, 150);
  });
  poApplySearch();

  poClearCartBtn?.addEventListener("click", () => {
    setPoMsg("");
    poClearQuantities();
  });
  poFill1Btn?.addEventListener("click", () => {
    setPoMsg("");
    poFillVisibleOnes();
  });

  productsForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      setPoMsg("");
      if (poSendBtn) {
        poSendBtn.disabled = true;
        poSendBtn.textContent = "Invio...";
      }

      const user = await getCurrentUser();
      if (!user) {
        setPoMsg("Sessione scaduta. Rifai login.", "error");
        window.location.replace("login.html");
        return;
      }

      const order_date = poDateEl?.value || "";
      const place = (poPlaceEl?.value || "").trim();
      if (!order_date) return setPoMsg("Seleziona la data.", "error");
      if (!place) return setPoMsg("Inserisci il luogo.", "error");

      const payloads = [];

      for (const row of poGetRows()) {
        const key = (row.getAttribute("data-po-item") || "").trim();
        const qtyEl = row.querySelector("[data-po-qty]");
        const quantity = Number(qtyEl?.value || 0);
        if (!Number.isFinite(quantity) || quantity < 0) {
          setPoMsg("Quantità non valida (usa 0 o numeri positivi).", "error");
          return;
        }
        if (quantity === 0) continue;

        let product_name = key;
        if (key === "Altro") {
          const otherName = (poOtherNameEl?.value || "").trim();
          if (!otherName) {
            setPoMsg("Hai messo quantità su 'Altro': scrivi il nome del prodotto.", "error");
            return;
          }
          product_name = otherName;
        }

        payloads.push({
          user_id: user.id,
          order_date,
          place,
          product_name,
          quantity,
        });
      }

      if (payloads.length === 0) {
        setPoMsg("Imposta almeno una quantità > 0.", "error");
        return;
      }

      const { error } = await supabaseClient.from("product_orders").insert(payloads);
      if (error) {
        console.error(error);
        setPoMsg("Errore invio richiesta prodotti. Controlla console e RLS.", "error");
        showToast("Errore invio prodotti", "error");
        return;
      }

      const totalPieces = payloads.reduce((acc, p) => acc + (Number(p.quantity) || 0), 0);
      setPoMsg(`Richiesta inviata ✅ (${payloads.length} prodotti, ${totalPieces} pezzi)`, "ok");
      showToast("Ordine prodotti inviato ✅", "ok");
      productsForm.reset();
      if (poDateEl) poDateEl.value = getTodayISO();
      poClearQuantities();
      if (poSearchEl) poSearchEl.value = "";
      poApplySearch();
      // Non reindirizzare automaticamente all'Archivio: resta nella schermata corrente.

    } catch (err) {
      console.error(err);
      setPoMsg("Errore imprevisto. Controlla console.", "error");
    } finally {
      if (poSendBtn) {
        poSendBtn.disabled = false;
        poSendBtn.textContent = "Invia richiesta";
      }
    }
  });
}

async function loadProductsArchive(ym) {
  if (!productsArchiveListEl) return;
  productsArchiveListEl.textContent = "Caricamento...";

  try {
    const user = await getCurrentUser();
    if (!user) {
      productsArchiveListEl.textContent = "Sessione scaduta.";
      return;
    }

    const month = ym || (monthPicker?.value || getCurrentMonthISO());
    const start = `${ym}-01`;
    const endDate = new Date(ym + "-01T00:00:00");
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0);
    const end = `${ym}-${String(endDate.getDate()).padStart(2, "0")}`;

    const { data, error } = await supabaseClient
      .from("product_orders")
      .select("id,order_date,delivery_date,place,product_name,quantity,created_at")
      .eq("user_id", user.id)
      .gte("order_date", start)
      .lte("order_date", end)
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      productsArchiveListEl.textContent = "Errore caricamento ordini.";
      return;
    }

    if (!data || data.length === 0) {
      productsArchiveListEl.textContent = "Nessun ordine in questo mese.";
      if (archiveCountProductsEl) archiveCountProductsEl.textContent = "0";
      return;
    }

    // Raggruppa per ordine unico: (order_date, place)
    const groupsMap = new Map(); // key -> group
    for (const r of data) {
      const date = r.order_date;
      const place = r.place || "";
      const key = `${date}|${place}`;

      const g = groupsMap.get(key) || {
        key,
        order_date: date,
        place,
        delivery_date: r.delivery_date || null,
        created_at: r.created_at,
        items: [],
      };

      if (r.created_at && (!g.created_at || r.created_at > g.created_at)) g.created_at = r.created_at;
      if (r.delivery_date && !g.delivery_date) g.delivery_date = r.delivery_date;

      g.items.push({ product_name: r.product_name, quantity: r.quantity });
      groupsMap.set(key, g);
    }

    const groups = Array.from(groupsMap.values()).sort((a, b) => {
      if (a.order_date !== b.order_date) return String(b.order_date).localeCompare(String(a.order_date));
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    if (archiveCountProductsEl) {
      const open = groups.filter(g => !g.delivery_date).length;
      archiveCountProductsEl.textContent = open ? `${open}` : `${groups.length}`;
    }

    productsArchiveListEl.innerHTML = groups.map(g => {
      const delivered = !!g.delivery_date;
      const pieces = g.items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
      const itemsHtml = g.items
        .map(it => `<li>${escapeHtml(it.product_name)} — <strong>${escapeHtml(String(it.quantity))}</strong></li>`)
        .join("");

      const search = `${g.place} ${safeFormatDateIT(g.order_date)} ${g.items.map(i => i.product_name).join(" ")} ${delivered ? "consegnato" : "non consegnato"}`;
      return `
        <div class="acc" data-po-group data-delivered="${delivered ? "1" : "0"}" data-search="${escapeHtml(search)}">
          <div class="acc-head" data-acc-toggle>
            <div>
              <div class="acc-title">${escapeHtml(safeFormatDateIT(g.order_date))} • ${escapeHtml(g.place)}</div>
              <div class="acc-meta">${delivered ? `Consegnato il ${escapeHtml(safeFormatDateIT(g.delivery_date))}` : "Non consegnato"}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span class="pill">${escapeHtml(String(pieces))} pz</span>
              <span class="acc-chev">▾</span>
            </div>
          </div>
          <div class="acc-body">
            <div class="muted" style="margin-top:2px;">Prodotti:</div>
            <ul style="margin-top:8px;">
              ${itemsHtml}
            </ul>
            <div style="margin-top:10px;">
              ${delivered ? "" : `<button class="btn small" data-del-po-group data-order-date="${escapeHtml(String(g.order_date))}" data-place="${escapeHtml(encodeURIComponent(g.place || ""))}">Annulla ordine</button>`}
            </div>
          </div>
        </div>
      `;
    }).join("");

    // Annulla ordine completo (tutte le righe del gruppo)
    productsArchiveListEl.querySelectorAll("[data-del-po-group]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const orderDate = btn.getAttribute("data-order-date");
        const placeEnc = btn.getAttribute("data-place") || "";
        const place = decodeURIComponent(placeEnc);
        if (!orderDate) return;

        if (!confirm("Vuoi annullare TUTTO l'ordine (tutti i prodotti) per questo luogo e data?")) return;

        const { error } = await supabaseClient
          .from("product_orders")
          .delete()
          .eq("order_date", orderDate)
          .eq("place", place);

        if (error) {
          console.error(error);
          alert("Errore durante l'annullamento (se già consegnato non si può). Controlla console.");
          return;
        }
        await loadProductsArchive(month);
      });
    });

  } catch (err) {
    console.error(err);
    productsArchiveListEl.textContent = "Errore imprevisto.";
  }
}

let requestsUiInitialized = false;

function setReqMsg(text, type = "info") {
  if (!reqMsgEl) return;
  reqMsgEl.textContent = text || "";
  reqMsgEl.className = `msg ${type}`;
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

function validatePendingRequestEdit({ type, start_date, end_date, time }) {
  const t = String(type || "").trim();
  if (!t) return { ok: false, msg: "Tipo richiesta non valido." };

  if (t === "ferie") {
    if (!start_date || !end_date) return { ok: false, msg: "Inserisci data inizio e data fine." };
    if (end_date < start_date) return { ok: false, msg: "La data fine deve essere uguale o dopo la data inizio." };
    return { ok: true, msg: "" };
  }
  if (t === "permesso_giornaliero") {
    if (!start_date) return { ok: false, msg: "Inserisci la data del permesso." };
    return { ok: true, msg: "" };
  }
  if (t === "uscita_anticipata" || t === "entrata_posticipata") {
    if (!start_date || !time) return { ok: false, msg: "Inserisci data e ora." };
    return { ok: true, msg: "" };
  }
  return { ok: false, msg: "Tipo richiesta non valido." };
}

function safeFormatDateIT(dateStr) {
  if (!dateStr) return "—";
  return formatDateIT(dateStr);
}

function renderReqFieldsByType() {
  const t = (reqTypeEl?.value || "").trim();

  // reset visibilità
  if (reqDatesRangeBox) reqDatesRangeBox.style.display = "none";
  if (reqDateSingleBox) reqDateSingleBox.style.display = "none";
  if (reqTimeBox) reqTimeBox.style.display = "none";

  // reset required (gestito via validazioni JS)
  if (!t) return;

  if (t === "ferie") {
    if (reqDatesRangeBox) reqDatesRangeBox.style.display = "block";
  } else if (t === "permesso_giornaliero") {
    if (reqDateSingleBox) reqDateSingleBox.style.display = "block";
  } else if (t === "uscita_anticipata" || t === "entrata_posticipata") {
    if (reqDateSingleBox) reqDateSingleBox.style.display = "block";
    if (reqTimeBox) reqTimeBox.style.display = "block";
  }
}

function initRequestsUI() {
  if (requestsUiInitialized) return;
  requestsUiInitialized = true;

  reqTypeEl?.addEventListener("change", () => {
    setReqMsg("");
    renderReqFieldsByType();
  });

  // default date = oggi
  const today = getTodayISO();
  if (reqSingleDateEl && !reqSingleDateEl.value) reqSingleDateEl.value = today;
  if (reqStartDateEl && !reqStartDateEl.value) reqStartDateEl.value = today;
  if (reqEndDateEl && !reqEndDateEl.value) reqEndDateEl.value = today;

  renderReqFieldsByType();

  reqForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      setReqMsg("");
      if (reqSendBtn) {
        reqSendBtn.disabled = true;
        reqSendBtn.textContent = "Invio...";
      }

      const user = await getCurrentUser();
      if (!user) {
        setReqMsg("Sessione scaduta. Rifai login.", "error");
        window.location.replace("login.html");
        return;
      }

      const type = (reqTypeEl?.value || "").trim();
      const note = (reqNoteEl?.value || "").trim() || null;

      if (!type) {
        setReqMsg("Seleziona un tipo richiesta.", "error");
        return;
      }

      let start_date = null;
      let end_date = null;
      let time = null;

      if (type === "ferie") {
        start_date = reqStartDateEl?.value || null;
        end_date = reqEndDateEl?.value || null;
        if (!start_date || !end_date) {
          setReqMsg("Inserisci data inizio e data fine.", "error");
          return;
        }
        if (end_date < start_date) {
          setReqMsg("La data fine deve essere uguale o dopo la data inizio.", "error");
          return;
        }
      } else if (type === "permesso_giornaliero") {
        start_date = reqSingleDateEl?.value || null;
        if (!start_date) {
          setReqMsg("Inserisci la data del permesso.", "error");
          return;
        }
      } else if (type === "uscita_anticipata" || type === "entrata_posticipata") {
        start_date = reqSingleDateEl?.value || null;
        time = reqTimeEl?.value || null;
        if (!start_date || !time) {
          setReqMsg("Inserisci data e ora.", "error");
          return;
        }
      } else {
        setReqMsg("Tipo richiesta non valido.", "error");
        return;
      }

      const payload = {
        user_id: user.id,
        type,
        start_date,
        end_date,
        time,
        note,
      };

      const { error } = await supabaseClient.from("requests").insert(payload);
      if (error) {
        console.error(error);
        setReqMsg("Errore invio richiesta. Controlla console e RLS.", "error");
        showToast("Errore invio richiesta", "error");
        return;
      }

      setReqMsg("Richiesta inviata ✅", "ok");
      showToast("Richiesta inviata ✅", "ok");
      reqForm.reset();
      renderReqFieldsByType();
      // Non reindirizzare automaticamente all'Archivio: resta nella schermata corrente.

    } catch (err) {
      console.error(err);
      setReqMsg("Errore imprevisto. Controlla console.", "error");
    } finally {
      if (reqSendBtn) {
        reqSendBtn.disabled = false;
        reqSendBtn.textContent = "Invia richiesta";
      }
    }
  });
}

async function loadRequestsPendingArchive(ym) {
  if (!requestsPendingListEl) return;
  requestsPendingListEl.textContent = "Caricamento...";

  try {
    const user = await getCurrentUser();
    if (!user) {
      requestsPendingListEl.textContent = "Sessione scaduta.";
      return;
    }

    const { data, error } = await supabaseClient
      .from("requests")
      .select("id,type,start_date,end_date,time,status,note,created_at")
      .eq("user_id", user.id)
      .eq("status", "inviata")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      requestsPendingListEl.textContent = "Errore caricamento richieste.";
      return;
    }

    if (!data || data.length === 0) {
      requestsPendingListEl.textContent = "Nessuna richiesta in attesa.";
      if (archiveCountRequestsEl) archiveCountRequestsEl.textContent = "0";
      return;
    }
    if (archiveCountRequestsEl) archiveCountRequestsEl.textContent = String(data.length);

    requestsPendingListEl.innerHTML = data.map(r => {
      const when =
        r.type === "ferie"
          ? `Dal ${safeFormatDateIT(r.start_date)} al ${safeFormatDateIT(r.end_date)}`
          : (r.time
              ? `${safeFormatDateIT(r.start_date)} • ${String(r.time).slice(0,5)}`
              : `${safeFormatDateIT(r.start_date)}`);

      const statusPill =
        r.status === "approvata"
          ? `<span class="pill ok">Approvata</span>`
          : (r.status === "rifiutata"
              ? `<span class="pill warn" style="border-color: rgba(255,107,107,.35); background: rgba(255,107,107,.12);">Rifiutata</span>`
              : `<span class="pill">Inviata</span>`);

      const noteHtml = r.note ? `<div class="muted" style="margin-top:6px;">${escapeHtml(r.note)}</div>` : "";
      const canDelete = r.status === "inviata";

      const search = `${labelRequestType(r.type)} ${when} ${r.note || ""} ${r.status || ""}`;
      return `
        <div class="acc open" data-search="${escapeHtml(search)}">
          <div class="acc-head" data-acc-toggle>
            <div>
              <div class="acc-title">${escapeHtml(labelRequestType(r.type))}</div>
              <div class="acc-meta">${escapeHtml(when)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              ${statusPill}
              <span class="acc-chev">▾</span>
            </div>
          </div>
          <div class="acc-body">
            ${noteHtml}
            ${canDelete ? `
              <div class="inline-actions" style="margin-top:10px;">
                <button class="btn small" data-edit-request="${r.id}">Modifica</button>
                <button class="btn small danger" data-del-request="${r.id}">Annulla</button>
              </div>
              <div data-request-editor-wrap="${r.id}"></div>
            ` : ""}
          </div>
        </div>
      `;
    }).join("");

    // bind edit
    requestsPendingListEl.querySelectorAll("[data-edit-request]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-edit-request");
        if (!id) return;
        const r = data.find(x => String(x.id) === String(id));
        if (!r) return;

        const wrap = requestsPendingListEl.querySelector(`[data-request-editor-wrap="${String(id)}"]`);
        if (!wrap) return;
        // toggle: se già aperto, chiudi
        if (wrap.querySelector("[data-request-editor]")) {
          wrap.innerHTML = "";
          return;
        }
        wrap.innerHTML = renderRequestEditorHtml(r);
        bindRequestEditor(wrap, r, ym);
      });
    });

    // bind delete
    requestsPendingListEl.querySelectorAll("[data-del-request]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del-request");
        if (!id) return;
        if (!confirm("Vuoi annullare questa richiesta?")) return;

        const { error } = await supabaseClient.from("requests").delete().eq("id", id);
        if (error) {
          console.error(error);
          alert("Errore durante l'annullamento. Controlla console.");
          return;
        }
        await loadRequestsPendingArchive(ym);
      });
    });

  } catch (err) {
    console.error(err);
    requestsPendingListEl.textContent = "Errore imprevisto.";
  }
}

function renderRequestEditorHtml(r) {
  const type = String(r.type || "");
  const note = (r.note || "");
  const time = (r.time ? String(r.time).slice(0,5) : "");

  const dateSingle = `
    <label class="label">Data</label>
    <input class="input" type="date" data-re="start_date" value="${escapeHtml(r.start_date || "")}" />
  `;
  const timeBox = `
    <label class="label">Ora</label>
    <input class="input" type="time" step="300" data-re="time" value="${escapeHtml(time)}" />
  `;
  const range = `
    <div class="grid2">
      <div>
        <label class="label">Da (data inizio)</label>
        <input class="input" type="date" data-re="start_date" value="${escapeHtml(r.start_date || "")}" />
      </div>
      <div>
        <label class="label">A (data fine)</label>
        <input class="input" type="date" data-re="end_date" value="${escapeHtml(r.end_date || "")}" />
      </div>
    </div>
  `;

  let fields = "";
  if (type === "ferie") fields = range;
  else if (type === "permesso_giornaliero") fields = dateSingle;
  else if (type === "uscita_anticipata" || type === "entrata_posticipata") fields = dateSingle + timeBox;
  else fields = `<p class="muted">Tipo non modificabile.</p>`;

  return `
    <div class="inline-editor" data-request-editor="1">
      <div class="muted" style="margin:6px 0 10px;">Modifica richiesta (stato: inviata)</div>
      ${fields}
      <label class="label">Note (opzionale)</label>
      <textarea class="input" rows="3" data-re="note" placeholder="Es. motivo / dettaglio...">${escapeHtml(note)}</textarea>
      <div class="inline-actions" style="margin-top:10px;">
        <button type="button" class="btn small primary" data-re-save>Salva</button>
        <button type="button" class="btn small" data-re-cancel>Annulla</button>
      </div>
      <p class="msg" data-re-msg></p>
    </div>
  `;
}

function bindRequestEditor(wrap, r, ym) {
  const editor = wrap.querySelector("[data-request-editor]");
  if (!editor) return;

  const setM = (t, type="info") => {
    const el = editor.querySelector("[data-re-msg]");
    if (!el) return;
    el.textContent = t || "";
    el.className = `msg ${type}`;
  };

  editor.querySelector("[data-re-cancel]")?.addEventListener("click", () => {
    wrap.innerHTML = "";
  });

  editor.querySelector("[data-re-save]")?.addEventListener("click", async () => {
    const saveBtn = editor.querySelector("[data-re-save]");
    try {
      setM("");
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvo..."; }

      const type = String(r.type || "").trim();
      const start_date = (editor.querySelector('[data-re="start_date"]')?.value || "").trim() || null;
      const end_date = (editor.querySelector('[data-re="end_date"]')?.value || "").trim() || null;
      const time = (editor.querySelector('[data-re="time"]')?.value || "").trim() || null;
      const note = (editor.querySelector('[data-re="note"]')?.value || "").trim() || null;

      const v = validatePendingRequestEdit({ type, start_date, end_date, time });
      if (!v.ok) { setM(v.msg, "error"); return; }

      const { error } = await supabaseClient
        .from("requests")
        .update({ start_date, end_date, time, note })
        .eq("id", r.id);

      if (error) {
        console.error(error);
        setM("Errore salvataggio richiesta. Controlla console e RLS.", "error");
        return;
      }

      setM("Salvato ✅", "ok");
      showToast("Richiesta modificata ✅", "ok");
      await loadRequestsPendingArchive(ym);
      await loadRequestsArchive(ym);
    } catch (err) {
      console.error(err);
      setM("Errore imprevisto. Controlla console.", "error");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Salva"; }
    }
  });
}

async function loadRequestsArchive(ym) {
  if (!requestsArchiveListEl) return;
  requestsArchiveListEl.textContent = "Caricamento...";

  try {
    const user = await getCurrentUser();
    if (!user) {
      requestsArchiveListEl.textContent = "Sessione scaduta.";
      return;
    }

    const month = ym || (monthPicker?.value || getCurrentMonthISO());
    const start = `${month}-01`;
    const endDate = new Date(month + "-01T00:00:00");
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0);
    const end = `${month}-${String(endDate.getDate()).padStart(2, "0")}`;

    const { data, error } = await supabaseClient
      .from("requests")
      .select("id,type,start_date,end_date,time,status,note,created_at")
      .eq("user_id", user.id)
      .in("status", ["approvata", "rifiutata"])
      .gte("start_date", start)
      .lte("start_date", end)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      requestsArchiveListEl.textContent = "Errore caricamento richieste archivio.";
      return;
    }

    if (!data || data.length === 0) {
      requestsArchiveListEl.textContent = "Nessuna richiesta approvata/rifiutata in questo mese.";
      return;
    }

    requestsArchiveListEl.innerHTML = data.map(r => {
      const when =
        r.type === "ferie"
          ? `Dal ${safeFormatDateIT(r.start_date)} al ${safeFormatDateIT(r.end_date)}`
          : (r.time
              ? `${safeFormatDateIT(r.start_date)} • ${String(r.time).slice(0,5)}`
              : `${safeFormatDateIT(r.start_date)}`);

      const statusPill =
        r.status === "approvata"
          ? `<span class="pill ok">Approvata</span>`
          : `<span class="pill warn" style="border-color: rgba(255,107,107,.35); background: rgba(255,107,107,.12);">Rifiutata</span>`;

      const noteHtml = r.note ? `<div class="muted" style="margin-top:6px;">${escapeHtml(r.note)}</div>` : "";

      const search = `${labelRequestType(r.type)} ${when} ${r.note || ""} ${r.status || ""}`;
      return `
        <div class="acc" data-search="${escapeHtml(search)}">
          <div class="acc-head" data-acc-toggle>
            <div>
              <div class="acc-title">${escapeHtml(labelRequestType(r.type))}</div>
              <div class="acc-meta">${escapeHtml(when)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              ${statusPill}
              <span class="acc-chev">▾</span>
            </div>
          </div>
          <div class="acc-body">
            ${noteHtml}
          </div>
        </div>
      `;
    }).join("");

    // Se non ci sono pending, almeno mantieni il badge coerente (pending viene gestito nella sua funzione)
    if (!requestsPendingListEl?.textContent || requestsPendingListEl.textContent.includes("Caricamento")) {
      // noop
    }

  } catch (err) {
    console.error(err);
    requestsArchiveListEl.textContent = "Errore imprevisto.";
  }
}

function escapeHtml(str) {
  // Compatibilità: evita String.prototype.replaceAll (non supportato su alcuni browser)
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const monthPicker = document.getElementById("monthPicker");
const monthTotalEl = document.getElementById("monthTotal");
const todayTotalEl = document.getElementById("todayTotal");
const archiveGroupedEl = document.getElementById("archiveGrouped");

// imposta mese corrente di default
if (monthPicker) monthPicker.value = getCurrentMonthISO();

monthPicker?.addEventListener("change", () => loadArchive());

function updateMonthPickerLabel() {
  if (!monthPicker) return;
  // monthPicker.value è "YYYY-MM"
  const v = monthPicker.value;
  if (!v) {
    if (monthPickerLabelEl) monthPickerLabelEl.textContent = "—";
    if (monthPickerLabelInnerEl) monthPickerLabelInnerEl.textContent = "—";
    return;
  }
  const d = new Date(v + "-01T00:00:00");
  const label = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(d);
  if (monthPickerLabelEl) monthPickerLabelEl.textContent = label;
  if (monthPickerLabelInnerEl) monthPickerLabelInnerEl.textContent = label;
}

monthPicker?.addEventListener("change", () => updateMonthPickerLabel());

// --- Submit ore ---
hoursForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    setMsg("");
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = "Invio...";
    }

    const user = await getCurrentUser();
    if (!user) {
      setMsg("Sessione scaduta. Rifai login.", "error");
      window.location.replace("login.html");
      return;
    }

    const work_date = (workDateEl?.value || "").trim();
    if (!work_date) {
      setMsg("Seleziona la data.", "error");
      return;
    }

    const rows = getHoursRowElements();
    if (!rows || rows.length === 0) {
      setMsg("Aggiungi almeno una riga.", "error");
      return;
    }

    const payloads = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const getV = (field) => (row.querySelector(`[data-field="${field}"]`)?.value || "").trim();

      const v = {
        start_time: getV("start_time"),
        end_time: getV("end_time"),
        break_start: getV("break_start"),
        break_end: getV("break_end"),
        location: getV("location"),
        activity: getV("activity"),
      };

      // riga completamente vuota? la ignoriamo (così puoi lasciarne una extra senza errori)
      if (isEmptyRowValues(v)) continue;

      // Validazioni base riga
      if (!v.start_time || !v.end_time || !v.location || !v.activity) {
        setMsg(`Compila tutti i campi obbligatori nella riga ${i + 1} (oppure rimuovila).`, "error");
        return;
      }
      // Validazione con supporto turni notturni: usa validateWorkLogLike che gestisce la mezzanotte
      const rowValidation = validateWorkLogLike({
        start_time: v.start_time,
        end_time: v.end_time,
        break_start: v.break_start,
        break_end: v.break_end,
      }, `Riga ${i + 1}: `);
      if (!rowValidation.ok) {
        setMsg(rowValidation.msg, "error");
        return;
      }

      payloads.push({
        user_id: user.id,
        work_date,
        start_time: v.start_time,
        end_time: v.end_time,
        break_start: v.break_start || null,
        break_end: v.break_end || null,
        location: v.location,
        activity: v.activity,
      });
    }

    if (payloads.length === 0) {
      setMsg("Compila almeno una riga (orari + luogo + attività).", "error");
      return;
    }

    const { error } = await supabaseClient.from("work_logs").insert(payloads);

    if (error) {
      console.error(error);
      setMsg("Errore invio. Controlla console e RLS.", "error");
      return;
    }

    const totalMin = payloads.reduce((acc, p) => acc + netMinutes(p), 0);
    setMsg(`Inviato ✅ (${payloads.length} righe, totale ${formatHM(totalMin)})`, "ok");
    showToast(`Ore inviate ✅ (${payloads.length})`, "ok");

    // reset
    e.target.reset();
    resetHoursRows();
    if (workDateEl) workDateEl.value = getTodayISO();

  } catch (err) {
    console.error(err);
    setMsg("Errore imprevisto. Controlla console.", "error");
    showToast("Errore invio ore", "error");
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = "Invia";
    }
  }
});

async function loadArchive() {
  archiveGroupedEl.textContent = "Caricamento...";
  monthTotalEl.textContent = "—";
  todayTotalEl.textContent = "—";
  if (requestsArchiveListEl) requestsArchiveListEl.textContent = "Caricamento...";
  if (requestsPendingListEl) requestsPendingListEl.textContent = "Caricamento...";
  if (productsArchiveListEl) productsArchiveListEl.textContent = "Caricamento...";

  try {
    initArchiveCards();
    initArchiveToolbar();

    const user = await getCurrentUser();
    if (!user) {
      archiveGroupedEl.textContent = "Sessione scaduta.";
      return;
    }

    const ym = (monthPicker?.value || getCurrentMonthISO()); // YYYY-MM
    updateMonthPickerLabel();
    const start = `${ym}-01`;
    const endDate = new Date(ym + "-01T00:00:00");
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0);
    const end = `${ym}-${String(endDate.getDate()).padStart(2, "0")}`;

    // carica archivi in parallelo (non blocca l'archivio ore)
    loadRequestsPendingArchive(ym);
    loadRequestsArchive(ym);
    loadProductsArchive(ym);

    const { data, error } = await supabaseClient
      .from("work_logs")
      .select("id,work_date,start_time,end_time,break_start,break_end,location,activity,created_at")
      .eq("user_id", user.id)
      .gte("work_date", start)
      .lte("work_date", end)
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      archiveGroupedEl.textContent = "Errore caricamento archivio.";
      return;
    }

    if (!data || data.length === 0) {
      archiveGroupedEl.textContent = "Nessuna registrazione in questo mese.";
      currentMonthRows = [];
      return;
    }

    currentMonthRows = data;

    // Totali mese + oggi
    const todayISO = getTodayISO();
    let monthMin = 0;
    let todayMin = 0;

    // Raggruppa per giorno
    const grouped = new Map(); // work_date -> { totalMin, rows[] }

    for (const r of data) {
      const nm = netMinutes(r);
      monthMin += nm;
      if (r.work_date === todayISO) todayMin += nm;

      const g = grouped.get(r.work_date) || { totalMin: 0, rows: [] };
      g.totalMin += nm;
      g.rows.push(r);
      grouped.set(r.work_date, g);
    }

    monthTotalEl.textContent = formatHM(monthMin);
    todayTotalEl.textContent = formatHM(todayMin);
    if (archiveCountHoursEl) archiveCountHoursEl.textContent = formatHM(monthMin);

    // Render (accordion per giorno)
    const days = Array.from(grouped.entries()); // già in ordine perché query order desc

    archiveGroupedEl.innerHTML = days.map(([day, info]) => {
      const rowsHtml = info.rows.map(r => `
        <div class="rowItem" data-worklog-id="${escapeHtml(String(r.id))}">
          <div class="rowItemHead">
            <div>
              <div><strong>${r.start_time} - ${r.end_time}</strong> ${r.break_start ? `(pausa ${r.break_start}-${r.break_end})` : ""}</div>
              <div class="muted">${r.location} — ${r.activity}</div>
              <div class="muted">Netto: ${formatHM(netMinutes(r))}</div>
            </div>
            <div class="rowActions">
              <button type="button" class="btn small" data-edit-worklog>Modifica</button>
            </div>
          </div>
        </div>
      `).join("");

      const search = `${formatDateIT(day)} ${info.rows.map(x => `${x.location} ${x.activity}`).join(" ")}`;
      return `
        <div class="acc" data-search="${escapeHtml(search)}">
          <div class="acc-head" data-acc-toggle>
            <div>
              <div class="acc-title">${escapeHtml(formatDateIT(day))}</div>
              <div class="acc-meta">Totale giorno: ${escapeHtml(formatHM(info.totalMin))}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span class="pill">${escapeHtml(formatHM(info.totalMin))}</span>
              <span class="acc-chev">▾</span>
            </div>
          </div>
          <div class="acc-body">${rowsHtml}</div>
        </div>
      `;
    }).join("");

    // dopo render, applica eventuale ricerca/filtri
    applyArchiveSearch();
    // bind edit ore
    bindHoursEditButtons(archiveGroupedEl);

  } catch (err) {
    console.error(err);
    archiveGroupedEl.textContent = "Errore imprevisto.";
  }
}

const exportXlsxBtn = document.getElementById("exportXlsxBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");

exportXlsxBtn?.addEventListener("click", async () => {
  if (!currentMonthRows || currentMonthRows.length === 0) {
    alert("Nessun dato da esportare per il mese selezionato.");
    return;
  }

  try {
    const ym = (monthPicker?.value || "mese");
    const todayISO = getTodayISO();

    // Righe “Dati”
    const columns = ["Data", "Ora inizio", "Ora fine", "Inizio pausa", "Fine pausa", "Luogo", "Attività", "Ore"];

    const dataRows = currentMonthRows.map(r => {
      const oreMin = netMinutes(r);
      return {
        "Data": formatDateIT(r.work_date),
        "Ora inizio": r.start_time,
        "Ora fine": r.end_time,
        "Inizio pausa": r.break_start || "",
        "Fine pausa": r.break_end || "",
        "Luogo": r.location,
        "Attività": r.activity,
        "Ore": formatHM(oreMin),
      };
    });

    // Riepilogo (mese, oggi, per giorno)
    let monthMin = 0, todayMin = 0;
    const byDay = new Map();
    for (const r of currentMonthRows) {
      const m = netMinutes(r);
      monthMin += m;
      if (r.work_date === todayISO) todayMin += m;
      byDay.set(r.work_date, (byDay.get(r.work_date) || 0) + m);
    }

    const summaryRows = [
      { Voce: "Totale mese", Ore: formatHM(monthMin) },
      { Voce: "Totale oggi", Ore: formatHM(todayMin) },
      { Voce: "", Ore: "" },
      ...Array.from(byDay.entries())
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([day, min]) => ({ Voce: `Giorno ${formatDateIT(day)}`, Ore: formatHM(min) }))
    ];

    exportToExcelElegant({
      filename: `CAME_Archivio_${fmtMonthYearFile(ym)}.xlsx`,
      sheetName: `Archivio ${fmtMonthYear(ym)}`,
      title: `CAME – Archivio personale ${fmtMonthYear(ym)}`,
      columns,
      rows: dataRows,
      summary: { title: `Riepilogo ${fmtMonthYear(ym)}`, rows: summaryRows }
    });
    showToast("Download Excel avviato 📄", "ok");
  } catch (e) {
    console.error(e);
    alert(
      "Export Excel non riuscito.\n" +
      "Possibili cause:\n" +
      "- libreria XLSX non caricata (connessione / CDN)\n" +
      "- su smartphone: apri l'app da un indirizzo http (non file)\n\n" +
      "Dettaglio: " + (e?.message || e)
    );
  }
});

exportPdfBtn?.addEventListener("click", async () => {
  if (!currentMonthRows || currentMonthRows.length === 0) {
    alert("Nessun dato da esportare per il mese selezionato.");
    return;
  }

  try {
    const ym = (monthPicker?.value || "mese");
    const todayISO = getTodayISO();

    // calcoli riepilogo
    let monthMin = 0;
    let todayMin = 0;
    const byDay = new Map(); // YYYY-MM-DD -> minuti

    for (const r of currentMonthRows) {
      const m = netMinutes(r);
      monthMin += m;
      if (r.work_date === todayISO) todayMin += m;
      byDay.set(r.work_date, (byDay.get(r.work_date) || 0) + m);
    }

    // righe dettaglio
    const detailColumns = ["Data", "Inizio", "Fine", "Pausa", "Luogo", "Attività", "Ore"];
    const detailRows = currentMonthRows.map(r => {
      const pausa = (r.break_start && r.break_end) ? `${r.break_start}-${r.break_end}` : "";
      return [
        formatDateIT(r.work_date),
        r.start_time,
        r.end_time,
        pausa,
        r.location,
        r.activity,
        formatHM(netMinutes(r)),
      ];
    });

    // righe riepilogo per giorno (ordinate per data crescente)
    const dayRows = Array.from(byDay.entries())
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([day, min]) => [formatDateIT(day), formatHM(min)]);

    // crea PDF con più tabelle
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("Libreria PDF non caricata.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    if (typeof doc.autoTable !== "function") throw new Error("Plugin PDF (autoTable) non caricato.");

    doc.setFontSize(14);
    doc.text(`CAME – Archivio personale ${fmtMonthYear(ym)}`, 40, 40);

    doc.setFontSize(11);
    doc.text(`Totale mese: ${formatHM(monthMin)}    •    Totale oggi: ${formatHM(todayMin)}`, 40, 62);

    // Tabella dettaglio
    doc.autoTable({
      startY: 80,
      head: [detailColumns],
      body: detailRows,
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [15, 26, 46] },
      theme: "grid",
      margin: { left: 40, right: 40 },
    });

    // Tabella riepilogo giornaliero
    const afterDetailY = doc.lastAutoTable.finalY + 18;
    doc.setFontSize(12);
    doc.text("Riepilogo giornaliero", 40, afterDetailY);

    doc.autoTable({
      startY: afterDetailY + 10,
      head: [["Giorno", "Ore"]],
      body: dayRows,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [15, 26, 46] },
      theme: "grid",
      margin: { left: 40, right: 40 },
    });

    // Download robusto (mobile)
    const blob = doc.output("blob");
    downloadBlob(blob, `CAME_Archivio_${ym}.pdf`);
    showToast("Download PDF avviato 📄", "ok");
  } catch (e) {
    console.error(e);
    alert(
      "Export PDF non riuscito.\n" +
      "Possibili cause:\n" +
      "- librerie PDF non caricate (connessione / CDN)\n" +
      "- su smartphone: apri l'app da un indirizzo http (non file)\n\n" +
      "Dettaglio: " + (e?.message || e)
    );
  }
});

// (niente init: gestito sopra)
