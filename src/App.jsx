import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, ReferenceLine,
  Tooltip, PieChart, Pie,
} from "recharts";
import {
  Flame, LayoutDashboard, ReceiptText, Lightbulb, Settings as SettingsIcon,
  BookOpen, Plus, Trash2, X, ArrowUpRight, ArrowDownRight, Plane, Car, Zap,
  UtensilsCrossed, ShoppingBag, Shapes, Download, Search, Check, ArrowRight,
  Target, TrendingUp, Info, Sparkles,
} from "lucide-react";

/* ============================================================ storage
   Works in two environments: artifact runtime (window.storage) and a normal
   browser deployment (localStorage). Prefer window.storage when present. */
const KEYS = { entries: "cinder:entries:v2", settings: "cinder:settings:v2", entered: "cinder:entered:v2" };
async function loadKey(key, fallback) {
  try {
    if (typeof window !== "undefined" && window.storage) {
      const r = await window.storage.get(key);
      return r && r.value != null ? JSON.parse(r.value) : fallback;
    }
    const raw = window.localStorage.getItem(key);
    return raw != null ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
async function saveKey(key, val) {
  try {
    if (typeof window !== "undefined" && window.storage) { await window.storage.set(key, JSON.stringify(val)); return; }
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch { /* keep in memory */ }
}

/* ============================================================ domain model */
const CATS = {
  travel:    { label: "Travel", color: "#0F766E", icon: Plane, unit: "km" },
  energy:    { label: "Energy", color: "#3B6EA5", icon: Zap, unit: "kWh" },
  food:      { label: "Food", color: "#C9892F", icon: UtensilsCrossed, unit: "meal" },
  purchases: { label: "Purchases", color: "#A65D57", icon: ShoppingBag, unit: "item" },
  other:     { label: "Other", color: "#64748B", icon: Shapes, unit: "unit" },
};
const CAT_ORDER = ["travel", "energy", "food", "purchases", "other"];

// kg CO2e per unit. Sources: UK DEFRA 2024 conversion factors, US EPA, Our World in Data.
const FACTORS = {
  travel: {
    flight_short: { label: "Flight · short-haul", f: 0.246 },
    flight_long:  { label: "Flight · long-haul", f: 0.180 },
    car_petrol:   { label: "Car · petrol", f: 0.192 },
    car_diesel:   { label: "Car · diesel", f: 0.171 },
    car_ev:       { label: "Car · electric", f: 0.053 },
    motorbike:    { label: "Motorbike", f: 0.103 },
    bus:          { label: "Bus", f: 0.097 },
    train:        { label: "Train / metro", f: 0.035 },
    walk_cycle:   { label: "Walk / cycle", f: 0 },
  },
  energy: {
    electricity:  { label: "Electricity", f: 0.41 },
    natural_gas:  { label: "Natural gas", f: 0.184 },
  },
  food: {
    beef:       { label: "Beef meal", f: 6.6 },
    lamb:       { label: "Lamb meal", f: 5.8 },
    cheese:     { label: "Cheese-heavy meal", f: 2.5 },
    pork:       { label: "Pork meal", f: 1.7 },
    poultry:    { label: "Chicken meal", f: 1.6 },
    fish:       { label: "Fish meal", f: 1.4 },
    eggs:       { label: "Egg meal", f: 0.9 },
    vegetarian: { label: "Vegetarian meal", f: 0.5 },
    vegan:      { label: "Vegan meal", f: 0.4 },
  },
  purchases: {
    general_spend: { label: "General purchase", f: 0.45, unit: "$" },
    tshirt:        { label: "T-shirt", f: 7 },
    jeans:         { label: "Jeans", f: 25 },
    shoes:         { label: "Pair of shoes", f: 14 },
    elec_small:    { label: "Small electronics", f: 50 },
    elec_large:    { label: "Large appliance", f: 300 },
    book:          { label: "Book", f: 1 },
  },
  other: {
    custom: { label: "Custom entry", f: 1, unit: "kg CO₂e" },
  },
};
const unitOf = (cat, type) => FACTORS[cat]?.[type]?.unit || CATS[cat].unit;
const factorOf = (cat, type) => FACTORS[cat]?.[type]?.f ?? 0;

/* ============================================================ helpers */
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ymd = (d) => d.toLocaleDateString("en-CA");
const parseYMD = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const mkEntry = (cat, type, amount, date) => ({ id: rid(), cat, type, amount: +amount, date, co2: +(factorOf(cat, type) * amount).toFixed(3) });

function fmt(kg, units = "kg") {
  if (units === "t") return (kg / 1000).toFixed(kg >= 10000 ? 1 : 2);
  if (kg >= 100) return Math.round(kg).toLocaleString();
  if (kg >= 10) return kg.toFixed(0);
  return kg.toFixed(1);
}
const unitLabel = (units = "kg") => (units === "t" ? "t CO₂e" : "kg CO₂e");

const RANGES = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];
function getRange(key, entries) {
  const now = new Date();
  const today = startOfDay(now);
  const end = addDays(today, 1);
  let start, prevStart = null, prevEnd = null, bucket = "day", label = "";
  if (key === "7d") { start = addDays(today, -6); prevEnd = start; prevStart = addDays(start, -7); label = "the last 7 days"; }
  else if (key === "30d") { start = addDays(today, -29); prevEnd = start; prevStart = addDays(start, -30); label = "the last 30 days"; }
  else if (key === "month") { start = new Date(now.getFullYear(), now.getMonth(), 1); prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1); prevEnd = start; label = "this month"; }
  else if (key === "year") { start = new Date(now.getFullYear(), 0, 1); prevStart = new Date(now.getFullYear() - 1, 0, 1); prevEnd = start; bucket = "month"; label = "this year"; }
  else {
    const earliest = entries.length ? entries.reduce((a, e) => (e.date < a ? e.date : a), entries[0].date) : ymd(today);
    start = startOfDay(parseYMD(earliest)); bucket = "month"; label = "all time";
  }
  return { start, end, prevStart, prevEnd, bucket, label, key };
}
const inRange = (e, start, end) => { const t = parseYMD(e.date).getTime(); return t >= start.getTime() && t < end.getTime(); };

function buildSeries(entries, r) {
  const out = [];
  if (r.bucket === "day") {
    for (let d = new Date(r.start); d < r.end; d = addDays(d, 1)) {
      const key = ymd(d);
      const total = entries.filter((e) => e.date === key).reduce((s, e) => s + e.co2, 0);
      out.push({ label: d.toLocaleDateString("en-US", { day: "numeric", month: r.key === "7d" ? "short" : undefined }), total: +total.toFixed(2), date: key });
    }
  } else {
    const first = new Date(r.start.getFullYear(), r.start.getMonth(), 1);
    for (let d = first; d < r.end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const total = entries.filter((e) => { const t = parseYMD(e.date); return t >= d && t < mEnd; }).reduce((s, e) => s + e.co2, 0);
      out.push({ label: d.toLocaleDateString("en-US", { month: "short" }), total: +total.toFixed(2) });
    }
  }
  return out;
}
function catTotals(entries) {
  const t = {};
  for (const e of entries) t[e.cat] = (t[e.cat] || 0) + e.co2;
  return t;
}
function typeTotals(entries) {
  const t = {};
  for (const e of entries) { const k = e.cat + ":" + e.type; (t[k] ||= { cat: e.cat, type: e.type, co2: 0, count: 0 }); t[k].co2 += e.co2; t[k].count++; }
  return Object.values(t).sort((a, b) => b.co2 - a.co2);
}

function sampleEntries() {
  const out = [];
  const today = startOfDay(new Date());
  const meals = ["poultry", "vegetarian", "beef", "vegan", "pork", "fish", "vegetarian"];
  for (let i = 0; i < 35; i++) {
    const date = ymd(addDays(today, -i));
    out.push(mkEntry("energy", "electricity", 6 + (i % 5), date));
    out.push(mkEntry("food", meals[i % meals.length], 1, date));
    if (i % 2 === 0) out.push(mkEntry("food", "vegetarian", 1, date));
    const dow = addDays(today, -i).getDay();
    if (dow >= 1 && dow <= 5) out.push(mkEntry("travel", "car_petrol", 18 + (i % 6), date));
    else out.push(mkEntry("travel", "train", 12, date));
  }
  out.push(mkEntry("travel", "flight_short", 1100, ymd(addDays(today, -20))));
  out.push(mkEntry("purchases", "general_spend", 60, ymd(addDays(today, -8))));
  out.push(mkEntry("purchases", "tshirt", 2, ymd(addDays(today, -14))));
  out.push(mkEntry("purchases", "elec_small", 1, ymd(addDays(today, -3))));
  return out;
}

function exportCSV(entries) {
  const head = ["Date", "Category", "Activity", "Amount", "Unit", "CO2e_kg"];
  const rows = entries.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((e) => [
    e.date, CATS[e.cat].label, FACTORS[e.cat][e.type].label, e.amount, unitOf(e.cat, e.type), e.co2.toFixed(2),
  ]);
  const csv = [head, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "cinder-activities.csv"; a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================ styles */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
.cinder *{box-sizing:border-box;}
.cinder{
  --ink:#111827; --ink-2:#374151; --sub:#6B7280; --line:#E6E9E7; --line-2:#EEF1EF;
  --bg:#F4F6F4; --surface:#FFFFFF; --brand:#0F766E; --brand-2:#0E6B63; --brand-soft:#E2F0ED;
  --good:#15803D; --warn:#C2410C; --danger:#B91C1C; --amber:#C9892F;
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  color:var(--ink); background:var(--bg); min-height:100vh; line-height:1.45;
  font-variant-numeric:tabular-nums;
}
.wrap{max-width:1000px;margin:0 auto;padding:0 18px;}
.num{font-variant-numeric:tabular-nums;letter-spacing:-0.01em;}

/* header + nav */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 0 14px;}
.brand{display:flex;align-items:center;gap:10px;cursor:pointer;}
.mark{width:34px;height:34px;border-radius:9px;background:var(--brand);display:grid;place-items:center;flex-shrink:0;}
.brand h1{font-size:19px;font-weight:700;letter-spacing:-0.02em;margin:0;line-height:1;}
.brand p{font-size:11px;color:var(--sub);margin:2px 0 0;}
.tabs{display:flex;gap:4px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:5px;}
.tab{display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:8px;border:none;background:transparent;
  color:var(--sub);font-weight:500;font-size:13.5px;cursor:pointer;font-family:inherit;transition:background .15s,color .15s;white-space:nowrap;}
.tab:hover{color:var(--ink);}
.tab.active{background:var(--brand);color:#fff;font-weight:600;}
.tab .lbl{display:inline;}
.tabwrap{position:sticky;top:8px;z-index:20;}

/* cards */
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;}
.pad{padding:18px;}
.eyebrow{font-size:11px;letter-spacing:0.13em;text-transform:uppercase;color:var(--sub);font-weight:600;}
.grid{display:grid;gap:14px;}
.cols-4{grid-template-columns:repeat(4,1fr);}
.cols-2{grid-template-columns:1fr 1fr;}
.split{display:grid;gap:14px;grid-template-columns:1.4fr 1fr;}

/* buttons + inputs */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:10px;font-family:inherit;
  font-size:13.5px;font-weight:600;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);padding:9px 14px;transition:filter .15s,background .15s;}
