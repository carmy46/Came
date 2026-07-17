// js/export.js (NO MODULE) - Excel elegante + PDF helper

function safeFilename(name) {
  const raw = String(name || "export").trim() || "export";
  const lastDot = raw.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < raw.length - 1;

  const base = hasExt ? raw.slice(0, lastDot) : raw;
  const ext = hasExt ? raw.slice(lastDot + 1) : "";

  const clean = (s) => String(s || "")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const cleanBase = clean(base) || "export";
  const cleanExt = clean(ext);
  return cleanExt ? `${cleanBase}.${cleanExt}` : cleanBase;
}

function downloadBlob(blob, filename) {
  const safe = safeFilename(filename);
  const url = URL.createObjectURL(blob);

  // iOS/Safari e alcuni browser mobile non rispettano sempre "download".
  // Fallback: apri il blob URL in nuova scheda (l’utente poi può condividere/salvare).
  const ua = navigator.userAgent || "";
  const isIOS = /iP(ad|hone|od)/.test(ua);

  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = safe;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // se iOS, spesso l'azione migliore è aprire direttamente
    if (isIOS) {
      try { window.open(url, "_blank", "noopener"); } catch (_) {}
    }
  } catch (e) {
    // ultimo fallback
    try { window.open(url, "_blank", "noopener"); } catch (_) { window.location.href = url; }
  }

  // Non revocare subito: su mobile serve tempo per completare l'apertura/download
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function formatDateIT(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return String(dateStr);
  return new Intl.DateTimeFormat("it-IT").format(d); // dd/mm/yyyy
}

function formatHM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function safeSheetName(name) {
  // Excel constraints:
  // - max 31 chars
  // - cannot contain: : \ / ? * [ ]
  // - cannot be empty
  let s = String(name || "").trim();
  s = s.replace(/[:\\\/\?\*\[\]]/g, "-"); // replace forbidden chars
  s = s.replace(/\s+/g, " ").trim();
  if (!s) s = "Dati";
  if (s.length > 31) s = s.slice(0, 31);
  // avoid trailing/leading apostrophe issues
  s = s.replace(/^'+|'+$/g, "");
  if (!s) s = "Dati";
  return s;
}

function minutesBetween(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function netMinutes(log) {
  let total = minutesBetween(log.start_time, log.end_time);
  if (log.break_start && log.break_end) total -= minutesBetween(log.break_start, log.break_end);
  return Math.max(0, total);
}

// ---------- EXCEL ELEGANTE ----------
function setRangeStyle(ws, range, style) {
  const XLSX = window.XLSX;
  const { s: start, e: end } = XLSX.utils.decode_range(range);

  for (let r = start.r; r <= end.r; r++) {
    for (let c = start.c; c <= end.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) continue;
      ws[addr].s = { ...(ws[addr].s || {}), ...style };
    }
  }
}

function autoFitColumns(ws, data, minW = 10, maxW = 45) {
  // data = array di array (righe) oppure array di oggetti
  const XLSX = window.XLSX;
  const rows = Array.isArray(data[0]) ? data : [
    Object.keys(data[0] || {}),
    ...data.map(o => Object.values(o))
  ];

  const colCount = rows[0]?.length || 0;
  const widths = Array.from({ length: colCount }, () => minW);

  for (const row of rows) {
    row.forEach((v, i) => {
      const str = (v === null || v === undefined) ? "" : String(v);
      widths[i] = Math.max(widths[i], Math.min(maxW, str.length + 2));
    });
  }

  ws["!cols"] = widths.map(wch => ({ wch }));
}

