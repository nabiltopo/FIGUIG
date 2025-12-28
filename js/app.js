(() => {
  // Fullscreen
  let map = null; // Leaflet map (initialized later)
  const btnFullscreen = document.getElementById("btnFullscreen");
  function isFullscreen(){
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  async function toggleFullscreen(){
    try{
      if (!isFullscreen()){
        if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        else if (document.documentElement.webkitRequestFullscreen) await document.documentElement.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      }
      setTimeout(() => { if (map) map.invalidateSize(); if (legendChart) legendChart.resize(); }, 180);
    } catch(e){
      console.warn("Fullscreen not available:", e);
      alert("Mode plein écran indisponible sur ce navigateur / contexte.");
    }
  }
  if (btnFullscreen) btnFullscreen.addEventListener("click", toggleFullscreen);
  if (document) document.addEventListener("fullscreenchange", () => {
    if (!btnFullscreen) return;
    btnFullscreen.textContent = isFullscreen() ? "⤢" : "⛶";
    btnFullscreen.title = isFullscreen() ? "Quitter le plein écran" : "Mode plein écran";
    setTimeout(() => { if (map) map.invalidateSize(); if (legendChart) legendChart.resize(); }, 180);
  });

  // Dock / Undock + Drag (désactivé dans la version "side panel")
  // Ancien système de panel flottant : conservé en no-op pour compatibilité.
  /* BEGIN_NOOP_DOCK
// Dock / Undock + Drag
  const panel = document.getElementById("panel");
  const btnDock = document.getElementById("btnDock");
  const btnHidePanel = document.getElementById("btnHidePanel");
  const dockHandle = document.getElementById("dockHandle");
  const panelHeader = document.getElementById("panelHeader");

  let docked = true;
  let dragging = false;
  let dragStart = {x:0,y:0, left:0, top:0};

  function setDocked(nextDocked){
    docked = nextDocked;
    panel.classList.toggle("docked", docked);
    panel.classList.toggle("undocked", !docked);

    if (docked){
      panel.style.left = "";
      panel.style.top = "";
      panel.style.right = "16px";
      btnDock.title = "Undock (panneau flottant)";
      btnDock.textContent = "⧉";
    } else {
      const r = panel.getBoundingClientRect();
      panel.style.right = "";
      panel.style.left = Math.max(8, r.left) + "px";
      panel.style.top  = Math.max(8, r.top) + "px";
      btnDock.title = "Dock (ancrer en haut à droite)";
      btnDock.textContent = "📌";
    }
  }

  if (btnDock) btnDock.addEventListener("click", (e) => {
    e.stopPropagation();
    setDocked(!docked);
  });

  if (btnHidePanel) btnHidePanel.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.style.display = "none";
    dockHandle.classList.add("show");
  });

  if (dockHandle) dockHandle.addEventListener("click", () => {
    dockHandle.classList.remove("show");
    panel.style.display = "";
    setTimeout(() => { if (map) map.invalidateSize(); if (legendChart) legendChart.resize(); }, 0);
  });

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

  function onPointerDown(ev){
    if (docked) return;
    dragging = true;
    panel.setPointerCapture(ev.pointerId);

    const r = panel.getBoundingClientRect();
    dragStart.x = ev.clientX;
    dragStart.y = ev.clientY;
    dragStart.left = r.left;
    dragStart.top  = r.top;
  }

  function onPointerMove(ev){
    if (!dragging || docked) return;
    const dx = ev.clientX - dragStart.x;
    const dy = ev.clientY - dragStart.y;

    const nextLeft = dragStart.left + dx;
    const nextTop  = dragStart.top + dy;

    const maxLeft = window.innerWidth - 40;
    const maxTop  = window.innerHeight - 40;

    panel.style.left = clamp(nextLeft, 8, maxLeft) + "px";
    panel.style.top  = clamp(nextTop, 8, maxTop) + "px";
  }

  function onPointerUp(ev){
    if (!dragging) return;
    dragging = false;
    try{ panel.releasePointerCapture(ev.pointerId); } catch(_){}
  }

  if (panelHeader) panelHeader.addEventListener("pointerdown", onPointerDown);
  if (panelHeader) panelHeader.addEventListener("pointermove", onPointerMove);
  if (panelHeader) panelHeader.addEventListener("pointerup", onPointerUp);
  if (panelHeader) panelHeader.addEventListener("pointercancel", onPointerUp);

  END_NOOP_DOCK */

  // Leaflet map init
  map = L.map('map', { zoomControl: true, preferCanvas: true });

  const boundaryPane = map.createPane("boundaryPane");
  if (boundaryPane && boundaryPane.style){
    boundaryPane.style.zIndex = "650";
    boundaryPane.style.pointerEvents = "none";
  }

  const esriSat = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 20, attribution: 'Imagery © Esri' }
  ).addTo(map);

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20, attribution: '© OpenStreetMap'
  });

  L.control.scale({ metric: true, imperial: false }).addTo(map);
  L.control.layers({ "Satellite (Esri)": esriSat, "OSM": osm }, null, { position: "topleft" }).addTo(map);

  // Data + choropleth
  const GEOJSON_URL = null; // resolved via ?geo=... or fallback candidates

  let geojsonData = null;
  let axisSampleProps = null;
  let geoLayer = null;
  let boundaryLayer = null;
  const mapNameToLayer = new Map();
  let appReadyFired = false;

  let activeClassIndex = null;
  let isolatedClassIndex = null;

  // UI requirement: 4 classes only (Faible, Moyen, Fort, Très fort)
  // Remove "Très faible" to simplify the legend and filters.
  const DEFAULT_CLASS_COUNT = 4;
  const DEFAULT_METHOD = "quantile";
  const CLASS_LABELS = ["Faible","Moyen","Fort","Très fort"];
  const POVERTY_CLASS_LABELS = ["Faible","Moyen","Fort","Très fort"];

  let selectedField = null;
  let classCount = DEFAULT_CLASS_COUNT;
  let method = DEFAULT_METHOD;

  let breaks = [];
  let classRanges = [];

  const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
  const MISSING = "\u2014";
  const FIELD_MAP = {
    commune: ["Nom_Commun","nom_commun","Commune","NOM","NOM_COMM","name","libelle"],
    population: ["Population 2024","R \u2014 Indicateurs_Communes_RGPH_2024_Population 2024","Pop2024","POP_2024","Population","pop2024","pop"],
    pauvrete: ["Taux de pauvret\u00e9 (en %)","Pauvret\u00e9","Pauvrete","pauvrete","taux_pauvrete","poverty"],
    chomage: ["Taux de ch\u00f4mage (%)","T  de ch\u00f4mage (%)","T de ch\u00f4mage (%)","Ch\u00f4mage","Chomage","chomage","taux_chomage","unemployment"],
    analphabetisme: ["Taux d'analphab\u00e9tisme des 10 ans et plus (%)","T analphab\u00e9tisme 10 ans et plus (%)","Analphab\u00e9tisme","Analphabetisme","analphabetisme","taux_analphabetisme"],
    eau: ["Eau courante (%)","Eau","eau","taux_eau","water"],
    electricite: ["\u00c9lectricit\u00e9 (%)","Electricite (%)","\u00c9lectricit\u00e9","Electricite","electricite","taux_electricite","power"],
    assainissement: ["Assainissement (%)","Assainissement","assainissement","taux_assainissement"],
    activite: ["Taux d'activité (%)","Taux d'activite (%)","Taux d'activité","Taux activite (%)","Taux activite","taux_activite","activite"],
    scolarisation: ["Taux de scolarisation (%)","Taux de scolarisation (en %)","Scolarisation","taux_scolarisation","scolarisation"],
    vulnerabilite: ["Taux de vulnérabilité (en %)","Taux de vulnerabilite (en %)","Taux de vulnérabilité (%)","Taux de vulnerabilite (%)","Vulnérabilité","Vulnerabilite","taux_vulnerabilite"],
  };
  const METRIC_META = {
    population: { label: "Population", unit: "effectif", isPercent: false },
    pauvrete: { label: "Pauvrete", unit: "%", isPercent: true },
    chomage: { label: "Chomage", unit: "%", isPercent: true },
    analphabetisme: { label: "Analphabetisme", unit: "%", isPercent: true },
    eau: { label: "Eau courante", unit: "%", isPercent: true },
    electricite: { label: "Electricite", unit: "%", isPercent: true },
    assainissement: { label: "Assainissement", unit: "%", isPercent: true }
  };
  const POP_KPIS = [
    { key: "pauvrete", label: "Taux de pauvreté", icon: "assets/icons/taux-pauverete.png", unit: "%" },
    { key: "chomage", label: "Taux de chômage", icon: "assets/icons/taux-chaumage.png", unit: "%" },
    { key: "analphabetisme", label: "Analphabétisme", icon: "assets/icons/taux-analphabetisme.png", unit: "%" },
    { key: "eau", label: "Eau courante", icon: "assets/icons/eau-potable.png", unit: "%" },
    { key: "electricite", label: "Électricité", icon: "assets/icons/electricite.png", unit: "%" },
    { key: "assainissement", label: "Accès à l’assainissement", icon: "assets/icons/Assainissement.png", unit: "%" }
  ];
  const ASSAINISSEMENT_MODE = "access";
  const KPI_GAUGES = [
    { key:"population", label:"Population 2024", unit:"hab", icon:"assets/icons/emploi.png", invert:false, theme:"blue" },
    { key:"pauvrete", label:"Taux de pauvreté", unit:"%", icon:"assets/icons/taux-pauverete.png", invert:true, theme:"traffic" },
    { key:"chomage", label:"Taux de chômage", unit:"%", icon:"assets/icons/taux-chaumage.png", invert:true, theme:"traffic" },
    { key:"analphabetisme", label:"Analphabétisme", unit:"%", icon:"assets/icons/taux-analphabetisme.png", invert:true, theme:"traffic" },
    { key:"eau", label:"Eau courante", unit:"%", icon:"assets/icons/eau-potable.png", invert:false, theme:"traffic" },
    { key:"electricite", label:"Électricité", unit:"%", icon:"assets/icons/electricite.png", invert:false, theme:"traffic" },
    { key:"assainissement", label:"Assainissement", unit:"%", icon:"assets/icons/Assainissement.png", invert:ASSAINISSEMENT_MODE === "no_access", theme:"traffic" }
  ];
  const KPI_ORDER_FALLBACK = [
    "population",
    "pauvrete",
    "chomage",
    "analphabetisme",
    "eau",
    "electricite",
    "assainissement",
    "activite",
    "scolarisation",
    "vulnerabilite"
  ];
  const KPI_INVERT_FALLBACK = new Set([
    "pauvrete",
    "chomage",
    "analphabetisme",
    "vulnerabilite"
  ]);
  const KPI_KEYS = ["population","pauvrete","chomage","analphabetisme"];
  const RADAR_KEYS = ["population","pauvrete","analphabetisme","eau","electricite"];
  const RADAR_COLORS = ["#0f766e","#ea580c","#2563eb"];
  const TABLE_KEYS = ["commune","population","pauvrete","chomage","analphabetisme","eau","electricite"];
  const NUMERIC_KEYS = ["population","pauvrete","chomage","analphabetisme","eau","electricite"];
  const ALLOWED_KPIS = [
    "pauvrete",
    "chomage",
    "analphabetisme",
    "acces_assainissement",
    "acces_eau",
    "acces_electricite",
    "population_normalisee"
  ];
  const KPI_STYLE = {
    pauvrete: { label: "Pauvreté", family: "socio", color: "#d64b4b", dataKey: "pauvrete", isPercent: true },
    chomage: { label: "Chômage", family: "socio", color: "#e16a6a", dataKey: "chomage", isPercent: true },
    analphabetisme: { label: "Analphabétisme", family: "socio", color: "#f08a8a", dataKey: "analphabetisme", isPercent: true },
    acces_eau: { label: "Eau", family: "services", color: "#3b82f6", dataKey: "eau", isPercent: true },
    acces_electricite: { label: "Électricité", family: "services", color: "#60a5fa", dataKey: "electricite", isPercent: true },
    acces_assainissement: { label: "Assainissement", family: "services", color: "#93c5fd", dataKey: "assainissement", isPercent: true },
    population_normalisee: { label: "Population", family: "demo", color: "#6d28d9", dataKey: "population", isPercent: false }
  };
  const INDICATOR_COLORS = {
    pauvrete: "#C62828",
    chomage: "#EF6C00",
    analphabetisme: "#AD1457",
    acces_eau: "#1565C0",
    acces_electricite: "#00838F",
    acces_assainissement: "#2E7D32",
    population_normalisee: "#6A1B9A"
  };
  const KPI_FAMILIES = {
    socio: { label: "Pressions socio-\u00e9conomiques", color: "#D64545", accent: "#F59E0B" },
    services: { label: "Acc\u00e8s aux services essentiels", color: "#1D4ED8", accent: "#14B8A6" },
    capital: { label: "Capital humain & activit\u00e9", color: "#6D28D9", accent: "#A78BFA" },
    demo: { label: "D\u00e9mographie", color: "#15803D", accent: "#22C55E" }
  };
  const KPI_FAMILY_ORDER = ["socio","services","capital","demo"];
  const KPI_FAMILY_FALLBACK = {
    pauvrete: "socio",
    chomage: "socio",
    analphabetisme: "socio",
    vulnerabilite: "socio",
    eau: "services",
    electricite: "services",
    assainissement: "services",
    scolarisation: "capital",
    activite: "capital",
    population: "demo"
  };
  const KPI_FAMILY_KEYS = {
    socio: ["pauvrete","chomage","analphabetisme","vulnerabilite"],
    services: ["eau","electricite","assainissement"],
    capital: ["scolarisation","activite"],
    demo: ["population"]
  };
  const LINE_GROUPS = [
    { title: "Socio-économique", keys: ["pauvrete", "chomage", "analphabetisme"] },
    { title: "Services de base", keys: ["acces_eau", "acces_electricite", "acces_assainissement"] },
    { title: "Pression démographique", keys: ["population_normalisee"] }
  ];
  const LINES_SERIES = ALLOWED_KPIS
    .map((key) => KPI_STYLE[key] ? ({
      key,
      label: KPI_STYLE[key].label,
      isPercent: KPI_STYLE[key].isPercent,
      color: INDICATOR_COLORS[key] || KPI_STYLE[key].color,
      dataKey: KPI_STYLE[key].dataKey
    }) : null)
    .filter(Boolean);
  const PODIUM_DATA = [
    { name: "Bouarfa (Mun.)", score: 98.6, services: 99.0, pauvrete: 3.0, population: 27485 },
    { name: "Figuig (Mun.)", score: 84.2, services: 98.2, pauvrete: 5.9, population: 9903 },
    { name: "Bni Tadjite", score: 77.8, services: 81.0, pauvrete: 16.6, population: 17087 }
  ];
  const COMMUNE_PROFILE_ITEMS = [
    {
      id: "population",
      label: "Population 2024",
      format: "int",
      icons: ["assets/icons/emploi.png"],
      fieldCandidates: FIELD_MAP.population
    },
    {
      id: "pauvrete",
      label: "Taux de pauvrete",
      format: "percent",
      icons: ["assets/icons/taux-pauverete.png"],
      fieldCandidates: FIELD_MAP.pauvrete
    },
    {
      id: "chomage",
      label: "Taux de chomage",
      format: "percent",
      icons: ["assets/icons/taux-chaumage.png"],
      fieldCandidates: FIELD_MAP.chomage
    },
    {
      id: "analphabetisme",
      label: "Analphabetisme",
      format: "percent",
      icons: ["assets/icons/taux-analphabetisme.png"],
      fieldCandidates: FIELD_MAP.analphabetisme
    },
    {
      id: "eau",
      label: "Eau courante",
      format: "percent",
      icons: ["assets/icons/eau-potable.png"],
      fieldCandidates: FIELD_MAP.eau
    },
    {
      id: "electricite",
      label: "Electricite",
      format: "percent",
      icons: ["assets/icons/electricite.png"],
      fieldCandidates: FIELD_MAP.electricite
    }
  ];

  let radarChart = null;
  let selectedCommuneQueue = [];
  let userTouchedSelection = false;
  let dashboardRows = [];
  let dashboardFieldKeys = null;
  let dashboardContext = null;
  let tableSortKey = "commune";
  let tableSortDir = "asc";
  let tableFilterText = "";
  let currentTableRows = [];
  const warnedFields = new Set();
  let dataDiagnosticsLogged = false;
  let joinDiagnosticsLogged = false;
  let dataEmptyAlerted = false;
  const communesByName = new Map();
  let selectedProfileLayer = null;
  let selectedProfileName = "";
  let profileInitialized = false;
  let communeProfileStats = new Map();

  function escapeHtml(s){
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatNumber(v){
    if (!isNumber(v)) return "—";
    return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  }

  function formatInt(v){
    if (!isNumber(v)) return MISSING;
    return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  }

  function formatPercent(v){
    if (!isNumber(v)) return MISSING;
    return v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
  }

  function formatNumber(v){
    if (!isNumber(v)) return MISSING;
    return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  }

  function pickField(properties, candidates){
    if (!properties || !Array.isArray(candidates)) return "";
    for (const c of candidates){
      if (Object.prototype.hasOwnProperty.call(properties, c)) return c;
    }
    const keys = Object.keys(properties);
    const lowerMap = {};
    keys.forEach((k) => { lowerMap[k.toLowerCase()] = k; });
    for (const c of candidates){
      const key = lowerMap[String(c).toLowerCase()];
      if (key) return key;
    }
    for (const c of candidates){
      const frag = String(c).toLowerCase();
      if (!frag) continue;
      const matches = keys.filter((k) => k.toLowerCase().includes(frag));
      if (!matches.length) continue;
      const noColon = matches.filter((k) => !k.includes(":"));
      return noColon[0] || matches[0] || "";
    }
    return "";
  }

  function parseNumberSmart(input, isPercentField){
    if (input === null || input === undefined) return NaN;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    const raw = String(input).trim();
    if (!raw) return NaN;
    const hasPct = raw.includes("%");
    let n = Number(raw.replace(/\s+/g, "").replace("%", "").replace(",", "."));
    if (!Number.isFinite(n)){
      n = Number(raw.replace(",", ".").replace(/[^0-9.\-]/g, ""));
    }
    if (!Number.isFinite(n)) return NaN;
    if (isPercentField && !hasPct && n > 0 && n <= 1) n = n * 100;
    return n;
  }

  function safeJsonSize(obj){
    try{ return JSON.stringify(obj).length; } catch(_){ return 0; }
  }

  function normalizeCommuneName(value){
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\u2019\u2018]/g, "'")
      .replace(/\s+/g, " ");
  }

  function logDataEmpty(issues){
    if (dataEmptyAlerted || !issues.length) return;
    dataEmptyAlerted = true;
    console.warn("[DATA] DATA EMPTY:", issues);
    alert("DATA EMPTY: " + issues.join(" | "));
  }

  function logResolvedFields(fieldKeys, sampleProps){
    if (dataDiagnosticsLogged) return;
    const resolved = {};
    TABLE_KEYS.forEach((k) => { resolved[k] = fieldKeys[k] || ""; });
    console.info("[FIELDS] resolved");
    console.table(resolved);
    if (sampleProps){
      const kpiRows = KPI_KEYS.map((k) => {
        const field = fieldKeys[k] || "";
        return { kpi: k, field, sample: field ? sampleProps[field] : undefined };
      });
      console.table(kpiRows);
    }
    dataDiagnosticsLogged = true;
  }

  function logJoinDiagnostics(rows){
    if (joinDiagnosticsLogged) return;
    if (!rows || !rows.length) return;
    const layerKeys = [];
    mapNameToLayer.forEach((_, k) => { layerKeys.push(k); });
    const normalizedLayers = new Map();
    layerKeys.forEach((name) => { normalizedLayers.set(normalizeCommuneName(name), name); });
    let matched = 0;
    const unmatched = [];
    rows.forEach((row) => {
      const key = normalizeCommuneName(row.name);
      if (normalizedLayers.has(key)) matched += 1;
      else unmatched.push(row.name);
    });
    console.info("[JOIN] matched communes = " + matched + "/" + rows.length);
    if (unmatched.length){
      console.warn("[JOIN] unmatched names (sample):", unmatched.slice(0, 20));
    }
    joinDiagnosticsLogged = true;
  }

  function resolveFieldByCandidates(props, candidates){
    return pickField(props, candidates || []);
  }

  function formatFixed2(v){
    if (!isNumber(v)) return MISSING;
    return v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatSigned(v, formatter){
    if (!isNumber(v)) return MISSING;
    const sign = v > 0 ? "+" : v < 0 ? "-" : "";
    const abs = Math.abs(v);
    const formatted = formatter(abs);
    if (formatted === MISSING) return MISSING;
    return sign + formatted;
  }

  function formatProfileValue(item, value){
    if (!isNumber(value)) return MISSING;
    if (item.format === "int") return formatInt(value);
    if (item.format === "percent") return formatPercent(value);
    if (item.format === "fixed2") return formatFixed2(value);
    return formatNumber(value);
  }

  function getCommuneFieldValue(props, item){
    if (!props || !item) return null;
    const key = resolveFieldByCandidates(props, item.fieldCandidates);
    if (!key) return null;
    const isPercent = item.format === "percent";
    const val = parseNumberSmart(props[key], isPercent);
    return Number.isFinite(val) ? val : null;
  }

  function buildCommuneProfileStats(fc){
    const stats = new Map();
    const features = fc && Array.isArray(fc.features) ? fc.features : [];
    const total = features.length;
    const nameKeys = resolveFieldKeys(fc);
    COMMUNE_PROFILE_ITEMS.forEach((item) => {
      const valuesByName = new Map();
      const values = [];
      features.forEach((f, idx) => {
        const props = f && f.properties ? f.properties : {};
        const name = getCommuneName(f, idx, nameKeys);
        const value = getCommuneFieldValue(props, item);
        if (isNumber(value)){
          valuesByName.set(normalizeCommuneName(name), value);
          values.push(value);
        }
      });
      const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      const ranks = new Map();
      if (valuesByName.size){
        const sorted = [...valuesByName.entries()].sort((a, b) => b[1] - a[1]);
        sorted.forEach(([normName], idx) => {
          ranks.set(normName, idx + 1);
        });
      }
      stats.set(item.id, { mean, ranks, total });
    });
    return stats;
  }

  function applyIconFallback(img, icons){
    if (!img || !icons || !icons.length) return;
    let idx = 0;
    img.src = icons[idx];
    img.onerror = () => {
      idx += 1;
      if (idx < icons.length) img.src = icons[idx];
      else img.onerror = null;
    };
  }

  function getKpiOrder(){
    if (typeof window !== "undefined" && Array.isArray(window.KPI_ORDER) && window.KPI_ORDER.length){
      return window.KPI_ORDER;
    }
    return KPI_ORDER_FALLBACK;
  }

  function computeKpiStats(rows, kpiKey, isPercentField){
    const values = rows
      .map(r => parseNumberSmart(r[kpiKey], isPercentField))
      .filter(isNumber);
    if (!values.length) return { min: null, max: null, mean: null, total: 0 };
    let min = values[0];
    let max = values[0];
    values.forEach((v) => {
      if (v < min) min = v;
      if (v > max) max = v;
    });
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { min, max, mean, total: values.length };
  }

  function getKpiDirection(kpiKey, fallbackInvert){
    if (typeof KPI_REGISTRY !== "undefined" && KPI_REGISTRY[kpiKey] && KPI_REGISTRY[kpiKey].direction){
      return KPI_REGISTRY[kpiKey].direction;
    }
    return fallbackInvert ? "higher_is_worse" : "higher_is_better";
  }

  function normalizeMinMax(value, min, max){
    if (!isNumber(value) || !isNumber(min) || !isNumber(max)) return null;
    if (max === min) return 50;
    const raw = ((value - min) / (max - min)) * 100;
    if (!isNumber(raw)) return null;
    if (raw < 0) return 0;
    if (raw > 100) return 100;
    return raw;
  }

  function computeKpiRank(rows, kpiKey, higherIsWorse, name){
    const list = rows.filter(r => isNumber(r[kpiKey])).slice();
    list.sort((a, b) => higherIsWorse ? a[kpiKey] - b[kpiKey] : b[kpiKey] - a[kpiKey]);
    const idx = list.findIndex(r => normalizeCommuneName(r.name) === normalizeCommuneName(name));
    if (idx < 0) return null;
    return { rank: idx + 1, total: list.length };
  }

  function computeCommuneCardModel(communeName){
    const rowsAll = dashboardRows || [];
    const row = findRowByName(communeName);
    const name = row ? row.name : (communeName || MISSING);
    const registry = (typeof KPI_REGISTRY !== "undefined") ? KPI_REGISTRY : null;
    const keys = getKpiOrder();
    const items = keys.map((kpiKey) => {
      const entry = registry && registry[kpiKey] ? registry[kpiKey] : null;
      const label = entry && entry.label
        ? entry.label
        : (METRIC_META[kpiKey] ? METRIC_META[kpiKey].label : kpiKey);
      const unit = entry && entry.unit
        ? entry.unit
        : (METRIC_META[kpiKey] && METRIC_META[kpiKey].isPercent ? "%" : "");
      const fallbackInvert = KPI_INVERT_FALLBACK.has(kpiKey);
      const direction = getKpiDirection(kpiKey, fallbackInvert);
      const higherIsWorse = direction === "higher_is_worse";
      const rawValue = row ? row[kpiKey] : null;
      const isPercentField = unit === "%";
      const value = isNumber(rawValue) ? rawValue : parseNumberSmart(rawValue, isPercentField);
      const stats = computeKpiStats(rowsAll, kpiKey, isPercentField);
      const baseScore = normalizeMinMax(value, stats.min, stats.max);
      const scorePct = isNumber(baseScore)
        ? Math.max(0, Math.min(100, higherIsWorse ? (100 - baseScore) : baseScore))
        : null;
      const rankInfo = row ? computeKpiRank(rowsAll, kpiKey, higherIsWorse, row.name) : null;
      const delta = isNumber(value) && isNumber(stats.mean) ? (value - stats.mean) : null;
      const theme = entry && entry.palette === "blue" ? "blue" : "traffic";
      const icon = entry && entry.iconFile ? ("assets/icons/" + entry.iconFile) : "";
      const familyId = entry && entry.familyId ? entry.familyId : (KPI_FAMILY_FALLBACK[kpiKey] || "socio");
      return {
        key: kpiKey,
        label,
        unit,
        theme,
        icon,
        familyId,
        value,
        scorePct,
        rank: rankInfo ? rankInfo.rank : null,
        total: rankInfo ? rankInfo.total : null,
        delta
      };
    });
    return { name, items };
  }

  function getGaugeColor(score, theme){
    if (!isNumber(score)) return "#9ca3af";
    if (theme === "blue") return "#2563eb";
    if (score < 30) return "#dc2626";
    if (score < 60) return "#f59e0b";
    if (score < 85) return "#16a34a";
    return "#166534";
  }

  function renderGaugeSVG(score, theme){
    const size = 120;
    const cx = 60;
    const cy = 60;
    const r = 46;
    const startAngle = 180;
    const endAngle = 0;
    const scoreAngle = isNumber(score)
      ? 180 - Math.max(0, Math.min(100, score)) * 1.8
      : 180;

    function polarToCartesian(x, y, radius, angleDeg){
      const rad = (angleDeg - 90) * Math.PI / 180.0;
      return { x: x + (radius * Math.cos(rad)), y: y + (radius * Math.sin(rad)) };
    }

    function describeArc(x, y, radius, start, end){
      const startPt = polarToCartesian(x, y, radius, end);
      const endPt = polarToCartesian(x, y, radius, start);
      const largeArcFlag = Math.abs(end - start) <= 180 ? "0" : "1";
      return "M " + startPt.x + " " + startPt.y + " A " + radius + " " + radius + " 0 " + largeArcFlag + " 0 " + endPt.x + " " + endPt.y;
    }

    const bgPath = describeArc(cx, cy, r, startAngle, endAngle);
    const fgPath = describeArc(cx, cy, r, startAngle, scoreAngle);
    const color = getGaugeColor(score, theme);
    const showValue = isNumber(score);

    return (
      "<svg viewBox=\"0 0 " + size + " " + (size * 0.6) + "\" width=\"100%\" height=\"100%\" aria-hidden=\"true\">" +
        "<path d=\"" + bgPath + "\" fill=\"none\" stroke=\"rgba(0,0,0,.08)\" stroke-width=\"10\" stroke-linecap=\"round\"/>" +
        (showValue ? "<path d=\"" + fgPath + "\" fill=\"none\" stroke=\"" + color + "\" stroke-width=\"10\" stroke-linecap=\"round\"/>" : "") +
      "</svg>"
    );
  }

  function formatKpiValue(value, unit){
    if (!isNumber(value)) return MISSING;
    if (unit === "%"){
      return (Math.round(value * 10) / 10).toFixed(1).replace(".", ",") + "%";
    }
    return formatInt(value);
  }

  function formatDelta(value, unit){
    if (!isNumber(value)) return MISSING;
    const sign = value >= 0 ? "+" : "";
    if (unit === "%"){
      return sign + (Math.round(value * 10) / 10).toFixed(1).replace(".", ",") + "%";
    }
    return sign + formatInt(value);
  }

  function renderCommuneGauges(name){
    if (!csGridEl) return;
    csGridEl.innerHTML = "";
    const model = computeCommuneCardModel(name);
    if (csCommuneNameEl) csCommuneNameEl.textContent = model.name || MISSING;

    const itemsByFamily = new Map();
    model.items.forEach((item) => {
      const familyId = item.familyId || "socio";
      if (!itemsByFamily.has(familyId)) itemsByFamily.set(familyId, []);
      itemsByFamily.get(familyId).push(item);
    });
    const orderedFamilies = KPI_FAMILY_ORDER.slice();
    itemsByFamily.forEach((_, key) => {
      if (!orderedFamilies.includes(key)) orderedFamilies.push(key);
    });

    orderedFamilies.forEach((familyId) => {
      const familyItems = itemsByFamily.get(familyId);
      if (!familyItems || !familyItems.length) return;
      const orderKeys = KPI_FAMILY_KEYS[familyId];
      if (Array.isArray(orderKeys) && orderKeys.length){
        familyItems.sort((a, b) => {
          const aIdx = orderKeys.indexOf(a.key);
          const bIdx = orderKeys.indexOf(b.key);
          const aPos = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx;
          const bPos = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx;
          if (aPos !== bPos) return aPos - bPos;
          return 0;
        });
      }
      const familyMeta = KPI_FAMILIES[familyId] || { label: familyId };
      const familyBlock =
        "<div class=\"kpi-family\" data-family=\"" + familyId + "\">" +
          "<div class=\"kpi-family-header\">" +
            "<span class=\"kpi-family-bar\"></span>" +
            "<span class=\"kpi-family-title\">" + escapeHtml(familyMeta.label || familyId) + "</span>" +
          "</div>" +
          "<div class=\"kpi-family-grid\"></div>" +
        "</div>";
      csGridEl.insertAdjacentHTML("beforeend", familyBlock);
      const familyEl = csGridEl.lastElementChild;
      const gridEl = familyEl ? familyEl.querySelector(".kpi-family-grid") : null;
      if (!gridEl) return;

      familyItems.forEach((item) => {
        const value = item.value;
        const score = item.scorePct;

        let sub = "";
        if (isNumber(value) && item.rank){
          const deltaTxt = isNumber(item.delta) ? " | Ecart: " + formatDelta(item.delta, item.unit) : "";
          sub = "Rang: " + item.rank + "/" + item.total + deltaTxt;
        }

        const iconUrl = (typeof getKpiIconUrl === "function") ? getKpiIconUrl(item.key) : item.icon;
        const fallbackUrl = (typeof KPI_ICON_FALLBACK !== "undefined") ? KPI_ICON_FALLBACK : "assets/icons/emploi.png";
        const iconOnError = fallbackUrl
          ? "this.onerror=null;this.src='" + fallbackUrl + "';this.classList.add('is-fallback');"
          : "this.style.display='none';";
        const gaugeSvg = (typeof window !== "undefined" && typeof window.renderGaugeSVG === "function")
          ? window.renderGaugeSVG({ valuePct: isNumber(score) ? score : NaN })
          : renderGaugeSVG(score, item.theme);

        const card =
          "<div class=\"commune-kpi-card\" data-kpi=\"" + item.key + "\" data-family=\"" + familyId + "\">" +
            "<div class=\"commune-kpi-head\">" +
              "<img class=\"commune-kpi-ico\" src=\"" + iconUrl + "\" onerror=\"" + iconOnError + "\" alt=\"\">" +
              "<div class=\"commune-kpi-meta\">" +
                "<div class=\"commune-kpi-title\">" + escapeHtml(item.label) + "</div>" +
                "<div class=\"commune-kpi-sub\">" + escapeHtml(sub) + "</div>" +
              "</div>" +
            "</div>" +
            "<div class=\"commune-kpi-gauge\">" + gaugeSvg + "</div>" +
            "<div class=\"commune-kpi-foot\">" +
              "<div class=\"commune-kpi-score\">" + (isNumber(score) ? Math.round(score) + "%" : MISSING) + "</div>" +
              "<div class=\"commune-kpi-raw\">" + escapeHtml(formatKpiValue(value, item.unit)) + "</div>" +
            "</div>" +
          "</div>";
        gridEl.insertAdjacentHTML("beforeend", card);
      });
    });
  }

  function renderCommuneProfile(name, props){
    renderCommuneGauges(name);
  }

  function dockGlobalStats(){
    if (!globalStatsDockEl || !statsCardEl) return;
    if (!globalStatsDockEl.contains(statsCardEl)){
      globalStatsDockEl.appendChild(statsCardEl);
    }
    const titleEl = statsCardEl.querySelector(".card-title");
    if (titleEl) titleEl.textContent = "Statistiques Globales Province de Figuig";
  }

  function refreshCommuneList(){
    if (!communeListEl) return;
    communeListEl.innerHTML = "";
    const names = Array.from(communesByName.values())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "fr"));
    names.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      communeListEl.appendChild(option);
    });
  }

  function selectCommuneByName(name, options){
    const raw = String(name || "").trim();
    if (!raw) return;
    const entry = communesByName.get(normalizeCommuneName(raw));
    if (!entry){
      renderCommuneProfile(raw || MISSING, null);
      return;
    }

    selectedProfileName = entry.name;
    renderCommuneProfile(entry.name, entry.properties || {});
    if (communeSearchEl) communeSearchEl.value = entry.name;

    if (selectedProfileLayer && geoLayer){
      try{ geoLayer.resetStyle(selectedProfileLayer); } catch(_){}
    }
    selectedProfileLayer = entry.layer || null;
    if (selectedProfileLayer){
      try{
        selectedProfileLayer.setStyle({ weight: 3, color: "#111827", fillOpacity: 0.8 });
      } catch(_){}
    }

    const allowZoom = !(options && options.zoom === false);
    if (allowZoom && map && entry.layer){
      try{ map.fitBounds(entry.layer.getBounds(), { padding: [30, 30] }); } catch(_){}
    }
    if (linesChart) linesChart.draw();
    if (communePopEl){
      communePopEl.removeAttribute("data-open");
      communePopEl.setAttribute("aria-hidden", "true");
    }
  }

  function initCommuneProfile(){
    if (profileInitialized || !communeSidebarEl) return;
    if (!communesByName.size) return;
    profileInitialized = true;
    if (communesByName.has(normalizeCommuneName("Figuig"))){
      selectCommuneByName("Figuig", { zoom: false });
      return;
    }
    const first = communesByName.values().next().value;
    if (first) selectCommuneByName(first.name, { zoom: false });
  }

  function getCommuneName(feature, fallbackIndex, fieldKeys){
    if (feature && feature._labelName) return feature._labelName;
    const p = feature && feature.properties ? feature.properties : {};
    let key = "";
    if (fieldKeys && fieldKeys.commune && Object.prototype.hasOwnProperty.call(p, fieldKeys.commune)){
      key = fieldKeys.commune;
    } else {
      key = pickField(p, FIELD_MAP.commune);
    }
    const name = key ? p[key] : (p.Nom_Commun || p.nom_commun || p.NOM || p.Commune || p.name || p.nom || p.Nom || p.NOM_COMM || p.libelle || "");
    if (name && String(name).trim()) return String(name).trim();
    if (typeof fallbackIndex === "number") return "Commune " + (fallbackIndex + 1);
    return "Commune";
  }

  function warnMissingField(key){
    if (!key || warnedFields.has(key)) return;
    console.warn("[Dashboard] Champ manquant pour: " + key);
    warnedFields.add(key);
  }

  function resolveFieldKeys(fc){
    const resolved = {};
    Object.keys(FIELD_MAP).forEach((k) => { resolved[k] = ""; });
    if (!fc || !Array.isArray(fc.features)) return resolved;
    for (const f of fc.features){
      const p = f.properties || {};
      Object.keys(FIELD_MAP).forEach((k) => {
        if (resolved[k]) return;
        const found = pickField(p, FIELD_MAP[k]);
        if (found) resolved[k] = found;
      });
    }
    return resolved;
  }

  function getFeatureName(feature, fallbackIndex){
    return getCommuneName(feature, fallbackIndex, dashboardFieldKeys);
  }

  function getNumericFields(fc){
    const counts = new Map();
    fc.features.forEach(f => {
      const p = f.properties || {};
      Object.keys(p).forEach(k => { if (isNumber(p[k])) counts.set(k, (counts.get(k)||0) + 1); });
    });
    const threshold = Math.ceil(fc.features.length * 0.6);
    return [...counts.entries()]
      .filter(([,c]) => c >= threshold)
      .map(([k]) => k)
      .sort((a,b) => a.localeCompare(b, "fr"));
  }

  function computeValues(fc, field){
    const vals = [];
    fc.features.forEach(f => {
      const v = f.properties ? f.properties[field] : null;
      if (isNumber(v)) vals.push(v);
    });
    vals.sort((a,b) => a-b);
    return vals;
  }

  function quantileBreaks(sortedVals, k){
    const n = sortedVals.length;
    if (n === 0) return [0, 1];
    const out = [sortedVals[0]];
    for (let i = 1; i < k; i++){
      const p = i / k;
      const idx = (n - 1) * p;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      const q = (lo === hi) ? sortedVals[lo] : (sortedVals[lo] + (sortedVals[hi]-sortedVals[lo])*(idx-lo));
      out.push(q);
    }
    out.push(sortedVals[n-1]);
    for (let i=1;i<out.length;i++){ if (out[i] < out[i-1]) out[i] = out[i-1]; }
    return out;
  }

  function equalIntervalBreaks(sortedVals, k){
    const n = sortedVals.length;
    if (n === 0) return [0, 1];
    const min = sortedVals[0];
    const max = sortedVals[n-1];
    if (min === max){
      const eps = Math.abs(min) * 0.01 + 1;
      const out = [];
      for (let i=0;i<=k;i++) out.push(min + (eps * i / k));
      return out;
    }
    const step = (max - min) / k;
    const out = [min];
    for (let i=1;i<k;i++) out.push(min + step*i);
    out.push(max);
    return out;
  }

  function buildClasses(breaksArr, paletteName="YlOrRd", labelsArr=CLASS_LABELS){
    const k = breaksArr.length - 1;
    const base = chroma.scale(paletteName).mode("lab").colors(k);
    const ranges = [];
    for (let i=0;i<k;i++){
      const a = breaksArr[i];
      const b = breaksArr[i+1];
      const label = labelsArr && labelsArr[i] ? labelsArr[i] : (formatNumber(a) + " – " + formatNumber(b));
      ranges.push({ min:a, max:b, label, color: base[i] });
    }
    return ranges;
  }

  function getClassIndex(value, breaksArr){
    if (!isNumber(value)) return null;
    if (!Array.isArray(breaksArr) || breaksArr.length < 2) return null;
    const k = breaksArr.length - 1;
    for (let i=0; i<k; i++){
      const a = breaksArr[i];
      const b = breaksArr[i+1];
      const isLast = (i === k-1);
      if ((value >= a && value < b) || (isLast && value >= a && value <= b)) return i;
    }
    return null;
  }

  function classIndexForValue(v){
    return getClassIndex(v, breaks);
  }

  function styleFeature(feature){
    const v = feature.properties ? feature.properties[selectedField] : null;
    const idx = classIndexForValue(v);

    const filtered =
      (isolatedClassIndex !== null) ? (idx !== isolatedClassIndex) :
      (activeClassIndex !== null) ? (idx !== activeClassIndex) :
      false;

    const fill = (idx === null) ? "#d1d5db" : classRanges[idx].color;

    return {
      weight: 1.2,
      color: filtered ? "rgba(17,24,39,.25)" : "rgba(17,24,39,.75)",
      opacity: 1,
      fillColor: fill,
      fillOpacity: filtered ? 0.10 : 0.55
    };
  }

  function highlight(e){
    const layer = e.target;
    layer.setStyle({ weight: 2.5, color: "#111827", fillOpacity: 0.72 });
    layer.bringToFront();
  }
  function unhighlight(e){ geoLayer.resetStyle(e.target); }

  function popupHtml(f){
    const p = f.properties || {};
    const name = getCommuneName(f, null, dashboardFieldKeys);
    const prov = p.Province || p.province || "";
    const val = isNumber(p[selectedField]) ? formatNumber(p[selectedField]) : "—";

    return "<div style='min-width:240px'>" +
      "<div style='font-weight:700; font-size:14px; margin-bottom:6px'>" + escapeHtml(name) + "</div>" +
      "<div style='color:#6b7280; font-size:12px; margin-bottom:10px'>" + (prov ? "Province : " + escapeHtml(prov) : "") + "</div>" +
      "<div style='display:flex; justify-content:space-between; gap:10px; align-items:baseline'>" +
        "<div style='font-size:12px; color:#6b7280'>" + escapeHtml(selectedField) + "</div>" +
        "<div style='font-size:16px; font-weight:800'>" + escapeHtml(val) + "</div>" +
      "</div>" +
    "</div>";
  }

  function tooltipText(f){
    const p = f.properties || {};
    const name = getCommuneName(f, null, dashboardFieldKeys);
    const v = isNumber(p[selectedField]) ? formatNumber(p[selectedField]) : "—";
    return name + " • " + selectedField + ": " + v;
  }

  function getFilteredFeatures(fc){
    if (!fc || !Array.isArray(fc.features)) return [];
    if (!selectedField || !breaks.length) return fc.features.slice();
    if (activeClassIndex === null && isolatedClassIndex === null) return fc.features.slice();
    const target = (isolatedClassIndex !== null) ? isolatedClassIndex : activeClassIndex;
    return fc.features.filter((f) => {
      const v = f.properties ? f.properties[selectedField] : null;
      const idx = getClassIndex(v, breaks);
      return idx === target;
    });
  }

  function buildMetricContext(fc, fieldKeys){
    const context = { maxPop: 0, missing: {} };
    RADAR_KEYS.forEach((k) => { context.missing[k] = true; });
    if (!fc || !Array.isArray(fc.features)) return context;
    let popCount = 0;
    fc.features.forEach((f) => {
      const p = f.properties || {};
      if (fieldKeys.population){
        const val = parseNumberSmart(p[fieldKeys.population], false);
        if (Number.isFinite(val)){
          popCount += 1;
          if (val > context.maxPop) context.maxPop = val;
        }
      }
      RADAR_KEYS.forEach((k) => {
        if (k === "population") return;
        const key = fieldKeys[k];
        if (!key) return;
        const val = parseNumberSmart(p[key], true);
        if (Number.isFinite(val)) context.missing[k] = false;
      });
    });
    context.missing.population = !(fieldKeys.population) || popCount === 0;
    if (!fieldKeys.population) context.maxPop = 0;
    return context;
  }

  function buildDashboardRows(features, fieldKeys, context){
    const percentKeys = ["pauvrete","chomage","analphabetisme","eau","electricite","assainissement","activite","scolarisation","vulnerabilite"];
    const rows = [];
    if (!Array.isArray(features)) return rows;
    features.forEach((f, idx) => {
      const p = f.properties || {};
      const name = getCommuneName(f, idx, fieldKeys);
      const row = { name, commune: name, feature: f };
      if (fieldKeys.population){
        const val = parseNumberSmart(p[fieldKeys.population], false);
        row.population = Number.isFinite(val) ? val : null;
      } else {
        row.population = null;
      }
      percentKeys.forEach((k) => {
        if (!fieldKeys[k]) { row[k] = null; return; }
        const val = parseNumberSmart(p[fieldKeys[k]], true);
        row[k] = Number.isFinite(val) ? val : null;
      });
      rows.push(row);
    });
    return rows;
  }

  function ensureDefaultSelection(rows){
    const available = new Set(rows.map(r => r.name));
    selectedCommuneQueue = selectedCommuneQueue.filter((name) => available.has(name));
    if (userTouchedSelection && selectedCommuneQueue.length) return;
    if (!rows.length) return;
    const sorted = rows.slice();
    const hasPop = sorted.some(r => isNumber(r.population));
    if (hasPop){
      sorted.sort((a, b) => {
        const av = isNumber(a.population) ? a.population : -Infinity;
        const bv = isNumber(b.population) ? b.population : -Infinity;
        if (bv !== av) return bv - av;
        return a.name.localeCompare(b.name, "fr");
      });
    }
    const base = hasPop ? sorted : rows;
    selectedCommuneQueue = base.slice(0, 3).map(r => r.name);
  }

  function updateKpiValue(el, value, formatter){
    if (!el) return;
    const text = formatter(value);
    el.textContent = text;
    if (text === MISSING) el.classList.add("missing");
    else el.classList.remove("missing");
  }

  function average(values){
    const list = values.filter(isNumber);
    if (!list.length) return null;
    const sum = list.reduce((a, b) => a + b, 0);
    return sum / list.length;
  }

  function renderKpis(rows, fieldKeys){
    if (!fieldKeys.population) warnMissingField("population");
    if (!fieldKeys.pauvrete) warnMissingField("pauvrete");
    if (!fieldKeys.chomage) warnMissingField("chomage");
    if (!fieldKeys.analphabetisme) warnMissingField("analphabetisme");

    const popValues = rows.map(r => r.population).filter(isNumber);
    const popSum = popValues.reduce((a, b) => a + b, 0);
    const popTotal = popValues.length ? popSum : null;
    const pauvreteAvg = fieldKeys.pauvrete ? average(rows.map(r => r.pauvrete)) : null;
    const chomageAvg = fieldKeys.chomage ? average(rows.map(r => r.chomage)) : null;
    const analphabetismeAvg = fieldKeys.analphabetisme ? average(rows.map(r => r.analphabetisme)) : null;
    updateKpiValue(kpiPopulationEl, popTotal, formatInt);
    updateKpiValue(kpiPauvreteEl, pauvreteAvg, formatPercent);
    updateKpiValue(kpiChomageEl, chomageAvg, formatPercent);
    updateKpiValue(kpiAnalphabetismeEl, analphabetismeAvg, formatPercent);
    console.info(
      "[KPI] popSum=" + (isNumber(popTotal) ? popTotal : "NA") +
      " pauvreteAvg=" + (isNumber(pauvreteAvg) ? pauvreteAvg : "NA") +
      " chomageAvg=" + (isNumber(chomageAvg) ? chomageAvg : "NA") +
      " analphabetismeAvg=" + (isNumber(analphabetismeAvg) ? analphabetismeAvg : "NA")
    );
  }

  function colorWithAlpha(hex, alpha){
    if (!hex || hex[0] !== "#") return "rgba(17,24,39," + alpha + ")";
    let r = 17, g = 24, b = 39;
    if (hex.length === 4){
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length >= 7){
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    }
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function destroyRadarChart(){
    if (radarChart){
      radarChart.destroy();
      radarChart = null;
    }
  }

  function renderRadar(rows, context){
    if (!radarCanvas) return;
    if (!window.Chart){
      console.warn("Chart.js not loaded; radar disabled.");
      return;
    }
    ensureDefaultSelection(rows);
    const rowByName = new Map(rows.map(r => [r.name, r]));
    const selectedRows = selectedCommuneQueue.map(n => rowByName.get(n)).filter(Boolean);

    destroyRadarChart();
    if (!selectedRows.length) return;

    const labels = RADAR_KEYS.map(k => METRIC_META[k].label);
    const rawValues = [];
    const datasets = selectedRows.map((row, idx) => {
      const color = RADAR_COLORS[idx % RADAR_COLORS.length];
      const raw = [];
      const data = [];
      RADAR_KEYS.forEach((key) => {
        const rawVal = row[key];
        const hasRaw = isNumber(rawVal);
        const metricMissing = context && context.missing ? context.missing[key] : false;
        raw.push(hasRaw ? rawVal : null);
        let normalized = 0;
        if (metricMissing){
          normalized = 0;
        } else if (key === "population"){
          const max = context && context.maxPop ? context.maxPop : 0;
          normalized = hasRaw && max > 0 ? (rawVal / max) * 100 : 0;
        } else {
          normalized = hasRaw ? rawVal : 0;
        }
        if (normalized > 100) normalized = 100;
        if (normalized < 0) normalized = 0;
        data.push(normalized);
      });
      rawValues.push(raw);
      return {
        label: row.name,
        data,
        borderColor: color,
        backgroundColor: colorWithAlpha(color, 0.18),
        pointBackgroundColor: color,
        pointBorderColor: "#fff",
        pointRadius: 3,
        borderWidth: 2,
        fill: true
      };
    });

    const ctx = radarCanvas.getContext("2d");
    radarChart = new Chart(ctx, {
      type: "radar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { bottom: 22 } },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              title: (items) => {
                const item = items[0];
                return item && item.dataset ? item.dataset.label : "";
              },
              label: (ctx) => {
                const key = RADAR_KEYS[ctx.dataIndex];
                const label = METRIC_META[key] ? METRIC_META[key].label : key;
                const missing = ctx.chart && ctx.chart._metricMissing ? ctx.chart._metricMissing[key] : false;
                if (missing) return label + ": 0 (donn\u00e9e manquante)";
                const raw = ctx.chart && ctx.chart._rawValues ? ctx.chart._rawValues[ctx.datasetIndex][ctx.dataIndex] : null;
                if (!isNumber(raw)) return label + ": " + MISSING;
                if (key === "population") return label + ": " + formatInt(raw) + " effectif";
                return label + ": " + formatPercent(raw);
              }
            }
          }
        },
        scales: {
          r: {
            beginAtZero: true,
            suggestedMax: 100,
            ticks: { display: false },
            grid: { color: "rgba(17,24,39,.12)" },
            pointLabels: { font: { size: 11 } }
          }
        },
        elements: {
          line: { borderWidth: 2 }
        }
      }
    });

    radarChart._rawValues = rawValues;
    radarChart._metricMissing = context ? context.missing : {};
  }

  function sortRows(rows, sortKey, sortDir){
    const dir = sortDir === "desc" ? -1 : 1;
    return rows.slice().sort((a, b) => {
      if (sortKey === "commune"){
        return dir * a.name.localeCompare(b.name, "fr");
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNum = isNumber(av);
      const bNum = isNumber(bv);
      if (aNum && bNum){
        if (av !== bv) return dir * (av - bv);
        return a.name.localeCompare(b.name, "fr");
      }
      if (aNum && !bNum) return -1;
      if (!aNum && bNum) return 1;
      return a.name.localeCompare(b.name, "fr");
    });
  }

  function updateTableHeader(){
    if (!dataTableEl) return;
    const ths = dataTableEl.querySelectorAll("thead th[data-field]");
    ths.forEach((th) => {
      th.classList.remove("sort-asc", "sort-desc");
      const key = th.getAttribute("data-field");
      if (key === tableSortKey){
        th.classList.add(tableSortDir === "asc" ? "sort-asc" : "sort-desc");
      }
    });
  }

  function formatTableCell(key, value){
    if (key === "commune") return value || MISSING;
    if (key === "population") return formatInt(value);
    return formatPercent(value);
  }

  function renderTable(rows){
    if (!dataTbodyEl) return;
    const query = String(tableFilterText || "").toLowerCase().trim();
    let list = rows.slice();
    if (query){
      list = list.filter(r => String(r.name || "").toLowerCase().includes(query));
    }
    list = sortRows(list, tableSortKey, tableSortDir);
    currentTableRows = list;
    dataTbodyEl.innerHTML = "";
    list.forEach((row) => {
      const tr = document.createElement("tr");
      const cells = TABLE_KEYS.map((key) => {
        const value = (key === "commune") ? row.name : row[key];
        return "<td>" + escapeHtml(formatTableCell(key, value)) + "</td>";
      });
      tr.innerHTML = cells.join("");
      tr.addEventListener("click", () => {
        const layer = mapNameToLayer.get(row.name);
        if (!layer || !map) return;
        const highlightStyle = { weight: 3.2, color: "#111827", fillOpacity: 0.8 };
        try{
          map.fitBounds(layer.getBounds(), { padding: [30, 30] });
          layer.setStyle(highlightStyle);
          layer.bringToFront();
          setTimeout(() => {
            if (geoLayer && layer) geoLayer.resetStyle(layer);
          }, 900);
        } catch(_){}
      });
      dataTbodyEl.appendChild(tr);
    });
    updateTableHeader();
  }

  function csvEscape(value){
    const s = String(value ?? "");
    if (/[\";\n\r]/.test(s)) return "\"" + s.replace(/\"/g, "\"\"") + "\"";
    return s;
  }

  function getTableColumns(){
    if (!dataTableEl) return [];
    const cols = [];
    const ths = dataTableEl.querySelectorAll("thead th[data-field]");
    ths.forEach((th) => {
      cols.push({ key: th.getAttribute("data-field"), label: th.textContent.trim() });
    });
    return cols;
  }

  function exportCsv(){
    const cols = getTableColumns();
    if (!cols.length) return;
    const lines = [];
    lines.push(cols.map(c => csvEscape(c.label)).join(";"));
    currentTableRows.forEach((row) => {
      const line = cols.map((c) => {
        const key = c.key;
        const value = (key === "commune") ? row.name : row[key];
        return csvEscape(formatTableCell(key, value));
      });
      lines.push(line.join(";"));
    });
    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "donnees.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  function rebuildDashboard(){
    if (!geojsonData) return;
    dashboardFieldKeys = resolveFieldKeys(geojsonData);
    let sampleProps = axisSampleProps;
    if (!sampleProps && Array.isArray(geojsonData.features)){
      for (const f of geojsonData.features){
        if (f && f.properties){
          sampleProps = f.properties;
          break;
        }
      }
    }
    logResolvedFields(dashboardFieldKeys, sampleProps);
    TABLE_KEYS.forEach((k) => {
      if (k === "commune"){
        if (!dashboardFieldKeys.commune) warnMissingField("commune");
        return;
      }
      if (!dashboardFieldKeys[k]) warnMissingField(k);
    });

    const filtered = getFilteredFeatures(geojsonData);
    dashboardContext = buildMetricContext(geojsonData, dashboardFieldKeys);
    dashboardRows = buildDashboardRows(filtered, dashboardFieldKeys, dashboardContext);
    const issues = [];
    const featureCount = Array.isArray(geojsonData.features) ? geojsonData.features.length : 0;
    if (featureCount === 0) issues.push("features=0");
    const missingKpis = KPI_KEYS.filter((k) => !dashboardFieldKeys[k]);
    if (missingKpis.length) issues.push("kpi_fields_missing=" + missingKpis.join(","));
    const extraLineKeys = ["activite","scolarisation","vulnerabilite"];
    const unresolvedLines = extraLineKeys.filter((k) => !dashboardFieldKeys[k]);
    if (unresolvedLines.length && !warnedFields.has("kpi_unresolved")){
      const details = unresolvedLines.map((k) => k + ": [" + (FIELD_MAP[k] || []).join(", ") + "]");
      console.warn("[Dashboard] KPI unresolved: " + details.join(" | "));
      warnedFields.add("kpi_unresolved");
    }
    const anyNumeric = Array.isArray(geojsonData.features) && geojsonData.features.some((f) => {
      const p = f && f.properties ? f.properties : {};
      return NUMERIC_KEYS.some((k) => {
        const key = dashboardFieldKeys[k];
        if (!key) return false;
        const val = parseNumberSmart(p[key], k !== "population");
        return Number.isFinite(val);
      });
    });
    if (!anyNumeric) issues.push("all_numeric_nan");
    logDataEmpty(issues);
    logJoinDiagnostics(dashboardRows);
    if (dataSearchEl) tableFilterText = dataSearchEl.value || "";
    renderKpis(dashboardRows, dashboardFieldKeys);
    renderRadar(dashboardRows, dashboardContext);
    renderCommuneLines(dashboardRows);
    renderTable(dashboardRows);
    renderLegendChart();
    renderPodiumCard();
  }

  function toggleCommuneSelection(name){
    if (!name) return;
    userTouchedSelection = true;
    const idx = selectedCommuneQueue.indexOf(name);
    if (idx !== -1){
      selectedCommuneQueue.splice(idx, 1);
    } else {
      if (selectedCommuneQueue.length >= 3) selectedCommuneQueue.shift();
      selectedCommuneQueue.push(name);
    }
    if (dashboardContext) renderRadar(dashboardRows, dashboardContext);
    else rebuildDashboard();
  }

  // Legend
  const legendTitleEl = document.getElementById("legendTitle");
  const legendMetaEl  = document.getElementById("legendMeta");
  const legendItemsEl = document.getElementById("legendItems");
  const kpiPopulationEl = document.getElementById("kpiPopulation");
  const kpiPauvreteEl = document.getElementById("kpiPauvrete");
  const kpiChomageEl = document.getElementById("kpiChomage");
  const kpiAnalphabetismeEl = document.getElementById("kpiAnalphabetisme");
  const radarCanvas = document.getElementById("radarChart");
  const dataTableEl = document.getElementById("dataTable");
  const dataTbodyEl = document.getElementById("dataTbody");
  const dataSearchEl = document.getElementById("tableSearch");
  const exportBtn = document.getElementById("exportBtn");
  const podiumTabsEl = document.getElementById("podiumTabs");
  const podiumChartCanvas = document.getElementById("podiumChart");
  const communePopEl = document.getElementById("communePop");
  const communePopNameEl = document.getElementById("communePopName");
  const communePopBodyEl = document.getElementById("communePopBody");
  const communePopCloseEl = document.getElementById("communePopClose");
  const communeSidebarEl = document.getElementById("communeSidebar");
  const globalStatsDockEl = document.getElementById("globalStatsDock");
  const statsCardEl = document.getElementById("statsCard");
  const csCommuneNameEl = document.getElementById("csCommuneName");
  const communeSearchEl = document.querySelector("#communeSidebar #csSearch");
  const communeListEl = document.getElementById("csCommuneList");
  const csGridEl = document.getElementById("csGrid");
  // Mini-chart (communes colorees par classe) — Chart.js
  const chartCanvas = document.getElementById("legendChart");
  const chartTitleEl = document.querySelector("#communeChartCard .legend-chart-title");
  const chartModeBtn = document.getElementById("chartModeBtn");
  const chartMode = "COMMUNES_BARS_COLORED_BY_CLASS";
  let legendChart = null;
  let podiumChart = null;
  let activePodiumIndex = 0;
  const linesCanvas = document.getElementById("communeLinesChart");
  const linesControlsEl = document.getElementById("linesControls");
  let linesChart = null;

  function destroyLegendChart(){
    if (legendChart){
      legendChart.destroy();
      legendChart = null;
    }
  }

  function buildCommuneChartData(){
    const items = [];
    if (!geojsonData || !selectedField || !breaks.length) return { items, labels: [], data: [], colors: [] };

    geojsonData.features.forEach((f, idx) => {
      const p = f.properties || {};
      const v = p[selectedField];
      if (!isNumber(v)) return;
      const classIdx = getClassIndex(v, breaks);
      if (classIdx === null) return;

      if (isolatedClassIndex !== null && classIdx !== isolatedClassIndex) return;
      if (isolatedClassIndex === null && activeClassIndex !== null && classIdx !== activeClassIndex) return;

      const name = getFeatureName(f, idx);
      const color = classRanges[classIdx] ? classRanges[classIdx].color : "#d1d5db";
      const layer = mapNameToLayer.get(name) || null;
      items.push({ name, value: v, classIndex: classIdx, color, layer });
    });

    items.sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      return a.name.localeCompare(b.name, "fr");
    });

    return {
      items,
      labels: items.map(i => i.name),
      data: items.map(i => i.value),
      colors: items.map(i => i.color)
    };
  }

  function fieldNameToMetricKey(fieldName){
    if (!fieldName) return "";
    const target = String(fieldName).toLowerCase();
    const keys = Object.keys(FIELD_MAP);
    for (const k of keys){
      const candidates = FIELD_MAP[k] || [];
      for (const c of candidates){
        if (String(c).toLowerCase() === target) return k;
      }
    }
    return "";
  }

  function renderLegendChart(){
    if (!chartCanvas) return;
    if (!geojsonData || !selectedField || !classRanges.length) return;

    const chartData = buildCommuneChartData();
    const labels = chartData.labels;
    let data = chartData.data;
    const colors = chartData.colors;
    const ctx = chartCanvas.getContext("2d");
    const metricKey = fieldNameToMetricKey(selectedField);
    const isPopulation = metricKey === "population";

    if (chartTitleEl){
      chartTitleEl.textContent = isPopulation ? "Population (score 0–100)" : "Communes (classées)";
    }

    if (isPopulation){
      const rawValues = chartData.items.map(i => i.value).filter(isNumber);
      let minPop = rawValues.length ? rawValues[0] : 0;
      let maxPop = rawValues.length ? rawValues[0] : 0;
      rawValues.forEach((v) => {
        if (v < minPop) minPop = v;
        if (v > maxPop) maxPop = v;
      });
      data = chartData.items.map((item) => {
        if (!isNumber(item.value)) return null;
        if (maxPop === minPop) return 50;
        const score = ((item.value - minPop) / (maxPop - minPop)) * 100;
        return Math.max(0, Math.min(100, score));
      });
    }

    if (!window.Chart){
      console.warn("Chart.js not loaded; chart disabled.");
      return;
    }

    if (chartModeBtn){
      chartModeBtn.textContent = "Tri décroissant";
      chartModeBtn.title = "Tri des communes par valeur";
      chartModeBtn.disabled = true;
    }

    destroyLegendChart();
    legendChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: isPopulation ? "Population (score 0–100)" : (selectedField || "Valeur"),
          data,
          backgroundColor: colors,
          borderColor: "rgba(0,0,0,0.25)",
          borderWidth: 1,
          borderRadius: 6,
          barPercentage: 0.72,
          categoryPercentage: 0.9
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const chart = items[0] && items[0].chart ? items[0].chart : null;
                const list = chart && chart._communeItems ? chart._communeItems : [];
                const item = list[items[0].dataIndex];
                return item ? item.name : "";
              },
              label: (ctx) => {
                const chart = ctx.chart;
                const list = chart && chart._communeItems ? chart._communeItems : [];
                const item = list[ctx.dataIndex];
                if (!item) return "";
                if (isPopulation){
                  const rawText = formatInt(item.value);
                  const score = isNumber(ctx.parsed.x) ? ctx.parsed.x : ctx.parsed.y;
                  const scoreText = isNumber(score)
                    ? score.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                    : MISSING;
                  return "Population 2024: " + rawText + " (score: " + scoreText + ")";
                }
                const label = METRIC_META[metricKey] ? METRIC_META[metricKey].label : selectedField;
                return label + ": " + formatPercent(item.value);
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: "rgba(17,24,39,.08)" },
            type: "linear",
            min: 0,
            max: 100,
            ticks: { font: { size: 10 } }
          },
          y: {
            grid: { display:false },
            ticks: { font: { size: 11 }, autoSkip: false, padding: 6 }
          }
        },
        onClick: (evt) => {
          const pts = legendChart.getElementsAtEventForMode(evt, "nearest", { intersect: true }, true);
          if (!pts.length) return;
          const idx = pts[0].index;
          const items = legendChart._communeItems || [];
          const item = items[idx];
          if (!item || !item.layer || !map) return;

          const layer = item.layer;
          const highlightStyle = { weight: 3.2, color: "#111827", fillOpacity: 0.8 };
          try{
            map.fitBounds(layer.getBounds(), { padding: [30, 30] });
            layer.setStyle(highlightStyle);
            layer.bringToFront();
            setTimeout(() => {
              if (geoLayer && layer) geoLayer.resetStyle(layer);
            }, 900);
          } catch(_){}
        }
      }
    });

    legendChart._communeItems = chartData.items;
    setTimeout(() => {
      if (legendChart) legendChart.resize();
    }, 0);
  }

  function formatPodiumPercent(value){
    if (!isNumber(value)) return MISSING;
    return (Math.round(value * 10) / 10).toFixed(1).replace(".", ",") + "%";
  }

  function destroyPodiumChart(){
    if (podiumChart){
      try{ podiumChart.destroy(); } catch(_){ }
      podiumChart = null;
    }
  }

  function clampPercent(value){
    if (!isNumber(value)) return null;
    return Math.max(0, Math.min(100, value));
  }

  function computePopNorm(value, minVal, maxVal){
    if (!isNumber(value) || !isNumber(minVal) || !isNumber(maxVal)) return null;
    if (maxVal == minVal) return 50;
    return ((value - minVal) / (maxVal - minVal)) * 100;
  }

  // Normalize KPI values into 0-100 segments.
  function buildRadialSegments(item, popMin, popMax){
    if (!item) return [];
    const scoreRaw = isNumber(item.score) ? item.score : null;
    const servicesRaw = isNumber(item.services) ? item.services : null;
    const pauvreteRaw = isNumber(item.pauvrete) ? item.pauvrete : null;
    const popRaw = isNumber(item.population) ? item.population : null;

    const score = clampPercent(scoreRaw);
    const services = clampPercent(servicesRaw);
    const pauvreteNorm = isNumber(pauvreteRaw) ? clampPercent(100 - pauvreteRaw) : null;
    const popNorm = clampPercent(computePopNorm(popRaw, popMin, popMax));

    return [
      { key: "score", label: "Score composite", value: score, valueText: formatPodiumPercent(scoreRaw), color: "#0ea5e9", position: "top" },
      { key: "services", label: "Services", value: services, valueText: formatPodiumPercent(servicesRaw), color: "#22c55e", position: "right" },
      { key: "pauvrete", label: "Pauvrete", value: pauvreteNorm, valueText: formatPodiumPercent(pauvreteRaw), color: "#f97316", position: "bottom" },
      { key: "population", label: "Population", value: popNorm, valueText: isNumber(popRaw) ? formatInt(popRaw) : MISSING, color: "#94a3b8", position: "left" }
    ];
  }

  function drawRadialArc(ctx, cx, cy, r, startDeg, endDeg, color, width){
    const start = (Math.PI / 180) * startDeg;
    const end = (Math.PI / 180) * endDeg;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end, false);
    ctx.stroke();
  }

  function drawCenterIcon(ctx, x, y, size){
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.quadraticCurveTo(size * 0.8, -size * 0.2, 0, size);
    ctx.quadraticCurveTo(-size * 0.8, -size * 0.2, 0, -size);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(0, -size * 0.25, size * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight){
    if (!text) return;
    const words = String(text).split(" ");
    let line = "";
    const lines = [];
    words.forEach((word) => {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line){
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    lines.slice(0, 2).forEach((ln, idx) => {
      ctx.fillText(ln, x, y + idx * lineHeight);
    });
  }

  function drawRadialLabel(ctx, x, y, align, valueText, labelText){
    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "#111827";
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    ctx.fillText(valueText || MISSING, x, y);
    ctx.textBaseline = "top";
    ctx.fillStyle = "#6b7280";
    ctx.font = "600 10px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    ctx.fillText(labelText || "", x, y + 2);
    ctx.restore();
  }

  // Custom draw for segmented ring, center, and labels.
  const radialKpiPlugin = {
    id: "radialKpi",
    afterDraw: (chart, _args, opts) => {
      if (!opts || !opts.segments || !opts.segments.length) return;
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const centerX = (chartArea.left + chartArea.right) / 2;
      const centerY = (chartArea.top + chartArea.bottom) / 2;
      const width = chartArea.right - chartArea.left;
      const height = chartArea.bottom - chartArea.top;
      const size = Math.min(width, height);
      const ringWidth = Math.max(10, size * 0.12);
      const labelPad = isNumber(opts.labelPad) ? opts.labelPad : 26;
      const outerR = Math.max(ringWidth + 8, size / 2 - labelPad - ringWidth / 2);
      const innerR = outerR - ringWidth;
      const gapDeg = isNumber(opts.gapDeg) ? opts.gapDeg : 10;
      const segments = opts.segments;
      const span = (360 - gapDeg * segments.length) / segments.length;
      const inactive = opts.inactiveColor || "rgba(0,0,0,.12)";

      ctx.save();
      ctx.lineCap = "round";

      segments.forEach((seg, idx) => {
        const startDeg = -90 + idx * (span + gapDeg) + gapDeg / 2;
        const endDeg = startDeg + span;
        drawRadialArc(ctx, centerX, centerY, outerR, startDeg, endDeg, inactive, ringWidth);

        const value = isNumber(seg.value) ? Math.max(0, Math.min(100, seg.value)) : null;
        if (isNumber(value) && value > 0){
          const activeEnd = startDeg + (span * value / 100);
          drawRadialArc(ctx, centerX, centerY, outerR, startDeg, activeEnd, seg.color || "#111827", ringWidth);
        }
      });

      ctx.fillStyle = opts.centerColor || "#fde68a";
      ctx.beginPath();
      ctx.arc(centerX, centerY, Math.max(10, innerR - 6), 0, Math.PI * 2);
      ctx.fill();

      drawCenterIcon(ctx, centerX, centerY - 6, Math.max(8, innerR * 0.28));

      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#111827";
      ctx.font = "700 11px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
      drawWrappedText(ctx, opts.centerLabel || "", centerX, centerY + innerR * 0.1, innerR * 1.6, 12);

      const labelRadius = outerR + ringWidth * 0.8;
      segments.forEach((seg) => {
        const pos = seg.position || "top";
        let x = centerX;
        let y = centerY;
        let align = "center";
        if (pos === "top"){
          x = centerX;
          y = centerY - labelRadius;
          align = "center";
        } else if (pos === "right"){
          x = centerX + labelRadius;
          y = centerY - 4;
          align = "left";
        } else if (pos === "bottom"){
          x = centerX;
          y = centerY + labelRadius;
          align = "center";
        } else if (pos === "left"){
          x = centerX - labelRadius;
          y = centerY - 4;
          align = "right";
        }
        drawRadialLabel(ctx, x, y, align, seg.valueText || MISSING, seg.label || "");
      });

      ctx.restore();
    }
  };

  function renderPodiumTabs(items){
    if (!podiumTabsEl) return;
    podiumTabsEl.innerHTML = "";
    items.forEach((item, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "podium-tab" + (idx == activePodiumIndex ? " active" : "");
      btn.textContent = item.name;
      btn.addEventListener("click", () => {
        if (activePodiumIndex === idx) return;
        activePodiumIndex = idx;
        renderPodiumCard();
      });
      podiumTabsEl.appendChild(btn);
    });
  }

  function renderPodiumCard(){
    if (!podiumChartCanvas) return;
    if (!window.Chart){
      console.warn("Chart.js not loaded; KPI 360 disabled.");
      return;
    }
    const items = Array.isArray(PODIUM_DATA) ? PODIUM_DATA.filter((d) => d && d.name) : [];
    if (!items.length) return;
    if (activePodiumIndex >= items.length) activePodiumIndex = 0;

    renderPodiumTabs(items);

    const popValues = items.map(i => i.population).filter(isNumber);
    const popMin = popValues.length ? Math.min.apply(null, popValues) : null;
    const popMax = popValues.length ? Math.max.apply(null, popValues) : null;
    const activeItem = items[activePodiumIndex];
    const segments = buildRadialSegments(activeItem, popMin, popMax);

    const ctx = podiumChartCanvas.getContext("2d");
    if (!podiumChart){
      podiumChart = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: ["KPI 360"],
          datasets: [{
            data: [1],
            backgroundColor: ["rgba(0,0,0,0)"],
            borderWidth: 0
          }]
        },
        options: {
          cutout: "72%",
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 650 },
          layout: { padding: { top: 24, right: 48, bottom: 24, left: 48 } },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
            radialKpi: {
              segments,
              centerLabel: activeItem.name
            }
          }
        },
        plugins: [radialKpiPlugin]
      });
    } else {
      podiumChart.options.plugins.radialKpi = {
        segments,
        centerLabel: activeItem.name
      };
      podiumChart.update();
    }
  }

  function destroyLinesChart(){
    if (linesChart){
      linesChart.destroy();
      linesChart = null;
    }
  }

  function getLinesToggleState(){
    const states = new Map();
    if (!linesControlsEl) return states;
    const inputs = linesControlsEl.querySelectorAll("input[type=\"checkbox\"][data-key]");
    inputs.forEach((input) => {
      const key = input.getAttribute("data-key");
      if (!key) return;
      states.set(key, !!input.checked);
    });
    return states;
  }

  function renderLinesLegend(state, availableKeys){
    if (!linesControlsEl) return;
    const active = state || new Map();
    const available = availableKeys && availableKeys.size ? availableKeys : null;
    linesControlsEl.innerHTML = "";
    LINE_GROUPS.forEach((group) => {
      group.keys.forEach((key) => {
        if (!KPI_STYLE[key]) return;
        if (available && !available.has(key)) return;
        const label = document.createElement("label");
        label.className = "line-toggle";
        const checked = active.size ? !!active.get(key) : true;
        const color = INDICATOR_COLORS[key] || (KPI_STYLE[key] ? KPI_STYLE[key].color : "#e5e7eb");
        label.innerHTML =
          "<input type=\"checkbox\" data-key=\"" + key + "\" " + (checked ? "checked" : "") + ">" +
          "<span class=\"swatch\" data-key=\"" + key + "\" style=\"background-color:" + color + "; border-color:" + color + ";\"></span>" +
          "<span class=\"txt\">" + escapeHtml(KPI_STYLE[key].label) + "</span>";
        if (!checked) label.classList.add("is-off");
        linesControlsEl.appendChild(label);
      });
    });
    syncLineToggleStyles();
  }

  function setupLinesControls(){
    if (!linesControlsEl) return;
    renderLinesLegend(getLinesToggleState(), null);
    linesControlsEl.addEventListener("change", (event) => {
      const input = event.target.closest("input[data-key]");
      if (!input || !linesChart) return;
      const active = getLinesToggleState();
      linesChart.data.datasets.forEach((ds) => {
        if (!ds._key) return;
        ds.hidden = active.size ? !active.get(ds._key) : false;
      });
      linesChart.update();
      syncLineSwatches();
      syncLineToggleStyles();
    });
  }

  function syncLineSwatches(){
    if (!linesControlsEl || !linesChart) return;
    const swatches = linesControlsEl.querySelectorAll(".swatch[data-key]");
    swatches.forEach((swatch) => {
      const key = swatch.getAttribute("data-key");
      if (!key) return;
      const ds = linesChart.data.datasets.find(d => d._key === key);
      if (!ds) return;
      swatch.style.backgroundColor = ds.borderColor || "#e5e7eb";
      swatch.style.borderColor = ds.borderColor || "#e5e7eb";
    });
  }

  function syncLineToggleStyles(){
    if (!linesControlsEl) return;
    const toggles = linesControlsEl.querySelectorAll(".line-toggle");
    toggles.forEach((label) => {
      const input = label.querySelector("input[data-key]");
      if (!input) return;
      label.classList.toggle("is-off", !input.checked);
    });
  }

  function computeLineMinMax(rows, key){
    const values = rows.map(r => r[key]).filter(isNumber);
    if (!values.length) return null;
    let min = values[0];
    let max = values[0];
    values.forEach((v) => {
      if (v < min) min = v;
      if (v > max) max = v;
    });
    return { min, max };
  }

  function normalizeLineValue(value, range){
    if (!isNumber(value)) return null;
    if (!range) return null;
    if (range.max === range.min) return 50;
    const n = ((value - range.min) / (range.max - range.min)) * 100;
    if (n > 100) return 100;
    if (n < 0) return 0;
    return n;
  }

  function formatLineRaw(key, value){
    if (!isNumber(value)) return MISSING;
    if (key === "population_normalisee") return formatInt(value);
    return formatPercent(value);
  }

  const communeMarkerPlugin = {
    id: "communeMarker",
    afterDatasetsDraw: (chart) => {
      const labels = chart.data && chart.data.labels ? chart.data.labels : [];
      if (!labels.length) return;
      if (!selectedProfileName) return;
      const target = normalizeCommuneName(selectedProfileName);
      const idx = labels.findIndex(l => normalizeCommuneName(l) === target);
      if (idx < 0) return;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return;
      const x = xScale.getPixelForValue(idx);
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = "rgba(17,24,39,.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, yScale.top);
      ctx.lineTo(x, yScale.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  function renderCommuneLines(rows){
    if (!linesCanvas) return;
    if (!window.Chart){
      console.warn("Chart.js not loaded; lines chart disabled.");
      return;
    }
    if (!rows || !rows.length){
      destroyLinesChart();
      return;
    }

    const labels = rows.map(r => r.name);
    const toggles = getLinesToggleState();
    const popRange = computeLineMinMax(rows, "population");
    const datasets = [];
    LINES_SERIES.forEach((series) => {
      const dataKey = series.dataKey || series.key;
      const color = INDICATOR_COLORS[series.key] || series.color;
      const rawValues = rows.map(r => (isNumber(r[dataKey]) ? r[dataKey] : null));
      if (!rawValues.some(isNumber)){
        console.warn("[KPI_FILTER] missing " + series.key);
        return;
      }
      const data = rawValues.map((v) => {
        if (!isNumber(v)) return null;
        if (!series.isPercent) return normalizeLineValue(v, popRange);
        return clampPercent(v);
      });
      datasets.push({
        label: series.label,
        data,
        borderColor: color,
        backgroundColor: colorWithAlpha(color, 0.12),
        pointBackgroundColor: color,
        pointRadius: 2,
        pointHoverRadius: 3,
        borderWidth: 2,
        tension: 0.25,
        spanGaps: false,
        fill: false,
        _key: series.key,
        _dataKey: dataKey,
        _rawValues: rawValues,
        hidden: toggles.size ? !toggles.get(series.key) : false
      });
    });

    renderLinesLegend(toggles, new Set(datasets.map(ds => ds._key)));

    destroyLinesChart();
    const ctx = linesCanvas.getContext("2d");
    linesChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => (items && items[0] ? items[0].label : ""),
              label: (ctx) => {
                const ds = ctx.dataset || {};
                const key = ds._key || "";
                const rawValues = ds._rawValues || [];
                const raw = rawValues[ctx.dataIndex];
                const score = isNumber(ctx.parsed.y) ? ctx.parsed.y : null;
                if (key === "population_normalisee"){
                  const scoreText = isNumber(score)
                    ? score.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                    : MISSING;
                  return "Population (norm): " + scoreText;
                }
                const rawText = formatLineRaw(key, raw);
                return (ds.label || key) + ": " + rawText;
              }
            }
          }
        },
        scales: {
          x: {
            type: "category",
            grid: { display: false },
            ticks: { autoSkip: false, minRotation: 25, maxRotation: 35, font: { size: 10 } }
          },
          y: {
            min: 0,
            max: 100,
            ticks: { stepSize: 25, font: { size: 10 } },
            grid: { color: "rgba(17,24,39,.08)" }
          }
        },
        onClick: (evt) => {
          const pts = linesChart.getElementsAtEventForMode(evt, "nearest", { intersect: true }, true);
          if (!pts.length) return;
          const idx = pts[0].index;
          const name = labels[idx];
          if (name) selectCommuneByName(name);
        }
      },
      plugins: [communeMarkerPlugin]
    });
    syncLineSwatches();
  }

  function getCurrentIndicatorKey(){
    if (!selectedField) return "";
    if (dashboardFieldKeys){
      const keys = Object.keys(METRIC_META);
      for (const k of keys){
        if (dashboardFieldKeys[k] && dashboardFieldKeys[k] === selectedField) return k;
      }
    }
    return fieldNameToMetricKey(selectedField);
  }

  function getIndicatorLabel(key){
    if (!key || !METRIC_META[key]) return selectedField || "Indicateur";
    if (key === "population") return "Population 2024";
    const meta = METRIC_META[key];
    return meta.isPercent ? meta.label + " (%)" : meta.label;
  }

  function formatIndicatorValue(key, value){
    if (key === "population") return formatInt(value);
    return formatPercent(value);
  }

  function fmtVal(value, unit){
    if (!isNumber(value)) return MISSING;
    if (unit === "%"){
      const fixed = Math.round(value * 10) / 10;
      return fixed.toFixed(1).replace(".", ",") + "%";
    }
    return formatInt(value);
  }

  function computeStats(rows, key){
    const vals = rows.map(r => r[key]).filter(isNumber);
    if (!vals.length) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { mean };
  }

  function computeRank(rows, key, name){
    const list = rows
      .filter(r => isNumber(r[key]))
      .slice()
      .sort((a, b) => b[key] - a[key]);
    const idx = list.findIndex(r => r.name === name);
    if (idx < 0) return null;
    return { rank: idx + 1, total: list.length, list };
  }

  function findRowByName(name){
    if (!name || !dashboardRows) return null;
    const norm = normalizeCommuneName(name);
    return dashboardRows.find(r => normalizeCommuneName(r.name) === norm) || null;
  }

  function renderCommunePopup(row, rowsAll){
    if (!communePopEl || !communePopBodyEl || !communePopNameEl) return;
    communePopNameEl.textContent = row && row.name ? row.name : MISSING;
    communePopBodyEl.innerHTML = "";
    if (!row || !rowsAll || !rowsAll.length){
      communePopEl.removeAttribute("data-open");
      communePopEl.setAttribute("aria-hidden", "true");
      return;
    }

    POP_KPIS.forEach((kpi) => {
      const v = row[kpi.key];
      const stats = computeStats(rowsAll, kpi.key);
      const rk = computeRank(rowsAll, kpi.key, row.name);

      let sub = "";
      if (isNumber(v) && rk){
        const ec = stats ? (v - stats.mean) : null;
        const ecTxt = (ec === null || !isNumber(ec))
          ? ""
          : (" | Écart: " + (ec >= 0 ? "+" : "") + (Math.round(ec * 10) / 10).toFixed(1).replace(".", ",") + (kpi.unit || ""));
        sub = "Rang: " + rk.rank + "/" + rk.total + ecTxt;
      }

      const html =
        "<div class=\"kpi-row\" data-key=\"" + kpi.key + "\">" +
          "<div class=\"kpi-left\">" +
            "<div class=\"kpi-ico\"><img src=\"" + kpi.icon + "\" alt=\"\"></div>" +
            "<div class=\"kpi-meta\">" +
              "<div class=\"kpi-label\">" + escapeHtml(kpi.label) + "</div>" +
              "<div class=\"kpi-sub\">" + escapeHtml(sub) + "</div>" +
            "</div>" +
          "</div>" +
          "<div class=\"kpi-val\">" + escapeHtml(fmtVal(v, kpi.unit)) + "</div>" +
        "</div>";
      communePopBodyEl.insertAdjacentHTML("beforeend", html);
    });

    communePopEl.setAttribute("data-open", "1");
    communePopEl.setAttribute("aria-hidden", "false");
  }

  function renderLegend(){
    legendTitleEl.textContent = selectedField || "Légende";
    legendMetaEl.textContent  = "";
    legendItemsEl.innerHTML = "";

    classRanges.forEach((c, idx) => {
      const div = document.createElement("div");
      div.className = "legend-item";

      const isActive = (activeClassIndex === idx);
      const isIsolated = (isolatedClassIndex === idx);
      if (activeClassIndex !== null && !isActive) div.classList.add("dim");
      if (isolatedClassIndex !== null && !isIsolated) div.classList.add("dim");
      if (isActive || isIsolated) div.classList.add("active");

      div.innerHTML =
        "<div class=\"legend-swatch\" style=\"background:" + c.color + "\"></div>" +
        "<div class=\"legend-label\"><span>" + escapeHtml(c.label) + "</span></div>";

      if (div) div.addEventListener("click", (ev) => {
        const shift = ev.shiftKey;
        if (shift){
          isolatedClassIndex = (isolatedClassIndex === idx) ? null : idx;
          activeClassIndex = null;
        } else {
          activeClassIndex = (activeClassIndex === idx) ? null : idx;
          isolatedClassIndex = null;
        }
        renderLegend();
        renderLegendChart();
        if (geoLayer) geoLayer.setStyle(styleFeature);
        rebuildDashboard();
      });

      legendItemsEl.appendChild(div);
    });
  }

  function rebuild(){
    if (!geojsonData || !selectedField) return;

    classCount = DEFAULT_CLASS_COUNT;
    method = DEFAULT_METHOD;
    communeProfileStats = buildCommuneProfileStats(geojsonData);

    const vals = computeValues(geojsonData, selectedField);
    if (vals.length === 0){
      alert("Aucune valeur numérique exploitable pour ce champ.");
      return;
    }

    breaks = quantileBreaks(vals, classCount);
    classRanges = buildClasses(breaks, "YlOrRd", CLASS_LABELS);

    activeClassIndex = null;
    isolatedClassIndex = null;

    if (geoLayer) map.removeLayer(geoLayer);
    mapNameToLayer.clear();
    communesByName.clear();
    selectedProfileLayer = null;
    let featureIndex = 0;

    geoLayer = L.geoJSON(geojsonData, {
      style: styleFeature,
      onEachFeature: (feature, layer) => {
        const fname = getFeatureName(feature, featureIndex);
        feature._labelName = fname;
        featureIndex += 1;
        mapNameToLayer.set(fname, layer);
        const normalizedName = normalizeCommuneName(fname);
        communesByName.set(normalizedName, { name: fname, feature, properties: feature.properties || {}, layer });
        layer.on({
          mouseover: highlight,
          mouseout: unhighlight,
          click: () => {
            map.fitBounds(layer.getBounds(), { padding: [30, 30] });
            toggleCommuneSelection(fname);
            selectCommuneByName(fname, { zoom: false });
          }
        });
        layer.bindTooltip(tooltipText(feature), { className: "mytt", sticky: true, direction: "top" });
      }
    }).addTo(map);

    const b = geoLayer.getBounds();
    if (b && b.isValid()) map.fitBounds(b, { padding: [30, 30] });

    if (!appReadyFired){
      appReadyFired = true;
      try{
        if (window && window.dispatchEvent){
          window.dispatchEvent(new CustomEvent("APP_READY", { detail: { map: map } }));
        }
      } catch(_){}
    }

    renderLegend();
    renderLegendChart();
    rebuildDashboard();
    refreshCommuneList();
    if (selectedProfileName){
      selectCommuneByName(selectedProfileName, { zoom: false });
    } else {
      initCommuneProfile();
    }
  }

  const resetFilterBtn = document.getElementById("resetFilterBtn");
  if (resetFilterBtn) resetFilterBtn.addEventListener("click", () => {
    activeClassIndex = null;
    isolatedClassIndex = null;
    renderLegend();
    renderLegendChart();
    if (geoLayer) geoLayer.setStyle(styleFeature);
    rebuildDashboard();
  });

  if (dataSearchEl) dataSearchEl.addEventListener("input", () => {
    tableFilterText = dataSearchEl.value || "";
    renderTable(dashboardRows);
  });

  if (dataTableEl) dataTableEl.addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;
    const key = th.getAttribute("data-field");
    if (!key) return;
    if (tableSortKey === key) tableSortDir = (tableSortDir === "asc") ? "desc" : "asc";
    else { tableSortKey = key; tableSortDir = "asc"; }
    renderTable(dashboardRows);
  });

  if (exportBtn) exportBtn.addEventListener("click", () => exportCsv());
  setupLinesControls();
  if (communePopCloseEl) communePopCloseEl.addEventListener("click", () => {
    if (!communePopEl) return;
    communePopEl.removeAttribute("data-open");
    communePopEl.setAttribute("aria-hidden", "true");
  });
  dockGlobalStats();
  if (communeSearchEl){
    communeSearchEl.addEventListener("change", () => {
      selectCommuneByName(communeSearchEl.value);
    });
    communeSearchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter"){
        e.preventDefault();
        selectCommuneByName(communeSearchEl.value);
      }
    });
  }

  // Indicator select
  const indicatorSelect = document.getElementById("fieldSelect");

  let allFields = [];

  function setSelectedField(field){
    selectedField = field;
    if (indicatorSelect && indicatorSelect.value !== field){
      indicatorSelect.value = field;
    }
    rebuild();
  }

  function populateIndicatorOptions(fields){
    if (!indicatorSelect) return;
    indicatorSelect.innerHTML = "";
    fields.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      indicatorSelect.appendChild(opt);
    });
  }

  if (indicatorSelect){
    indicatorSelect.addEventListener("change", () => setSelectedField(indicatorSelect.value));
  }

  // Robust GeoJSON loader:
  // 1) ?geo=FILE.geojson  (recommended)
  // 2) fallback candidates (handles spaces / encoding)
  function getGeoFromQuery(){
    const u = new URL(window.location.href);
    const g = u.searchParams.get("geo");
    return g ? g.trim() : "";
  }

  async function tryFetchJson(url, label){
    const r = await fetch(url);
    const tag = label || url;
    console.info("[DATA] fetch " + tag + " status=" + r.status);
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
    const json = await r.json();
    const features = json && Array.isArray(json.features) ? json.features.length : 0;
    const size = safeJsonSize(json);
    console.info("[DATA] " + tag + " loaded features=" + features + " bytes=" + size);
    return json;
  }

  async function fetchGeoJson(){
    // Axe socio-économique (chemin FIXE)
    return await tryFetchJson("data/axis/socioeco.geojson", "axis");
  }

  async function fetchBoundaryGeoJson(){
    // Limite province (chemin FIXE)
    return await tryFetchJson("data/boundaries/CT_FIGUIG.geojson", "boundary");
  }

  function addBoundaryLayer(fc){
    if (!map) return;
    if (boundaryLayer) map.removeLayer(boundaryLayer);
    boundaryLayer = L.geoJSON(fc, {
      pane: "boundaryPane",
      interactive: false,
      style: {
        color: "#000",
        weight: 3.5,
        opacity: 1,
        fill: false,
        fillOpacity: 0,
        lineCap: "round",
        lineJoin: "round"
      }
    }).addTo(map);
  }



  function getChefLieuName(props){
    const keys = ["chef_lieu_nom","chef_lieu","nom","name","libelle","LOCALITE","NOM","Nom"];
    for (const k of keys){
      if (props && props[k]) return String(props[k]).trim();
    }
    if (props){
      for (const [k, v] of Object.entries(props)){
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    return "";
  }

  async function loadChefLieuxLayer(map){
    if (!map) return;
    if (window.__chefLieuxLayer){
      try{ map.removeLayer(window.__chefLieuxLayer); } catch(_){ }
      window.__chefLieuxLayer = null;
    }
    try{
      const fc = await tryFetchJson("data/boundaries/chef_lieu.geojson", "chef_lieu");
      const features = fc && Array.isArray(fc.features) ? fc.features : [];
      const chefLieuIcon = L.icon({
        iconUrl: "assets/formes/red_star.png",
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      const layer = L.geoJSON(fc, {
        pointToLayer: (feature, latlng) => {
          const group = L.layerGroup();
          const marker = L.marker(latlng, { icon: chefLieuIcon, zIndexOffset: 1000 });
          group.addLayer(marker);
          const name = getChefLieuName(feature && feature.properties ? feature.properties : null);
          if (!name){
            console.warn("[CHEF_LIEU] missing name field for feature", feature && feature.properties ? feature.properties : feature);
          } else {
            const label = L.marker(latlng, {
              icon: L.divIcon({
                className: "chef-lieu-label-wrap",
                html: "<div class=\"chef-lieu-label\">" + escapeHtml(name) + "</div>"
              }),
              interactive: false,
              zIndexOffset: 1001
            });
            group.addLayer(label);
          }
          return group;
        }
      });
      window.__chefLieuxLayer = layer;
      layer.addTo(map);
      console.info("[CHEF_LIEU] loaded features=", features.length);
    } catch (err){
      console.warn("[CHEF_LIEU] failed to load", err);
    }
  }

  if (location.protocol !== "file:"){
    fetchGeoJson()
      .then(fc => {
        geojsonData = fc;
        const sampleFeature = Array.isArray(fc.features) ? fc.features.find((f) => f && f.properties) : null;
        axisSampleProps = sampleFeature ? sampleFeature.properties : null;
        if (axisSampleProps){
          console.info("[DATA] axis sample keys:", Object.keys(axisSampleProps));
        } else {
          console.info("[DATA] axis sample keys: none");
        }

      const fields = getNumericFields(fc);
      if (fields.length === 0){
        alert("Aucun champ numérique détecté dans ce GeoJSON.");
        return;
      }

      allFields = fields;

      const preferred = fields.includes("Pop2024") ? "Pop2024" :
                        fields.includes("Pop2014") ? "Pop2014" :
                        fields[0];

        populateIndicatorOptions(allFields);
        setSelectedField(preferred);
      })
      .catch(err => {
        console.error(err);
        alert(
        "Impossible de charger le GeoJSON.\n\n" +
        "Solutions rapides :\n" +
        "1) Place le .geojson dans le même dossier que index.html.\n" +
        "2) Ouvre avec un serveur local.\n" +
        "3) Recommandé : ajoute ?geo=NomDuFichier.geojson dans l’URL.\n\n" +
          "Exemple : http://localhost:8080/?geo=CT%20Figuig.geojson"
        );
      });

    fetchBoundaryGeoJson()
      .then(fc => { addBoundaryLayer(fc); loadChefLieuxLayer(map); })
      .catch(() => {});
  } else {
    console.info("Mode fichier detecte : chargement GeoJSON desactive (file://).");
  }

  if (typeof window !== "undefined"){
    window.__communeProfileDebug = window.__communeProfileDebug || {};
    window.__communeProfileDebug.computeCommuneCardModel = computeCommuneCardModel;
  }
  if (window) window.addEventListener("resize", () => setTimeout(() => { if (map) map.invalidateSize(); if (legendChart) legendChart.resize(); }, 120));
})();

// Side panel toggles (layout only)
  (() => {
    const side = document.getElementById("sidepanel");
    const btnToggle = document.getElementById("btnToggleSide");
    const btnCollapse = document.getElementById("btnCollapseSide");
    function toggleSide(){
      if (!side) return;
      side.classList.toggle("hidden");
      try{ window.dispatchEvent(new Event("resize")); }catch(_){}
    }
    if (btnToggle) btnToggle.addEventListener("click", toggleSide);
    if (btnCollapse) btnCollapse.addEventListener("click", toggleSide);
  })();

// file:// runtime guard (CORS)
  (() => {
    const banner = document.getElementById("fileProtocolBanner");
    const copyBat = document.getElementById("copyBat");
    const copyUrl = document.getElementById("copyUrl");

    const bat = "@echo off\n" +
      "cd /d D:\\webmapping-figuig\n" +
      "echo ===============================\n" +
      "echo  Serveur Web local (GeoJSON OK)\n" +
      "echo ===============================\n" +
      "python -m http.server 8080\n" +
      "pause";

    function copyText(t){
      if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(t);
      const ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return Promise.resolve();
    }

    if (location.protocol === "file:"){
      if (banner) banner.style.display = "block";
      // Avoid trying to fetch geojson in file mode: it will be blocked anyway.
      console.warn("[CORS] file:// mode detected. Use a local HTTP server.");
    }

    if (copyBat) copyBat.addEventListener("click", (e) => {
      e.preventDefault();
      copyText(bat).then(()=>alert("start_server.bat copié. Colle-le dans un fichier .bat puis exécute-le."));
    });

    if (copyUrl) copyUrl.addEventListener("click", (e) => {
      e.preventDefault();
      copyText("http://localhost:8080/").then(()=>alert("URL copiée : http://localhost:8080/"));
    });
  })();