.btn:hover{background:var(--line-2);}
.btn.primary{background:var(--brand);border-color:var(--brand);color:#fff;}
.btn.primary:hover{filter:brightness(1.06);background:var(--brand);}
.btn.danger{color:var(--danger);border-color:#F1D6D3;background:#fff;}
.btn.danger:hover{background:#FBEDEB;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.input,.select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);font-size:14px;
  font-family:inherit;color:var(--ink);background:var(--surface);outline:none;}
.input:focus,.select:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft);}
.lbl{display:block;font-size:12px;font-weight:600;color:var(--sub);margin-bottom:6px;}
.seg{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:3px;gap:2px;}
.seg button{border:none;background:transparent;padding:6px 11px;border-radius:7px;font-size:12.5px;font-weight:600;color:var(--sub);cursor:pointer;font-family:inherit;}
.seg button.on{background:var(--ink);color:#fff;}

/* stat cards */
.stat .k{font-size:11.5px;color:var(--sub);font-weight:500;}
.stat .v{font-size:27px;font-weight:800;letter-spacing:-0.02em;margin-top:6px;line-height:1;}
.stat .v small{font-size:13px;font-weight:600;color:var(--sub);margin-left:4px;letter-spacing:0;}
.delta{display:inline-flex;align-items:center;gap:3px;font-size:12px;font-weight:700;margin-top:8px;}
.delta.up{color:var(--warn);} .delta.down{color:var(--good);}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;margin-top:8px;}
.dot{width:9px;height:9px;border-radius:3px;flex-shrink:0;}
.minibar{height:7px;border-radius:5px;background:var(--bg);overflow:hidden;margin-top:10px;}
.minibar > div{height:100%;border-radius:5px;}