function addTitleRow(ws, title, colCount) {
  const XLSX = window.XLSX;

  // Inserisco riga titolo in A1 e sposto tutto giù di 1 riga
  XLSX.utils.sheet_add_aoa(ws, [[title]], { origin: "A1" });

  // Merge titolo su tutte le colonne
  ws["!merges"] = ws["!merges"] || [];
  ws["!merges"].push({
    s: { r: 0, c: 0 },
    e: { r: 0, c: Math.max(0, colCount - 1) }
  });

  // Stile titolo
  const titleCell = ws["A1"];
  if (titleCell) {
    titleCell.s = {
      font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } },
      alignment: { vertical: "center", horizontal: "center" },
      fill: { fgColor: { rgb: "0F1A2E" } },
    };
  }

  // Riga "Generato il" in A2 (sposteremo poi header a riga 3)
  const generated = new Date();
  const genStr = new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(generated);

  XLSX.utils.sheet_add_aoa(ws, [[`Generato il: ${genStr}`]], { origin: "A2" });

  ws["!merges"] = ws["!merges"] || [];
  ws["!merges"].push({
    s: { r: 1, c: 0 },
    e: { r: 1, c: Math.max(0, colCount - 1) }
  });

  const genCell = ws["A2"];
  if (genCell) {
    genCell.s = {
      font: { italic: true, sz: 10, color: { rgb: "9FB0D0" } },
      alignment: { vertical: "center", horizontal: "center" },
      fill: { fgColor: { rgb: "0B1730" } },
    };
  }

  // Altezza riga titolo
  ws["!rows"] = ws["!rows"] || [];
  ws["!rows"][0] = { hpt: 26 };
  ws["!rows"][1] = { hpt: 18 };
}

