// js/notifications.js — Campanella notifiche in-app (condivisa dipendente/admin).
// Legge dalla tabella `notifications` (RLS: ognuno vede solo le proprie).
// Difensivo: se la tabella non esiste ancora o la query fallisce, la campanella
// resta nascosta e non rompe nulla nel resto dell'app.
(function () {
  "use strict";

  const client = window.supabaseClient;
  const getUser = window.getCurrentUser;
  if (!client || typeof getUser !== "function") return;

  let rootEl, bellEl, badgeEl, panelEl, listEl;
  let items = [];
  let pollTimer = null;
  let building = false;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // "adesso" / "5 min fa" / "3 h fa" / "2 g fa" / data breve
  function timeAgo(iso) {
    try {
      const d = new Date(iso);
      const sec = Math.floor((Date.now() - d.getTime()) / 1000);
      if (sec < 60) return "adesso";
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min} min fa`;
      const h = Math.floor(min / 60);
      if (h < 24) return `${h} h fa`;
      const g = Math.floor(h / 24);
      if (g < 7) return `${g} g fa`;
      return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit" }).format(d);
    } catch (_) { return ""; }
  }

  function buildUi() {
    if (building) return;
    const actions = document.querySelector(".topbar .topbar-actions");
    if (!actions) return;
    building = true;

    rootEl = document.createElement("div");
    rootEl.className = "notif";
    rootEl.hidden = true; // mostrato solo dopo un primo fetch riuscito
    rootEl.innerHTML =
      `<button class="notif-bell" type="button" aria-label="Notifiche" aria-expanded="false">` +
        `<span class="notif-ico" aria-hidden="true">🔔</span>` +
        `<span class="notif-badge" hidden>0</span>` +
      `</button>` +
      `<div class="notif-panel" hidden>` +
        `<div class="notif-head"><strong>Notifiche</strong>` +
          `<button class="notif-mark" type="button">Segna tutte lette</button></div>` +
        `<div class="notif-list"></div>` +
      `</div>`;

    // inserisci la campanella come primo elemento delle azioni (a sinistra del Logout)
    actions.insertBefore(rootEl, actions.firstChild);

    bellEl = rootEl.querySelector(".notif-bell");
    badgeEl = rootEl.querySelector(".notif-badge");
    panelEl = rootEl.querySelector(".notif-panel");
    listEl = rootEl.querySelector(".notif-list");

    bellEl.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
    rootEl.querySelector(".notif-mark").addEventListener("click", (e) => { e.stopPropagation(); markAllRead(); });

    // click / invio su una voce -> naviga
    listEl.addEventListener("click", (e) => {
      const item = e.target.closest?.(".notif-item");
      if (item) openNotif(item.getAttribute("data-id"));
    });
    listEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const item = e.target.closest?.(".notif-item");
      if (item) { e.preventDefault(); openNotif(item.getAttribute("data-id")); }
    });

    // click fuori => chiudi
    document.addEventListener("click", (e) => {
      if (!panelEl || panelEl.hidden) return;
      if (!rootEl.contains(e.target)) closePanel();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });
  }

  function unreadCount() { return items.filter(n => !n.read_at).length; }

  function renderBadge() {
    if (!badgeEl) return;
    const n = unreadCount();
    if (n > 0) { badgeEl.textContent = n > 99 ? "99+" : String(n); badgeEl.hidden = false; }
    else badgeEl.hidden = true;
  }

  function renderList() {
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = `<div class="notif-empty">Nessuna notifica</div>`;
      return;
    }
    listEl.innerHTML = items.map(n => {
      const unread = !n.read_at ? " unread" : "";
      const body = n.body ? `<div class="notif-body">${escapeHtml(n.body)}</div>` : "";
      return `<div class="notif-item${unread}" data-id="${escapeHtml(String(n.id))}" role="button" tabindex="0">` +
        `<div class="notif-title">${escapeHtml(n.title || "")}</div>` +
        body +
        `<div class="notif-time">${escapeHtml(timeAgo(n.created_at))}</div>` +
      `</div>`;
    }).join("");
  }

  // Click su una notifica -> vai alla pagina di riferimento (router fornito dalla pagina)
  function openNotif(id) {
    const n = items.find(x => String(x.id) === String(id));
    closePanel();
    if (!n) return;
    try {
      if (typeof window.CameNotifRouter === "function") window.CameNotifRouter(n);
    } catch (_) { /* navigazione non disponibile: ignora */ }
  }

  async function fetchItems() {
    try {
      const { data, error } = await client
        .from("notifications")
        .select("id,type,title,body,created_at,read_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;

      items = data || [];
      if (rootEl) rootEl.hidden = false; // la tabella risponde: mostra la campanella
      renderBadge();
      if (panelEl && !panelEl.hidden) renderList();
    } catch (_) {
      // tabella assente o query fallita: tieni la campanella nascosta, nessun errore visibile
      if (rootEl) rootEl.hidden = true;
    }
  }

  async function markAllRead() {
    const unread = items.filter(n => !n.read_at);
    if (!unread.length) return;
    // aggiorna subito la UI (ottimistico)
    const nowIso = new Date().toISOString();
    unread.forEach(n => { n.read_at = nowIso; });
    renderBadge();
    renderList();
    try {
      await client.from("notifications").update({ read_at: nowIso }).is("read_at", null);
    } catch (_) { /* al prossimo fetch si riallinea */ }
  }

  function openPanel() {
    if (!panelEl) return;
    renderList();
    panelEl.hidden = false;
    bellEl.setAttribute("aria-expanded", "true");
    // aprire = prendere visione: segna come lette
    markAllRead();
  }
  function closePanel() {
    if (!panelEl || panelEl.hidden) return;
    panelEl.hidden = true;
    bellEl.setAttribute("aria-expanded", "false");
  }
  function togglePanel() { if (panelEl && panelEl.hidden) openPanel(); else closePanel(); }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") fetchItems();
    }, 60000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") fetchItems();
    });
  }

  // Piccola animazione della campanella all'arrivo di una notifica
  function pulseBell() {
    if (!bellEl) return;
    bellEl.classList.remove("ring");
    // reflow per riavviare l'animazione anche a colpi ravvicinati
    void bellEl.offsetWidth;
    bellEl.classList.add("ring");
    setTimeout(() => bellEl && bellEl.classList.remove("ring"), 1400);
  }

  // Nuova notifica ricevuta in tempo reale (senza ricaricare la pagina)
  function onRealtimeInsert(row) {
    if (!row || !row.id) return;
    if (items.some(n => String(n.id) === String(row.id))) return; // già presente
    items.unshift(row);
    if (rootEl) rootEl.hidden = false;
    if (panelEl && !panelEl.hidden) {
      // il pannello è aperto: l'utente la sta vedendo -> considerala letta
      renderList();
      markAllRead();
    } else {
      renderBadge();
      pulseBell();
    }
  }

  function startRealtime(user) {
    try {
      client
        .channel("notif_" + user.id)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: "recipient_id=eq." + user.id },
          (payload) => onRealtimeInsert(payload.new)
        )
        .subscribe();
    } catch (_) {
      // realtime non disponibile: resta il polling ogni 60s
    }
  }

  async function init() {
    const user = await getUser();
    if (!user) return; // non loggato: niente campanella
    buildUi();
    if (!rootEl) return;
    await fetchItems();
    startPolling();
    startRealtime(user);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