/* table / ledger */
.ledger{width:100%;border-collapse:collapse;font-size:13.5px;}
.ledger th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--sub);font-weight:600;padding:0 12px 10px;}
.ledger td{padding:12px;border-top:1px solid var(--line-2);vertical-align:middle;}
.ledger tr.row{cursor:pointer;}
.ledger tr.row:hover td{background:var(--line-2);}
.ledger .right{text-align:right;}
.tag{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:3px 9px;border-radius:20px;}
.icwrap{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;flex-shrink:0;}

/* donut center */
.donut{position:relative;}
.donut .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;}
.donut .center b{font-size:24px;font-weight:800;letter-spacing:-0.02em;}
.donut .center span{font-size:11px;color:var(--sub);}

/* sheet / modal */
.scrim{position:fixed;inset:0;background:rgba(17,24,39,.45);z-index:50;display:flex;justify-content:flex-end;}
.sheet{background:var(--surface);width:440px;max-width:100%;height:100%;overflow-y:auto;padding:22px;animation:slidein .22s ease;}
@keyframes slidein{from{transform:translateX(24px);opacity:.6;}to{transform:none;opacity:1;}}
.sheet-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
.iconbtn{border:none;background:transparent;cursor:pointer;color:var(--sub);padding:6px;border-radius:8px;display:grid;place-items:center;}
.iconbtn:hover{background:var(--line-2);color:var(--ink);}