function exportToExcelElegant({
  filename = "export.xlsx",
  sheetName = "Dati",
  title = "CAME",
  columns = [],           // array di header in ordine
  rows = [],              // array di oggetti (chiavi = columns) oppure array di array
  summary = null,         // opzionale: { title: "...", rows: [{...}] } crea foglio riepilogo
  mergeColumns = []       // opzionale: colonne dove unire verticalmente righe consecutive con lo stesso valore
}) {
  if (!window.XLSX) throw new Error("XLSX non disponibile (CDN non caricato).");

  const XLSX = window.XLSX;
  const safeMainSheetName = safeSheetName(sheetName || "Dati");

  // Normalizza dati in array di oggetti con chiavi = columns
  let dataObjects;
  if (rows.length === 0) dataObjects = [];
  else if (Array.isArray(rows[0])) {
    // rows array di array => converti in oggetti usando columns
    dataObjects = rows.map(arr => {
      const o = {};
      columns.forEach((k, i) => (o[k] = arr[i] ?? ""));
      return o;
    });
  } else {
    dataObjects = rows;
  }

  const wb = XLSX.utils.book_new();

  // Crea sheet dai dati a partire da A3 (A1 titolo, A2 "Generato il")
  const ws = XLSX.utils.json_to_sheet(dataObjects, { header: columns, origin: "A3" });

  // Titolo
  addTitleRow(ws, title, columns.length);

  // Header range (riga 3)
  const headerRange = XLSX.utils.encode_range({
    s: { r: 2, c: 0 },
    e: { r: 2, c: columns.length - 1 }
  });

  // Stile header
  setRangeStyle(ws, headerRange, {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    alignment: { horizontal: "center", vertical: "center" },
    fill: { fgColor: { rgb: "1A2F55" } },
    border: {
      top: { style: "thin", color: { rgb: "334155" } },
      bottom: { style: "thin", color: { rgb: "334155" } },
      left: { style: "thin", color: { rgb: "334155" } },
      right: { style: "thin", color: { rgb: "334155" } },
    },
  });

  // Zebra + bordi per il corpo (da riga 4 in poi)
  const bodyStartRow = 3; // 0-based: 0 titolo, 1 gen, 2 header, 3 prima riga dati
  const lastRow = bodyStartRow + Math.max(0, dataObjects.length - 1);
  const bodyRange = XLSX.utils.encode_range({
    s: { r: bodyStartRow, c: 0 },
    e: { r: Math.max(bodyStartRow, lastRow), c: columns.length - 1 }
  });

  // Applica bordi a tutto il corpo
  setRangeStyle(ws, bodyRange, {
    alignment: { vertical: "top", wrapText: true },
    border: {
      top: { style: "thin", color: { rgb: "334155" } },
      bottom: { style: "thin", color: { rgb: "334155" } },
      left: { style: "thin", color: { rgb: "334155" } },
      right: { style: "thin", color: { rgb: "334155" } },
    },
  });

  // Centra la colonna "Ore" se esiste
  const oreIndex = columns.indexOf("Ore");
  if (oreIndex >= 0) {
    const XLSX = window.XLSX;
    for (let r = bodyStartRow; r <= lastRow; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: oreIndex });
      if (ws[addr]) {
        ws[addr].s = ws[addr].s || {};
        ws[addr].s.alignment = { ...(ws[addr].s.alignment || {}), horizontal: "center" };
      }
    }
  }

  // Zebra: coloro righe pari con un azzurro chiarissimo (leggibile su testo scuro)
  for (let r = bodyStartRow; r <= lastRow; r++) {
    const isEven = ((r - bodyStartRow) % 2 === 1);
    if (!isEven) continue;
    const rowRange = XLSX.utils.encode_range({
      s: { r, c: 0 },
      e: { r, c: columns.length - 1 }
    });
    setRangeStyle(ws, rowRange, {
      fill: { fgColor: { rgb: "F4F7FC" } },
    });
  }

  // Auto-fit colonne
  autoFitColumns(ws, [columns, ...dataObjects.map(o => columns.map(k => o[k]))], 10, 48);

  // Unisci verticalmente le righe consecutive con lo stesso valore (es. stesso
  // dipendente su più righe prodotto): il nome compare una sola volta invece
  // di ripetersi a ogni riga.
  for (const colName of mergeColumns) {
    const colIndex = columns.indexOf(colName);
    if (colIndex < 0) continue;

    let runStart = 0;
    while (runStart < dataObjects.length) {
      const value = dataObjects[runStart][colName];
      let runEnd = runStart;
      while (runEnd + 1 < dataObjects.length && dataObjects[runEnd + 1][colName] === value) runEnd++;

      if (runEnd > runStart) {
        const rStart = bodyStartRow + runStart;
        const rEnd = bodyStartRow + runEnd;
        ws["!merges"] = ws["!merges"] || [];
        ws["!merges"].push({ s: { r: rStart, c: colIndex }, e: { r: rEnd, c: colIndex } });

        // svuota le celle successive alla prima (il merge le nasconde comunque,
        // ma così anche i lettori che non supportano i merge non ripetono il testo)
        for (let r = runStart + 1; r <= runEnd; r++) {
          const addr = XLSX.utils.encode_cell({ r: bodyStartRow + r, c: colIndex });
          if (ws[addr]) ws[addr].v = "";
        }

        const anchorAddr = XLSX.utils.encode_cell({ r: rStart, c: colIndex });
        if (ws[anchorAddr]) {
          ws[anchorAddr].s = { ...(ws[anchorAddr].s || {}), alignment: { ...(ws[anchorAddr].s?.alignment || {}), vertical: "center" } };
        }
      }

      runStart = runEnd + 1;
    }
  }

  // Filtro su header (riga 3)
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2, c: columns.length - 1 } })
  };

  // Freeze: titolo + "Generato il" + header
  ws["!freeze"] = { xSplit: 0, ySplit: 3 };

  XLSX.utils.book_append_sheet(wb, ws, safeMainSheetName);

  // Foglio riepilogo opzionale
  if (summary && summary.rows && summary.rows.length) {
    const sumCols = Object.keys(summary.rows[0]);
    const ws2 = XLSX.utils.json_to_sheet(summary.rows, { header: sumCols, origin: "A3" });
    addTitleRow(ws2, summary.title || "Riepilogo", sumCols.length);

    const headerRange2 = XLSX.utils.encode_range({
      s: { r: 2, c: 0 }, e: { r: 2, c: sumCols.length - 1 }
    });
    setRangeStyle(ws2, headerRange2, {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "center", vertical: "center" },
      fill: { fgColor: { rgb: "1A2F55" } },
      border: {
        top: { style: "thin", color: { rgb: "334155" } },
        bottom: { style: "thin", color: { rgb: "334155" } },
        left: { style: "thin", color: { rgb: "334155" } },
        right: { style: "thin", color: { rgb: "334155" } },
      },
    });

    autoFitColumns(ws2, [sumCols, ...summary.rows.map(o => sumCols.map(k => o[k]))], 10, 48);
    ws2["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2, c: sumCols.length - 1 } }) };
    ws2["!freeze"] = { xSplit: 0, ySplit: 3 };

    // evita nomi non validi anche qui (e il limite 31 char)
    XLSX.utils.book_append_sheet(wb, ws2, safeSheetName("Riepilogo"));
  }

  // Metodo più compatibile su browser desktop: writeFile() (trigger download diretto)
  if (typeof XLSX.writeFile === "function") {
    XLSX.writeFile(wb, safeFilename(filename), { bookType: "xlsx", cellStyles: true });
    return;
  }

  // Fallback: blob download
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  downloadBlob(blob, safeFilename(filename));
}

