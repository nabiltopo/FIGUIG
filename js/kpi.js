// kpi.js - registry for commune KPI mapping (GeoJSON properties -> canonical keys).
(function(){
  "use strict";

  function coerceNumber(value){
    if (value === null || value === undefined) return NaN;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const raw = String(value).trim();
    if (!raw) return NaN;
    const cleaned = raw.replace(/\s+/g, "").replace("%", "").replace(",", ".");
    const n = Number(cleaned.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }

  // 1) Auto-list numeric KPI fields from a sample feature properties.
  function listNumericIndicators(sampleProps){
    if (!sampleProps || typeof sampleProps !== "object") return [];
    return Object.keys(sampleProps).filter((key) => {
      if (key === "Nom_Commun" || key === "Province") return false;
      return Number.isFinite(coerceNumber(sampleProps[key]));
    });
  }

  function clampPercent(value){
    if (!Number.isFinite(value)) return null;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return value;
  }

  function escapeSvgText(value){
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function polarToCartesian(cx, cy, r, angleDeg){
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + (r * Math.cos(rad)),
      y: cy - (r * Math.sin(rad))
    };
  }

  function arcPath(cx, cy, r, startAngle, endAngle){
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArc = Math.abs(endAngle - startAngle) <= 180 ? 0 : 1;
    return "M " + start.x.toFixed(2) + " " + start.y.toFixed(2) +
      " A " + r + " " + r + " 0 " + largeArc + " 0 " +
      end.x.toFixed(2) + " " + end.y.toFixed(2);
  }

  function renderGaugeSVG(options){
    const opts = options || {};
    const valueRaw = Number(opts.valuePct);
    const valuePct = clampPercent(valueRaw);
    const segments = Array.isArray(opts.segments) && opts.segments.length
      ? opts.segments
      : [
        { from: 0, to: 40, color: "#E53935" },
        { from: 40, to: 60, color: "#FB8C00" },
        { from: 60, to: 100, color: "#1B9E77" }
      ];
    const minLabel = opts.minLabel != null ? String(opts.minLabel) : "0";
    const maxLabel = opts.maxLabel != null ? String(opts.maxLabel) : "100";
    const centerLabel = opts.centerLabel != null ? String(opts.centerLabel) : "";
    const subLabel = opts.subLabel != null ? String(opts.subLabel) : "";
    const ariaLabel = opts.ariaLabel != null
      ? String(opts.ariaLabel)
      : (centerLabel ? (centerLabel + " " + (Number.isFinite(valueRaw) ? valueRaw : "")) : "Gauge");

    const width = Number(opts.width) || 220;
    const height = Number(opts.height) || 130;
    const cx = width / 2;
    const cy = height - 12;
    const radius = Math.min(width / 2 - 8, height - 20);
    const stroke = Math.max(10, Math.round(radius * 0.18));
    const gapDeg = Number.isFinite(opts.gapDeg) ? opts.gapDeg : 2;

    const pctToAngle = (pct) => 180 - (pct / 100) * 180;

    let svg =
      "<svg class=\"variance-gauge\" viewBox=\"0 0 " + width + " " + height +
      "\" role=\"img\" aria-label=\"" + escapeSvgText(ariaLabel) + "\">";

    svg += "<g fill=\"none\" stroke-linecap=\"butt\">";
    segments.forEach((seg) => {
      const from = clampPercent(Number(seg.from));
      const to = clampPercent(Number(seg.to));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
      let startAngle = pctToAngle(from);
      let endAngle = pctToAngle(to);
      startAngle = startAngle - gapDeg / 2;
      endAngle = endAngle + gapDeg / 2;
      if (startAngle <= endAngle) return;
      const path = arcPath(cx, cy, radius, startAngle, endAngle);
      svg += "<path d=\"" + path + "\" stroke=\"" + (seg.color || "#e5e7eb") +
        "\" stroke-width=\"" + stroke + "\" />";
    });
    svg += "</g>";

    if (Number.isFinite(valuePct)){
      const angle = pctToAngle(valuePct);
      const needleLen = radius - stroke / 2 - 2;
      const needle = polarToCartesian(cx, cy, needleLen, angle);
      svg += "<line x1=\"" + cx.toFixed(2) + "\" y1=\"" + cy.toFixed(2) +
        "\" x2=\"" + needle.x.toFixed(2) + "\" y2=\"" + needle.y.toFixed(2) +
        "\" stroke=\"#111827\" stroke-width=\"2\" />";
    }
    svg += "<circle cx=\"" + cx.toFixed(2) + "\" cy=\"" + cy.toFixed(2) +
      "\" r=\"4\" fill=\"#111827\" />";

    const valueText = Number.isFinite(valueRaw) ? Math.round(valueRaw) + "%" : "\u2014";
    const valueY = cy - radius * 0.55;
    svg += "<text x=\"" + cx.toFixed(2) + "\" y=\"" + valueY.toFixed(2) +
      "\" text-anchor=\"middle\" font-size=\"16\" font-weight=\"800\" fill=\"#111827\">" +
      escapeSvgText(valueText) + "</text>";

    if (centerLabel){
      svg += "<text x=\"" + cx.toFixed(2) + "\" y=\"" + (valueY + 16).toFixed(2) +
        "\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"#374151\">" +
        escapeSvgText(centerLabel) + "</text>";
    }
    if (subLabel){
      svg += "<text x=\"" + cx.toFixed(2) + "\" y=\"" + (valueY + 30).toFixed(2) +
        "\" text-anchor=\"middle\" font-size=\"10\" font-weight=\"600\" fill=\"#6b7280\">" +
        escapeSvgText(subLabel) + "</text>";
    }

    const minPos = polarToCartesian(cx, cy, radius, 180);
    const maxPos = polarToCartesian(cx, cy, radius, 0);
    const labelY = cy + 12;
    svg += "<text x=\"" + minPos.x.toFixed(2) + "\" y=\"" + labelY +
      "\" text-anchor=\"start\" font-size=\"10\" fill=\"#6b7280\">" +
      escapeSvgText(minLabel) + "</text>";
    svg += "<text x=\"" + maxPos.x.toFixed(2) + "\" y=\"" + labelY +
      "\" text-anchor=\"end\" font-size=\"10\" fill=\"#6b7280\">" +
      escapeSvgText(maxLabel) + "</text>";

    if (Array.isArray(opts.ticks)){
      opts.ticks.forEach((tick) => {
        const val = clampPercent(Number(tick.value));
        if (!Number.isFinite(val) || val <= 0 || val >= 100) return;
        const angle = pctToAngle(val);
        const pos = polarToCartesian(cx, cy, radius + stroke / 2 + 6, angle);
        svg += "<text x=\"" + pos.x.toFixed(2) + "\" y=\"" + (pos.y - 2).toFixed(2) +
          "\" text-anchor=\"middle\" font-size=\"9\" fill=\"#9ca3af\">" +
          escapeSvgText(tick.label) + "</text>";
      });
    }

    svg += "</svg>";
    return svg;
  }

  const KPI_ICON_BASE = "assets/icons";
  const KPI_ICON_FALLBACK = KPI_ICON_BASE + "/emploi.png";

  // 2) Canonical KPI registry (10 indicators from socioeco.geojson).
  const KPI_REGISTRY = {
    population: {
      label: "Population 2024",
      prop: "Population 2024",
      unit: "hab",
      type: "count",
      format: "int",
      direction: "higher_is_better",
      palette: "blue",
      familyId: "demo",
      iconFile: "emploi.png"
    },
    pauvrete: {
      label: "Taux de pauvreté",
      prop: "Taux de pauvreté (en %)",
      unit: "%",
      type: "percent",
      format: "percent(1)",
      direction: "higher_is_worse",
      palette: "traffic",
      familyId: "socio",
      iconFile: "taux-pauverete.png"
    },
    chomage: {
      label: "Taux de chômage",
      prop: "Taux de chômage (%)",
      unit: "%",
      type: "percent",
      format: "percent(1)",
      direction: "higher_is_worse",
      palette: "traffic",
      familyId: "socio",
      iconFile: "taux-chaumage.png"
    },
    analphabetisme: {
      label: "Taux d'analphabétisme",
      prop: "Taux d'analphabétisme  (%)",
      unit: "%",
      type: "percent",
      format: "percent(1)",
      direction: "higher_is_worse",
      palette: "traffic",
      familyId: "socio",
      iconFile: "taux-analphabetisme.png"
    },
    eau: {
      label: "Eau courante",
      prop: "Eau courante (%)",
      unit: "%",
      type: "percent",
      format: "percent(1)",
      direction: "higher_is_better",
      palette: "traffic",
      familyId: "services",
      iconFile: "eau-potable.png"
    },
    electricite: {
      label: "Électricité",
      prop: "Électricité (%)",
      unit: "%",
      type: "percent",
      format: "percent(1)",
      direction: "higher_is_better",
      palette: "traffic",
      familyId: "services",
      iconFile: "electricite.png"
    },
    assainissement: {
      label: "Accès à l'assainissement",
      prop: "Accès_à_Assainissement",
      unit: "%",
      type: "percent",
      format: "percent(1)",
      direction: "higher_is_better",
      palette: "traffic",
      familyId: "services",
      iconFile: "Assainissement.png"
    },
    activite: {
      label: "Taux d'activité",
      prop: "Taux d'activité (%)",
      unit: "%",
      type: "percent",
      format: "percent(1)",
      direction: "higher_is_better",
      palette: "traffic",
      familyId: "capital",
      iconFile: "Taux-activite.png"
    },
    scolarisation: {
      label: "Taux de scolarisation",
      prop: "Taux de scolarisation (%)",
      unit: "%",
      type: "percent",
      format: "percent(1)",
      direction: "higher_is_better",
      palette: "traffic",
      familyId: "capital",
      iconFile: "Taux-scolarisation.png"
    },
    vulnerabilite: {
      label: "Taux de vulnérabilité",
      prop: "Taux de vulnérabilité (en %)",
      unit: "%",
      type: "percent",
      format: "percent(1)",
      direction: "higher_is_worse",
      palette: "traffic",
      familyId: "socio",
      iconFile: "taux-vulnirabilite.png"
    },
  };
  const KPI_ORDER = [
    "pauvrete",
    "chomage",
    "analphabetisme",
    "vulnerabilite",
    "eau",
    "electricite",
    "assainissement",
    "scolarisation",
    "activite",
    "population"
  ];

  function getKpiIconUrl(kpiKey){
    const entry = KPI_REGISTRY[kpiKey];
    if (entry && entry.iconFile) return KPI_ICON_BASE + "/" + entry.iconFile;
    return KPI_ICON_FALLBACK;
  }

  // Expose for app.js (non-module).
  if (typeof window !== "undefined"){
    window.KPI_REGISTRY = KPI_REGISTRY;
    window.KPI_ORDER = KPI_ORDER;
    window.listNumericIndicators = listNumericIndicators;
    window.getKpiIconUrl = getKpiIconUrl;
    window.KPI_ICON_FALLBACK = KPI_ICON_FALLBACK;
    window.renderGaugeSVG = renderGaugeSVG;
  }
})();