/* landing */
.hero{display:grid;grid-template-columns:1.1fr 1fr;gap:36px;align-items:center;padding:46px 0 30px;}
.hero h2{font-size:46px;line-height:1.03;font-weight:800;letter-spacing:-0.03em;margin:0 0 16px;}
.hero p.sub{font-size:17px;color:var(--ink-2);margin:0 0 24px;max-width:30em;}
.cta-row{display:flex;gap:12px;flex-wrap:wrap;}
.btn.lg{padding:13px 20px;font-size:15px;border-radius:12px;}
.trust{font-size:12.5px;color:var(--sub);margin-top:20px;display:flex;gap:14px;flex-wrap:wrap;}
.trust span{display:inline-flex;align-items:center;gap:6px;}
.section{padding:34px 0;}
.section h3{font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:var(--sub);font-weight:700;margin:0 0 20px;}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
.step .n{font-size:12px;font-weight:800;color:var(--brand);letter-spacing:0.08em;}
.step h4{margin:8px 0 6px;font-size:17px;font-weight:700;letter-spacing:-0.01em;}
.step p{margin:0;color:var(--sub);font-size:14px;}
.feat{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.badges{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;}
.badge{font-size:12.5px;font-weight:600;color:var(--ink-2);background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:6px 12px;}
.footer{border-top:1px solid var(--line);margin-top:24px;padding:24px 0 40px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;color:var(--sub);font-size:13px;}
.footer a{color:var(--ink-2);text-decoration:none;cursor:pointer;}
.footer a:hover{color:var(--brand);}

/* preview mock for hero */
.mock{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;box-shadow:0 20px 40px -28px rgba(15,118,110,.4);}
.mock .row{display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:7px 0;border-top:1px solid var(--line-2);}
.mock .row:first-of-type{border-top:none;}

.empty{text-align:center;padding:46px 26px;}
.empty .badge-ic{width:54px;height:54px;border-radius:14px;background:var(--brand-soft);display:grid;place-items:center;margin:0 auto 14px;}
.empty h3{font-size:22px;font-weight:700;letter-spacing:-0.01em;margin:0 0 8px;}
.empty p{color:var(--sub);font-size:14.5px;max-width:380px;margin:0 auto 20px;}

a.link{color:var(--brand);font-weight:600;text-decoration:none;cursor:pointer;}
.method td,.method th{padding:9px 10px;border-bottom:1px solid var(--line-2);font-size:13px;text-align:left;}
.method th{color:var(--sub);font-size:11px;text-transform:uppercase;letter-spacing:0.07em;}

@media (max-width:820px){
  .split{grid-template-columns:1fr;}
  .cols-4{grid-template-columns:1fr 1fr;}
  .hero{grid-template-columns:1fr;gap:22px;padding:30px 0 10px;}
  .hero h2{font-size:34px;}
  .steps{grid-template-columns:1fr;}
  .feat{grid-template-columns:1fr;}
  .hero .mock{display:none;}
}
@media (max-width:640px){
  .wrap{padding:0 12px 90px;}
  .tabwrap{position:fixed;left:0;right:0;bottom:0;top:auto;z-index:40;padding:8px 12px calc(8px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 30%);}
  .tabs{justify-content:space-around;box-shadow:0 -2px 16px -8px rgba(0,0,0,.2);}
  .tab .lbl{display:none;}
  .tab{flex:1;justify-content:center;padding:10px 6px;}
  .cols-4{grid-template-columns:1fr 1fr;}
  .sheet{width:100%;}
  .ledger .hide-sm{display:none;}
}
`;

/* ============================================================ small components */
const Card = ({ children, className = "", style }) => (
  <div className={"card " + className} style={style}>{children}</div>
);

function StatCard({ k, value, units, delta, chip, bar }) {
  return (
    <Card className="pad stat">
      <div className="k">{k}</div>
      {value !== undefined && (
        <div className="v num">{value}{units && <small>{units}</small>}</div>
      )}
      {delta !== undefined && delta !== null && (
        <div className={"delta " + (delta >= 0 ? "up" : "down")}>
          {delta >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {Math.abs(delta)}% vs previous
        </div>
      )}
      {chip}
      {bar && (
        <>
          <div className="minibar"><div style={{ width: `${Math.min(100, bar.pct)}%`, background: bar.color }} /></div>
          <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 6 }}>{bar.note}</div>
        </>
      )}
    </Card>
  );
}

function CatTag({ cat }) {
  const c = CATS[cat];
  return <span className="tag" style={{ background: c.color + "1A", color: c.color }}><span className="dot" style={{ background: c.color }} />{c.label}</span>;
}

/* ============================================================ APP */
export default function App() {
  const [view, setView] = useState("dashboard");
  const [entered, setEntered] = useState(true);
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState({ name: "", units: "kg", monthlyBudget: 250, defaultRange: "month" });
  const [range, setRange] = useState("month");
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const [e, s, ent] = await Promise.all([
        loadKey(KEYS.entries, []),
        loadKey(KEYS.settings, {}),
        loadKey(KEYS.entered, false),
      ]);
      const merged = { name: "", units: "kg", monthlyBudget: 250, defaultRange: "month", ...s };
      setEntries(Array.isArray(e) ? e : []);
      setSettings(merged);
      setRange(merged.defaultRange || "month");
      setEntered(!!ent);
      setLoading(false);
      hydrated.current = true;
    })();
  }, []);
  useEffect(() => { if (hydrated.current) saveKey(KEYS.entries, entries); }, [entries]);
  useEffect(() => { if (hydrated.current) saveKey(KEYS.settings, settings); }, [settings]);
  useEffect(() => { if (hydrated.current) saveKey(KEYS.entered, entered); }, [entered]);

  const addEntry = (cat, type, amount, date) => {
    const amt = parseFloat(amount);
    if (!type || !(amt > 0) || !date) return false;
    setEntries((p) => [mkEntry(cat, type, amt, date), ...p]);
    return true;
  };
  const deleteEntry = (id) => { setEntries((p) => p.filter((e) => e.id !== id)); setDetail(null); };
  const duplicateEntry = (e) => { setEntries((p) => [mkEntry(e.cat, e.type, e.amount, ymd(new Date())), ...p]); setDetail(null); };
  const loadSample = () => { setEntries(sampleEntries()); setEntered(true); setView("dashboard"); };
  const enterApp = () => { setEntered(true); setView("dashboard"); };

  const units = settings.units;

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "activities", label: "Activities", icon: ReceiptText },
    { id: "insights", label: "Insights", icon: Lightbulb },
    { id: "settings", label: "Settings", icon: SettingsIcon },
    { id: "about", label: "About", icon: BookOpen },
  ];

  if (loading) {
    return (
      <div className="cinder"><style>{CSS}</style>
        <div className="wrap"><Card className="pad" style={{ marginTop: 40, textAlign: "center", color: "var(--sub)" }}>Opening your ledger…</Card></div>
      </div>
    );
  }

  if (!entered) {
    return (
      <div className="cinder"><style>{CSS}</style>
        <Landing onEnter={enterApp} onSample={loadSample} onAbout={() => { setEntered(true); setView("about"); }} />
      </div>
    );
  }

  return (
    <div className="cinder"><style>{CSS}</style>
      <div className="wrap">
        <header className="hdr">
          <div className="brand" onClick={() => setView("dashboard")}>
            <div className="mark"><Flame size={19} color="#fff" strokeWidth={2.2} /></div>
            <div><h1>Cinder</h1><p>carbon ledger</p></div>
          </div>
          <button className="btn primary" onClick={() => setAddOpen(true)}><Plus size={16} /> Add activity</button>
        </header>

        <div className="tabwrap">
          <nav className="tabs">
            {NAV.map((n) => {
              const Icon = n.icon; const on = view === n.id;
              return (
                <button key={n.id} className={"tab" + (on ? " active" : "")} onClick={() => setView(n.id)}>
                  <Icon size={16} strokeWidth={2.1} /><span className="lbl">{n.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <main style={{ marginTop: 18 }}>
          {view === "dashboard" && <Dashboard {...{ entries, range, setRange, units, settings, setView, setAddOpen, setDetail }} />}
          {view === "activities" && <Activities {...{ entries, units, setAddOpen, setDetail }} />}
          {view === "insights" && <Insights {...{ entries, range, setRange, units, settings, setAddOpen }} />}
          {view === "settings" && <SettingsView {...{ settings, setSettings, entries, loadSample, clearAll: () => setEntries([]) }} />}
          {view === "about" && <About />}
        </main>

        <footer className="footer">
          <span>Cinder — an experimental project exploring personal carbon accounting.</span>
          <span><a onClick={() => setView("about")}>Methodology</a> · Private by default · Your data is yours</span>
        </footer>
      </div>

      {addOpen && <AddActivity onClose={() => setAddOpen(false)} onAdd={addEntry} units={units} />}
      {detail && <DetailSheet entry={detail} units={units} onClose={() => setDetail(null)} onDelete={deleteEntry} onDuplicate={duplicateEntry} />}
    </div>
  );
}

/* ============================================================ LANDING */
function Landing({ onEnter, onSample, onAbout }) {
  return (
    <div className="wrap">
      <header className="hdr">
        <div className="brand" onClick={onEnter}>
          <div className="mark"><Flame size={19} color="#fff" strokeWidth={2.2} /></div>
          <div><h1>Cinder</h1><p>carbon ledger</p></div>
        </div>
        <button className="btn" onClick={onAbout}>How it works</button>
      </header>

      <section className="hero">
        <div>
          <h2>Your carbon footprint, finally visible.</h2>
          <p className="sub">Log your daily activities, see their carbon impact, and get nudges to do better over time. Built for individuals and small teams who want clarity, not guilt.</p>
          <div className="cta-row">
            <button className="btn primary lg" onClick={onEnter}>Open the ledger <ArrowRight size={17} /></button>
            <button className="btn lg" onClick={onSample}><Sparkles size={16} /> View sample data</button>
          </div>
          <div className="trust">
            <span><Check size={14} color="var(--brand)" /> Private by default</span>
            <span><Check size={14} color="var(--brand)" /> No ads</span>
            <span><Check size={14} color="var(--brand)" /> Your data is yours</span>
          </div>
        </div>
        <div className="mock">
          <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase" }}>This month</div>
          <div className="num" style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-.02em", margin: "4px 0 2px" }}>142<small style={{ fontSize: 14, color: "var(--sub)", marginLeft: 5 }}>kg CO₂e</small></div>
          <div className="delta down" style={{ marginTop: 0 }}><ArrowDownRight size={14} /> 12% vs last month</div>
          <div style={{ marginTop: 14 }}>
            {[["Travel", 0.58, "#0F766E"], ["Food", 0.22, "#C9892F"], ["Energy", 0.14, "#3B6EA5"], ["Purchases", 0.06, "#A65D57"]].map(([l, w, c]) => (
              <div className="row" key={l}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="dot" style={{ background: c }} />{l}</span>
                <span className="num" style={{ fontWeight: 600 }}>{Math.round(142 * w)} kg</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <h3>How it works</h3>
        <div className="steps">
          {[
            ["Step 1", "Log activities", "Flights, rides, purchases, energy use — add them in seconds."],
            ["Step 2", "See the impact", "We convert them into estimated CO₂e using transparent, open methodologies."],
            ["Step 3", "Act on insights", "Spot patterns, set a carbon budget, and track progress over time."],
          ].map(([n, h, p]) => (
            <Card className="pad step" key={n}>
              <div className="n">{n}</div><h4>{h}</h4><p>{p}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="section">
        <h3>What you get</h3>
        <div className="feat">
          {[
            [ReceiptText, "Carbon ledger", "A clean, filterable list of every carbon-impacting activity."],
            [TrendingUp, "Trends & charts", "Weekly and monthly emissions, broken down by category."],
            [Target, "Goals & limits", "Set a monthly carbon budget and see how you're tracking."],
            [Info, "Transparency", "Every estimate shows the underlying emission factor and source."],
          ].map(([Ic, h, p]) => (
            <Card className="pad" key={h} style={{ display: "flex", gap: 13 }}>
              <div className="icwrap" style={{ background: "var(--brand-soft)" }}><Ic size={18} color="var(--brand)" /></div>
              <div><div style={{ fontWeight: 700, fontSize: 15 }}>{h}</div><div style={{ color: "var(--sub)", fontSize: 13.5, marginTop: 3 }}>{p}</div></div>
            </Card>
          ))}
        </div>
        <div className="badges">
          <span className="badge">Individuals</span>
          <span className="badge">Climate-conscious teams</span>
          <span className="badge">Sustainability nerds</span>
        </div>
        <p style={{ color: "var(--sub)", fontSize: 13, marginTop: 14 }}>Upcoming: team workspaces, CSV import, API access.</p>
      </section>

      <footer className="footer">
        <span>Cinder — an experimental project exploring personal carbon accounting.</span>
        <span><a onClick={onAbout}>Methodology</a> · <a onClick={onEnter}>Open the ledger</a></span>
      </footer>
    </div>
  );
}

/* ============================================================ DASHBOARD */
function RangeSelect({ range, setRange }) {
  return (
    <div className="seg">
      {RANGES.map((r) => (
        <button key={r.key} className={range === r.key ? "on" : ""} onClick={() => setRange(r.key)}>{r.label}</button>
      ))}
    </div>
  );
}

function Dashboard({ entries, range, setRange, units, settings, setView, setAddOpen, setDetail }) {
  const r = useMemo(() => getRange(range, entries), [range, entries]);
  const inP = useMemo(() => entries.filter((e) => inRange(e, r.start, r.end)), [entries, r]);
  const prevP = useMemo(() => (r.prevStart ? entries.filter((e) => inRange(e, r.prevStart, r.prevEnd)) : []), [entries, r]);
  const total = inP.reduce((s, e) => s + e.co2, 0);
  const prevTotal = prevP.reduce((s, e) => s + e.co2, 0);
  const delta = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
  const ct = catTotals(inP);
  const topCat = Object.keys(ct).sort((a, b) => ct[b] - ct[a])[0];
  const series = useMemo(() => buildSeries(entries, r), [entries, r]);

  // monthly budget progress (current calendar month)
  const mr = getRange("month", entries);
  const monthTotal = entries.filter((e) => inRange(e, mr.start, mr.end)).reduce((s, e) => s + e.co2, 0);
  const budgetPct = settings.monthlyBudget > 0 ? (monthTotal / settings.monthlyBudget) * 100 : 0;

  if (entries.length === 0) {
    return (
      <Card className="empty">
        <div className="badge-ic"><ReceiptText size={24} color="var(--brand)" /></div>
        <h3>No activities yet</h3>
        <p>Start by logging your first carbon-impacting action, or load sample data to see how everything works.</p>
        <div className="cta-row" style={{ justifyContent: "center" }}>
          <button className="btn primary" onClick={() => setAddOpen(true)}><Plus size={16} /> Add your first activity</button>
          <button className="btn" onClick={() => setView("settings")}><Sparkles size={16} /> Load sample data</button>
        </div>
      </Card>
    );
  }

  const donutData = CAT_ORDER.filter((k) => ct[k]).map((k) => ({ name: CATS[k].label, value: +ct[k].toFixed(2), cat: k }));
  const tickEvery = series.length > 14 ? Math.ceil(series.length / 8) : 0;

  return (
    <div className="grid">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="eyebrow">Overview · {r.label}</div>
        <RangeSelect range={range} setRange={setRange} />
      </div>

      <div className="grid cols-4">
        <StatCard k={`Total — ${r.label}`} value={fmt(total, units)} units={unitLabel(units)} />
        <StatCard k="Change" chip={delta === null
          ? <div className="chip" style={{ color: "var(--sub)" }}>No prior period</div>
          : null} delta={delta} />
        <StatCard k="Top category" chip={topCat
          ? <div className="chip" style={{ color: CATS[topCat].color }}><span className="dot" style={{ background: CATS[topCat].color }} />{CATS[topCat].label} · {Math.round((ct[topCat] / total) * 100)}%</div>
          : <div className="chip" style={{ color: "var(--sub)" }}>—</div>} />
        <StatCard k="Monthly budget" value={Math.round(budgetPct) + "%"} bar={{ pct: budgetPct, color: budgetPct > 100 ? "var(--warn)" : "var(--brand)", note: `${fmt(monthTotal, units)} of ${fmt(settings.monthlyBudget, units)} ${unitLabel(units)}` }} />
      </div>

      <div className="split">
        <Card className="pad">
          <div className="eyebrow">Emissions over time</div>
          <div style={{ height: 230, marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--sub)" }} axisLine={false} tickLine={false} interval={tickEvery || 0} />
                <YAxis tick={{ fontSize: 11, fill: "var(--sub)" }} axisLine={false} tickLine={false} width={44} />
                <Tooltip cursor={{ fill: "rgba(15,118,110,.06)" }} contentStyle={{ borderRadius: 10, border: "1px solid var(--line)", fontSize: 12 }} formatter={(v) => [`${fmt(v)} kg CO₂e`, "Total"]} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={46} fill="var(--brand)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="pad">
          <div className="eyebrow">By category</div>
          <div className="donut" style={{ height: 180, marginTop: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={82} paddingAngle={2} stroke="none">
                  {donutData.map((d) => <Cell key={d.cat} fill={CATS[d.cat].color} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [`${fmt(v)} kg CO₂e`, n]} contentStyle={{ borderRadius: 10, border: "1px solid var(--line)", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="center"><b className="num">{fmt(total, units)}</b><span>{unitLabel(units)}</span></div>
          </div>
          <div style={{ display: "grid", gap: 7, marginTop: 6 }}>
            {donutData.map((d) => (
              <div key={d.cat} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span className="dot" style={{ background: CATS[d.cat].color }} />
                <span style={{ flex: 1 }}>{d.name}</span>
                <span className="num" style={{ fontWeight: 600 }}>{Math.round((d.value / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="eyebrow">Recent activity</div>
          <a className="link" onClick={() => setView("activities")}>View full ledger →</a>
        </div>
        <div style={{ marginTop: 8, overflowX: "auto" }}>
          <LedgerTable rows={entries.slice(0, 6)} units={units} onRow={setDetail} compact />
        </div>
      </Card>
    </div>
  );
}

/* ============================================================ LEDGER TABLE (shared) */
function LedgerTable({ rows, units, onRow, compact }) {
  if (rows.length === 0) return <div style={{ color: "var(--sub)", fontSize: 14, padding: "16px 4px" }}>No activities match these filters.</div>;
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th>Date</th>
          <th>Activity</th>
          {!compact && <th className="hide-sm">Category</th>}
          <th className="hide-sm">Amount</th>
          <th className="right">CO₂e</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const c = CATS[e.cat]; const Icon = c.icon;
          return (
            <tr key={e.id} className="row" onClick={() => onRow(e)}>
              <td style={{ color: "var(--sub)", whiteSpace: "nowrap" }}>{parseYMD(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="icwrap" style={{ background: c.color + "1A" }}><Icon size={15} color={c.color} /></span>
                  <span style={{ fontWeight: 500 }}>{FACTORS[e.cat][e.type].label}</span>
                </div>
              </td>
              {!compact && <td className="hide-sm"><CatTag cat={e.cat} /></td>}
              <td className="hide-sm num" style={{ color: "var(--ink-2)" }}>{e.amount.toLocaleString()} {unitOf(e.cat, e.type)}</td>
              <td className="right num" style={{ fontWeight: 700 }}>{fmt(e.co2, units)} <span style={{ color: "var(--sub)", fontWeight: 500, fontSize: 11 }}>{unitLabel(units)}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ============================================================ ACTIVITIES */
function Activities({ entries, units, setAddOpen, setDetail }) {
  const [cat, setCat] = useState("all");
  const [range, setRange] = useState("all");
  const [q, setQ] = useState("");
  const r = useMemo(() => getRange(range, entries), [range, entries]);
  const rows = useMemo(() => entries
    .filter((e) => (range === "all" ? true : inRange(e, r.start, r.end)))
    .filter((e) => (cat === "all" ? true : e.cat === cat))
    .filter((e) => (q ? FACTORS[e.cat][e.type].label.toLowerCase().includes(q.toLowerCase()) : true)),
    [entries, cat, range, q, r]);
  const sum = rows.reduce((s, e) => s + e.co2, 0);

  return (
    <div className="grid">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="eyebrow">Activities · {rows.length} entries · {fmt(sum, units)} {unitLabel(units)}</div>
        <button className="btn primary" onClick={() => setAddOpen(true)}><Plus size={16} /> Add activity</button>
      </div>

      <Card className="pad" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <Search size={15} color="var(--sub)" style={{ position: "absolute", left: 11, top: 11 }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Search activities" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ width: "auto" }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="all">All categories</option>
          {CAT_ORDER.map((k) => <option key={k} value={k}>{CATS[k].label}</option>)}
        </select>
        <select className="select" style={{ width: "auto" }} value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="all">All time</option>
          {RANGES.filter((x) => x.key !== "all").map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </Card>

      <Card className="pad" style={{ overflowX: "auto" }}>
        <LedgerTable rows={rows} units={units} onRow={setDetail} />
      </Card>
    </div>
  );
}

/* ============================================================ INSIGHTS */
function Insights({ entries, range, setRange, units, settings, setAddOpen }) {
  const r = useMemo(() => getRange(range, entries), [range, entries]);
  const inP = useMemo(() => entries.filter((e) => inRange(e, r.start, r.end)), [entries, r]);
  const prevP = useMemo(() => (r.prevStart ? entries.filter((e) => inRange(e, r.prevStart, r.prevEnd)) : []), [entries, r]);

  if (inP.length < 3) {
    return (
      <Card className="empty">
        <div className="badge-ic" style={{ background: "#FBF0DC" }}><Lightbulb size={24} color="var(--amber)" /></div>
        <h3>Insights need a little more data</h3>
        <p>Log a few activities over {r.label === "all time" ? "a week or two" : r.label} and Cinder will surface your biggest, most realistic ways to cut — each with the carbon you'd save.</p>
        <button className="btn primary" onClick={() => setAddOpen(true)}><Plus size={16} /> Add activity</button>
      </Card>
    );
  }

  const total = inP.reduce((s, e) => s + e.co2, 0);
  const top = typeTotals(inP).slice(0, 3);
  const ct = catTotals(inP);
  const ctPrev = catTotals(prevP);
  const catBars = CAT_ORDER.filter((k) => ct[k]).map((k) => ({ cat: k, label: CATS[k].label, value: ct[k] }));
  const maxBar = Math.max(...catBars.map((b) => b.value), 1);

  // levers
  const levers = [];
  const days = Math.max(1, Math.round((r.end - r.start) / 86400000));
  const annualize = (v) => (v / days) * 365;
  const byType = {}; for (const e of inP) { (byType[e.type] ||= 0); byType[e.type] += e.co2; }
  const carCo2 = (byType.car_petrol || 0) + (byType.car_diesel || 0);
  if (carCo2 > 0.5) levers.push({ cat: "travel", title: "Shift short car trips to transit or cycling", saving: annualize(carCo2 * 0.5), body: `Driving was ${fmt(carCo2)} kg in ${r.label}. Moving about half onto transit or a bike trims roughly this much a year.` });
  const fly = (byType.flight_short || 0) + (byType.flight_long || 0);
  if (fly > 5) levers.push({ cat: "travel", title: "One fewer short-haul flight a year", saving: 400, body: `Air travel added ${fmt(fly)} kg in ${r.label}. A single return short-haul trip is often ~400 kg — the highest-leverage change available.` });
  const red = (byType.beef || 0) + (byType.lamb || 0);
  if (red > 0.5) levers.push({ cat: "food", title: "Swap half your red-meat meals", saving: annualize(red * 0.6), body: `Red meat was ${fmt(red)} kg in ${r.label}. Replacing half with chicken, fish, or beans is the biggest lever on a plate.` });
  if ((byType.electricity || 0) > 1) levers.push({ cat: "energy", title: "Trim cooling and standby load", saving: annualize((byType.electricity || 0) * 0.15), body: `Electricity was ${fmt(byType.electricity || 0)} kg. A 15% cut — efficient cooling, LEDs, killing standby — adds up.` });
  levers.sort((a, b) => b.saving - a.saving);

  // streak: weeks under weekly budget over last 8 weeks
  const weeklyBudget = settings.monthlyBudget / 4.345;
  let streak = 0, weeksUnder = 0;
  for (let w = 0; w < 8; w++) {
    const wEnd = addDays(startOfDay(new Date()), -7 * w + 1);
    const wStart = addDays(wEnd, -7);
    const wt = entries.filter((e) => inRange(e, wStart, wEnd)).reduce((s, e) => s + e.co2, 0);
    if (wt > 0 && wt <= weeklyBudget) { weeksUnder++; if (w === streak) streak++; }
  }

  return (
    <div className="grid">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="eyebrow">Insights · {r.label}</div>
        <RangeSelect range={range} setRange={setRange} />
      </div>

      <div className="split">
        <Card className="pad">
          <div className="eyebrow">Top contributors</div>
          <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            {top.map((t, i) => {
              const c = CATS[t.cat]; const Icon = c.icon;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="icwrap" style={{ background: c.color + "1A" }}><Icon size={16} color={c.color} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{FACTORS[t.cat][t.type].label}</div>
                    <div style={{ fontSize: 12, color: "var(--sub)" }}>{c.label} · {t.count} {t.count === 1 ? "entry" : "entries"}</div>
                  </div>
                  <div className="num" style={{ fontWeight: 700 }}>{fmt(t.co2, units)} <span style={{ color: "var(--sub)", fontSize: 11, fontWeight: 500 }}>{Math.round((t.co2 / total) * 100)}%</span></div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="pad">
          <div className="eyebrow">Category comparison</div>
          <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            {catBars.map((b) => (
              <div key={b.cat}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                  <span>{b.label}</span><span className="num" style={{ fontWeight: 600 }}>{fmt(b.value, units)} {unitLabel(units)}</span>
                </div>
                <div className="minibar" style={{ marginTop: 0 }}><div style={{ width: `${(b.value / maxBar) * 100}%`, background: CATS[b.cat].color }} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="pad" style={{ display: "flex", gap: 14, alignItems: "center", background: "var(--brand-soft)", borderColor: "var(--brand-soft)" }}>
        <div className="icwrap" style={{ background: "var(--brand)", width: 38, height: 38 }}><Target size={19} color="#fff" /></div>
        <div>
          <div style={{ fontWeight: 700, color: "var(--brand)" }}>Streaks &amp; habits</div>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 2 }}>
            {weeksUnder > 0 ? `${weeksUnder} of the last 8 weeks came in under your weekly budget (~${fmt(weeklyBudget, units)} ${unitLabel(units)})` : "No weeks under budget yet in the last 8 — set a realistic budget in Settings and build from there."}
            {streak > 1 ? ` — ${streak} in a row right now.` : ""}
          </div>
        </div>
      </Card>

      {levers.length > 0 && <div className="eyebrow">Where to cut, ranked by yearly impact</div>}
      {levers.map((lv, i) => {
        const c = CATS[lv.cat]; const Icon = c.icon;
        return (
          <Card key={i} className="pad" style={{ display: "flex", gap: 14 }}>
            <span className="icwrap" style={{ background: c.color, width: 40, height: 40 }}><Icon size={19} color="#fff" /></span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{lv.title}</div>
                <span className="tag" style={{ background: "var(--brand-soft)", color: "var(--brand)", whiteSpace: "nowrap", fontWeight: 700 }}>−{fmt(lv.saving, units)} {unitLabel(units)}/yr</span>
              </div>
              <p style={{ color: "var(--sub)", fontSize: 13.5, margin: "6px 0 0", lineHeight: 1.55 }}>{lv.body}</p>
            </div>
          </Card>
        );
      })}

      {prevP.length > 0 && (
        <Card className="pad">
          <div className="eyebrow">What changed vs the previous period</div>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {CAT_ORDER.filter((k) => ct[k] || ctPrev[k]).map((k) => {
              const now = ct[k] || 0, was = ctPrev[k] || 0; const d = was > 0 ? Math.round(((now - was) / was) * 100) : null;
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
                  <span className="dot" style={{ background: CATS[k].color }} />
                  <span style={{ flex: 1 }}>{CATS[k].label}</span>
                  <span className="num" style={{ color: "var(--sub)" }}>{fmt(now, units)} {unitLabel(units)}</span>
                  {d === null ? <span style={{ width: 64, textAlign: "right", color: "var(--sub)", fontSize: 12 }}>new</span>
                    : <span className={"delta " + (d >= 0 ? "up" : "down")} style={{ width: 64, justifyContent: "flex-end", marginTop: 0 }}>{d >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(d)}%</span>}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ============================================================ ADD ACTIVITY (sheet) */
function AddActivity({ onClose, onAdd, units }) {
  const [cat, setCat] = useState("travel");
  const [type, setType] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(ymd(new Date()));
  const items = FACTORS[cat];
  const u = type ? unitOf(cat, type) : CATS[cat].unit;
  const est = type && amount ? factorOf(cat, type) * parseFloat(amount || 0) : null;

  const save = () => { if (onAdd(cat, type, amount, date)) onClose(); };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>Add activity</div>
          <button className="iconbtn" onClick={onClose}><X size={18} /></button>
        </div>

        <label className="lbl">Category</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 7, marginBottom: 16 }}>
          {CAT_ORDER.map((k) => {
            const Icon = CATS[k].icon; const on = cat === k;
            return (
              <button key={k} onClick={() => { setCat(k); setType(""); }} title={CATS[k].label}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "11px 2px", borderRadius: 11, cursor: "pointer",
                  fontFamily: "inherit", fontSize: 10.5, fontWeight: on ? 700 : 500,
                  border: `1.5px solid ${on ? CATS[k].color : "var(--line)"}`, background: on ? CATS[k].color : "var(--surface)", color: on ? "#fff" : "var(--ink-2)" }}>
                <Icon size={17} />{CATS[k].label}
              </button>
            );
          })}
        </div>

        <label className="lbl">Activity</label>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose…</option>
          {Object.keys(items).map((k) => <option key={k} value={k}>{items[k].label}</option>)}
        </select>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          <div>
            <label className="lbl">Amount ({u})</label>
            <input className="input" type="number" min="0" step="any" value={amount}
              placeholder={u === "km" ? "10" : u === "$" ? "50" : "1"} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="lbl">Date</label>
            <input className="input" type="date" max={ymd(new Date())} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 16, padding: "13px 15px", background: est != null ? "var(--brand-soft)" : "var(--line-2)", borderRadius: 12 }}>
          <div style={{ fontSize: 11.5, color: "var(--sub)", fontWeight: 600 }}>ESTIMATED IMPACT</div>
          <div className="num" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", marginTop: 3, color: est != null ? "var(--brand)" : "var(--sub)" }}>
            {est != null ? `${fmt(est, units)} ${unitLabel(units)}` : "—"}
          </div>
          {type && <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 3 }}>Factor: {factorOf(cat, type)} kg CO₂e / {u} · DEFRA/EPA/OWID averages</div>}
        </div>

        <button className="btn primary" style={{ width: "100%", marginTop: 18, padding: 12 }} disabled={!type || !amount} onClick={save}>
          <Plus size={16} /> Add to ledger
        </button>
      </div>
    </div>
  );
}

/* ============================================================ DETAIL SHEET */
function DetailSheet({ entry, units, onClose, onDelete, onDuplicate }) {
  const c = CATS[entry.cat]; const Icon = c.icon; const u = unitOf(entry.cat, entry.type);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <div style={{ fontWeight: 700, fontSize: 18 }}>Activity details</div>
          <button className="iconbtn" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 18 }}>
          <span className="icwrap" style={{ background: c.color, width: 46, height: 46, borderRadius: 12 }}><Icon size={22} color="#fff" /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{FACTORS[entry.cat][entry.type].label}</div>
            <CatTag cat={entry.cat} />
          </div>
        </div>
        {[
          ["Date", parseYMD(entry.date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })],
          ["Amount", `${entry.amount.toLocaleString()} ${u}`],
          ["Emission factor", `${factorOf(entry.cat, entry.type)} kg CO₂e / ${u}`],
          ["Estimated impact", `${fmt(entry.co2, units)} ${unitLabel(units)}`],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderTop: "1px solid var(--line-2)", fontSize: 14 }}>
            <span style={{ color: "var(--sub)" }}>{k}</span><span className="num" style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
          </div>
        ))}
        <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 14, padding: "10px 12px", background: "var(--line-2)", borderRadius: 10 }}>
          <Info size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
          Estimate = amount × emission factor. Factors are averages from DEFRA / EPA / Our World in Data and are directional, not exact.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => onDuplicate(entry)}>Duplicate to today</button>
          <button className="btn danger" onClick={() => onDelete(entry.id)}><Trash2 size={15} /> Delete</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ SETTINGS */
function SettingsView({ settings, setSettings, entries, loadSample, clearAll }) {
  const [confirm, setConfirm] = useState(false);
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  return (
    <div className="grid" style={{ maxWidth: 620 }}>
      <Card className="pad">
        <div className="eyebrow">Profile</div>
        <label className="lbl" style={{ marginTop: 14 }}>Name (optional)</label>
        <input className="input" value={settings.name} placeholder="What should we call you?" onChange={(e) => set({ name: e.target.value })} />

        <label className="lbl" style={{ marginTop: 16 }}>Units</label>
        <div className="seg">
          <button className={settings.units === "kg" ? "on" : ""} onClick={() => set({ units: "kg" })}>Kilograms</button>
          <button className={settings.units === "t" ? "on" : ""} onClick={() => set({ units: "t" })}>Tonnes</button>
        </div>

        <label className="lbl" style={{ marginTop: 16 }}>Default date range</label>
        <select className="select" value={settings.defaultRange} onChange={(e) => set({ defaultRange: e.target.value })}>
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </Card>

      <Card className="pad">
        <div className="eyebrow">Carbon budget</div>
        <label className="lbl" style={{ marginTop: 14 }}>Monthly budget · <b style={{ color: "var(--brand)" }}>{settings.monthlyBudget} kg CO₂e</b></label>
        <input type="range" min="50" max="800" step="10" value={settings.monthlyBudget} onChange={(e) => set({ monthlyBudget: parseInt(e.target.value) })}
          style={{ width: "100%", accentColor: "var(--brand)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--sub)" }}><span>50</span><span>800</span></div>
        <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 12, lineHeight: 1.5, padding: "10px 12px", background: "var(--bg)", borderRadius: 10 }}>
          A long-term sustainable footprint is roughly <b>165 kg/month</b> (~2 tonnes a year). Pick a budget you can realistically beat, then lower it over time.
        </p>
      </Card>

      <Card className="pad">
        <div className="eyebrow">Your data</div>
        <p style={{ fontSize: 13.5, color: "var(--sub)", margin: "10px 0 14px" }}>
          {entries.length} {entries.length === 1 ? "entry" : "entries"} stored on this device. Nothing is uploaded.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => exportCSV(entries)} disabled={!entries.length}><Download size={15} /> Export CSV</button>
          <button className="btn" onClick={loadSample}><Sparkles size={15} /> Load sample data</button>
          {!confirm
            ? <button className="btn danger" onClick={() => setConfirm(true)} disabled={!entries.length}><Trash2 size={15} /> Delete all</button>
            : <>
                <button className="btn danger" onClick={() => { clearAll(); setConfirm(false); }}>Confirm delete</button>
                <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              </>}
        </div>
      </Card>
    </div>
  );
}

/* ============================================================ ABOUT / METHODOLOGY */
function About() {
  return (
    <div className="grid" style={{ maxWidth: 720 }}>
      <Card className="pad">
        <div className="eyebrow">About</div>
        <h3 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.01em", margin: "10px 0 8px" }}>Carbon accounting you can actually see.</h3>
        <p style={{ color: "var(--ink-2)", fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>
          Cinder turns everyday actions — a commute, a meal, a flight, a purchase — into an estimate of the greenhouse gases they cause, measured in kilograms of CO₂-equivalent (CO₂e). The goal is clarity, not guilt: see where your impact comes from, and find the few changes that matter most.
        </p>
      </Card>

      <Card className="pad">
        <div className="eyebrow">How estimates work</div>
        <p style={{ color: "var(--ink-2)", fontSize: 14, lineHeight: 1.6 }}>
          Each activity is multiplied by an <b>emission factor</b> — the average CO₂e per kilometre, kWh, meal, item, or dollar. Factors are drawn from the UK DEFRA 2024 conversion factors, the US EPA, and Our World in Data. They're population averages, so treat results as directional rather than a certified inventory. Electricity is especially location-dependent; the default grid factor is a moderate global value of 0.41 kg/kWh.
        </p>
      </Card>

      <Card className="pad" style={{ overflowX: "auto" }}>
        <div className="eyebrow">Emission factors used</div>
        <table className="method" style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead><tr><th>Category</th><th>Activity</th><th>Factor</th></tr></thead>
          <tbody>
            {CAT_ORDER.map((k) => Object.keys(FACTORS[k]).map((t, i) => (
              <tr key={k + t}>
                <td>{i === 0 ? <CatTag cat={k} /> : ""}</td>
                <td>{FACTORS[k][t].label}</td>
                <td className="num">{FACTORS[k][t].f} kg CO₂e / {unitOf(k, t)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </Card>

      <Card className="pad">
        <div className="eyebrow">Privacy</div>
        <p style={{ color: "var(--ink-2)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Your activities are stored locally in your browser and never sent to a server. You can export everything to CSV or delete it all at any time from Settings.
        </p>
      </Card>
    </div>
  );
}