// ---------- MULTI-SHEET: un foglio per ogni dipendente ----------
function exportToExcelMultiSheet({ filename = "export.xlsx", sheets = [] }) {
  if (!window.XLSX) throw new Error("XLSX non disponibile (CDN non caricato).");

  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const { sheetName = "Dati", title = "CAME", columns = [], rows = [] } = sheet;

    let dataObjects;
    if (rows.length === 0) dataObjects = [];
    else if (Array.isArray(rows[0])) {
      dataObjects = rows.map(arr => {
        const o = {};
        columns.forEach((k, i) => (o[k] = arr[i] ?? ""));
        return o;
      });
    } else {
      dataObjects = rows;
    }

    const ws = XLSX.utils.json_to_sheet(dataObjects, { header: columns, origin: "A3" });
    addTitleRow(ws, title, columns.length);

    const headerRange = XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2, c: columns.length - 1 } });
    setRangeStyle(ws, headerRange, {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "center", vertical: "center" },
      fill: { fgColor: { rgb: "1A2F55" } },
      border: {
        top: { style: "thin", color: { rgb: "334155" } },
        bottom: { style: "thin", color: { rgb: "334155" } },
        left: { style: "thin", color: { rgb: "334155" } },
        right: { style: "thin", color: { rgb: "334155" } },
      },
    });

    const bodyStartRow = 3;
    const lastRow = bodyStartRow + Math.max(0, dataObjects.length - 1);
    const bodyRange = XLSX.utils.encode_range({
      s: { r: bodyStartRow, c: 0 },
      e: { r: Math.max(bodyStartRow, lastRow), c: columns.length - 1 }
    });
    setRangeStyle(ws, bodyRange, {
      alignment: { vertical: "top", wrapText: true },
      border: {
        top: { style: "thin", color: { rgb: "334155" } },
        bottom: { style: "thin", color: { rgb: "334155" } },
        left: { style: "thin", color: { rgb: "334155" } },
        right: { style: "thin", color: { rgb: "334155" } },
      },
    });

    for (let r = bodyStartRow; r <= lastRow; r++) {
      if ((r - bodyStartRow) % 2 !== 1) continue;
      const rowRange = XLSX.utils.encode_range({ s: { r, c: 0 }, e: { r, c: columns.length - 1 } });
      setRangeStyle(ws, rowRange, { fill: { fgColor: { rgb: "F4F7FC" } } });
    }

    autoFitColumns(ws, [columns, ...dataObjects.map(o => columns.map(k => o[k]))], 10, 48);
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2, c: columns.length - 1 } }) };
    ws["!freeze"] = { xSplit: 0, ySplit: 3 };

    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sheetName));
  }

  if (typeof XLSX.writeFile === "function") {
    XLSX.writeFile(wb, safeFilename(filename), { bookType: "xlsx", cellStyles: true });
    return;
  }

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  downloadBlob(blob, safeFilename(filename));
}

// Compatibilità: il progetto attuale usa exportToExcel({ rows, filename, sheetName })
function exportToExcel({ rows, filename = "export.xlsx", sheetName = "Dati", title = "" }) {
  const columns = rows && rows.length ? Object.keys(rows[0]) : [];
  exportToExcelElegant({
    filename,
    sheetName,
    title: title || sheetName || "CAME",
    columns,
    rows,
  });
}

// ---------- PDF helper (come già usavi) ----------
function exportToPdfTable({ columns, rows, filename = "export.pdf", title = "" }) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("jsPDF non disponibile (CDN non caricato).");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

  if (title) {
    doc.setFontSize(14);
    doc.text(title, 40, 40);
  }

  const startY = title ? 60 : 40;

  doc.autoTable({
    startY,
    head: [columns],
    body: rows,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [15, 26, 46] },
    theme: "grid",
    margin: { left: 40, right: 40 },
  });

  // Salvataggio robusto (mobile friendly)
  const blob = doc.output("blob");
  downloadBlob(blob, safeFilename(filename));
}

// =====================================================================
// REPORT CONSUMI PRODOTTI (Excel elegante, multi-foglio)
// Tema chiaro professionale: banda titolo scura, intestazioni navy,
// righe alternate azzurro chiarissimo, riga/colonna Totale in risalto,
// zeri lasciati vuoti per ridurre il "rumore" visivo.
// =====================================================================

// Palette (RGB senza #) usata solo qui, per non toccare gli altri export.
const XLC = {
  ink:     "1F2937", // testo scuro
  titleBg: "0F1A2E", titleFg: "FFFFFF",
  subBg:   "F1F5FB", subFg: "475569",
  headBg:  "1A2F55", headFg: "FFFFFF",
  zebra:   "F4F7FC",
  totBg:   "DCE6F5", totFg: "0F1A2E",
  border:  "CBD5E1",
};

function xlcBorderAll(color) {
  const b = { style: "thin", color: { rgb: color || XLC.border } };
  return { top: b, bottom: b, left: b, right: b };
}

function xlcGeneratedString() {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date());
}

// Costruisce un foglio "a matrice" già stilizzato e lo aggiunge al workbook.
// header: array intestazioni. dataRows: array di righe (array). Le celle numeriche
// vengono riconosciute da typeof === "number"; le celle "" restano vuote (ma con bordo).
function xlcBuildMatrixSheet(wb, {
  sheetName,
  title,
  subtitle = "",
  header = [],
  dataRows = [],
  totalsRow = null,          // array stessa lunghezza di header, oppure null
  numberCols = [],           // indici colonna da formattare come numero + centrare
  freezeCols = 1,            // quante colonne congelare a sinistra
  autofilter = false,
}) {
  const XLSX = window.XLSX;
  const nCols = header.length;
  const numberSet = new Set(numberCols);

  // Costruisco l'intero foglio da A1 (riga 0 = titolo, riga 1 = sottotitolo,
  // riga 2 = intestazioni, poi i dati). Così non dipendo dall'opzione "origin"
  // di aoa_to_sheet: le celle vuote "" restano vuote ma esistono (per i bordi).
  const aoa = [];
  aoa.push([title]);
  aoa.push([subtitle || `Generato il ${xlcGeneratedString()}`]);
  aoa.push(header);
  for (const row of dataRows) aoa.push(row);
  if (totalsRow) aoa.push(totalsRow);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Titolo e sottotitolo uniti su tutte le colonne
  ws["!merges"] = ws["!merges"] || [];
  ws["!merges"].push({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, nCols - 1) } });
  ws["!merges"].push({ s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, nCols - 1) } });

  const setStyle = (r, c, style) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (!ws[addr]) ws[addr] = { t: "s", v: "" };
    ws[addr].s = { ...(ws[addr].s || {}), ...style };
    return ws[addr];
  };

  // Titolo
  setStyle(0, 0, {
    font: { bold: true, sz: 15, color: { rgb: XLC.titleFg } },
    alignment: { vertical: "center", horizontal: "left", indent: 1 },
    fill: { fgColor: { rgb: XLC.titleBg } },
  });
  // Sottotitolo
  setStyle(1, 0, {
    font: { italic: true, sz: 10, color: { rgb: XLC.subFg } },
    alignment: { vertical: "center", horizontal: "left", indent: 1 },
    fill: { fgColor: { rgb: XLC.subBg } },
  });

  const headerRow = 2;
  const firstData = 3;
  const lastData = firstData + dataRows.length - 1;
  const totRow = totalsRow ? lastData + 1 : -1;

  // Intestazioni
  for (let c = 0; c < nCols; c++) {
    setStyle(headerRow, c, {
      font: { bold: true, color: { rgb: XLC.headFg } },
      alignment: { horizontal: c === 0 ? "left" : "center", vertical: "center", wrapText: true, indent: c === 0 ? 1 : 0 },
      fill: { fgColor: { rgb: XLC.headBg } },
      border: xlcBorderAll(XLC.headBg),
    });
  }

  // Corpo
  for (let i = 0; i < dataRows.length; i++) {
    const r = firstData + i;
    const zebra = (i % 2 === 1);
    for (let c = 0; c < nCols; c++) {
      const isNum = numberSet.has(c);
      const cell = setStyle(r, c, {
        font: { color: { rgb: XLC.ink }, bold: c === 0 },
        alignment: { horizontal: c === 0 ? "left" : (isNum ? "center" : "left"), vertical: "center", indent: c === 0 ? 1 : 0 },
        fill: { fgColor: { rgb: zebra ? XLC.zebra : "FFFFFF" } },
        border: xlcBorderAll(),
      });
      if (isNum && typeof cell.v === "number") { cell.z = "#,##0"; cell.t = "n"; }
    }
  }

  // Riga Totale
  if (totRow >= 0) {
    for (let c = 0; c < nCols; c++) {
      const isNum = numberSet.has(c);
      const cell = setStyle(totRow, c, {
        font: { bold: true, color: { rgb: XLC.totFg } },
        alignment: { horizontal: c === 0 ? "left" : (isNum ? "center" : "left"), vertical: "center", indent: c === 0 ? 1 : 0 },
        fill: { fgColor: { rgb: XLC.totBg } },
        border: {
          top: { style: "medium", color: { rgb: XLC.headBg } },
          bottom: { style: "thin", color: { rgb: XLC.border } },
          left: { style: "thin", color: { rgb: XLC.border } },
          right: { style: "thin", color: { rgb: XLC.border } },
        },
      });
      if (isNum && typeof cell.v === "number") { cell.z = "#,##0"; cell.t = "n"; }
    }
  }

  // Larghezze colonne: prima colonna larga, colonne numeriche strette
  const widths = header.map((h, c) => {
    if (c === 0) {
      let w = 16;
      for (const row of dataRows) w = Math.max(w, String(row[0] ?? "").length + 3);
      return { wch: Math.min(38, w) };
    }
    return { wch: Math.max(7, Math.min(14, String(h).length + 3)) };
  });
  ws["!cols"] = widths;

  // Altezze righe titolo/sottotitolo
  ws["!rows"] = ws["!rows"] || [];
  ws["!rows"][0] = { hpt: 24 };
  ws["!rows"][1] = { hpt: 16 };

  // Nota: il "blocca riquadri" (freeze pane) non è supportato in scrittura da
  // xlsx-js-style, quindi non lo impostiamo (verrebbe ignorato).

  if (autofilter) {
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow, c: nCols - 1 } }) };
  }

  XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sheetName));
  return ws;
}

// API principale: costruisce e scarica il report consumi.
// summaryPlaces: [{ place, pieces, products, topProduct }]
// placeSheets:   [{ place, header:[...], productRows:[[name, ...months, total]], totalsRow:[...] }]
function exportConsumptionReport({ filename, title, subtitle, summaryHeader, summaryRows, summaryTotalsRow, placeSheets = [] }) {
  if (!window.XLSX) throw new Error("XLSX non disponibile (CDN non caricato).");
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();

  // Foglio 1: Riepilogo (classifica luoghi)
  xlcBuildMatrixSheet(wb, {
    sheetName: "Riepilogo",
    title,
    subtitle,
    header: summaryHeader,
    dataRows: summaryRows,
    totalsRow: summaryTotalsRow,
    numberCols: [1, 2],
    freezeCols: 1,
    autofilter: true,
  });

  // Un foglio per luogo (prodotti x mesi)
  const monthCols = [];
  for (let c = 1; c <= 13; c++) monthCols.push(c); // Gen..Dic (1..12) + Totale (13)

  // Nomi foglio unici: Excel tronca a 31 caratteri, quindi due luoghi con nome
  // lungo simile potrebbero collidere e far fallire l'intero file. De-duplico.
  const usedNames = new Set(["riepilogo"]);
  const uniqueSheetName = (name) => {
    let base = safeSheetName(name);
    let candidate = base, i = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      const suffix = ` (${i})`;
      candidate = safeSheetName(base.slice(0, 31 - suffix.length) + suffix);
      i++;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  };

  for (const p of placeSheets) {
    xlcBuildMatrixSheet(wb, {
      sheetName: uniqueSheetName(p.place),
      title: p.title,
      subtitle: p.subtitle,
      header: p.header,
      dataRows: p.productRows,
      totalsRow: p.totalsRow,
      numberCols: monthCols,
      freezeCols: 1,
      autofilter: false,
    });
  }

  if (typeof XLSX.writeFile === "function") {
    XLSX.writeFile(wb, safeFilename(filename), { bookType: "xlsx", cellStyles: true });
    return;
  }
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  downloadBlob(blob, safeFilename(filename));
}

