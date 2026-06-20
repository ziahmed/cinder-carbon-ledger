import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, ReferenceLine, Tooltip,
} from "recharts";
import {
  Car, Home, UtensilsCrossed, ShoppingBag, Plus, Trash2, Target,
  BarChart3, Lightbulb, Settings, Check, Flame, ArrowRight, Leaf,
} from "lucide-react";

/* ---------------------------------------------------------------- design tokens */
const C = {
  bg: "#EAEFEC", ink: "#16221E", sub: "#5C6B65", line: "#D6DEDA",
  surface: "#FFFFFF", brand: "#14655E", brandSoft: "#DBEAE6",
  good: "#2E9E8F", warn: "#C2492F", warnSoft: "#F4DFD9", amber: "#C9892F",
};
const FONT_SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const FONT_SERIF = 'ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif';

/* ---------------------------------------------------------------- emission factors (kg CO2e per unit) */
const CATS = {
  transport: { label: "Transport", color: "#14655E", icon: Car, unit: "km" },
  energy:    { label: "Home energy", color: "#3E7CB1", icon: Home, unit: "kWh" },
  food:      { label: "Food", color: "#C9892F", icon: UtensilsCrossed, unit: "meal" },
  goods:     { label: "Things", color: "#A65D57", icon: ShoppingBag, unit: "item" },
};
const FACTORS = {
  transport: {
    car_petrol: { label: "Car · petrol", f: 0.192 },
    car_diesel: { label: "Car · diesel", f: 0.171 },
    car_ev:     { label: "Car · electric", f: 0.053 },
    motorbike:  { label: "Motorbike", f: 0.103 },
    bus:        { label: "Bus", f: 0.097 },
    train:      { label: "Train / MRT", f: 0.035 },
    flight_sh:  { label: "Flight · short-haul", f: 0.246 },
    flight_lg:  { label: "Flight · long-haul", f: 0.180 },
    walk_cycle: { label: "Walk / cycle", f: 0 },
  },
  energy: {
    electricity: { label: "Electricity", f: 0.41 },
    natural_gas: { label: "Natural gas", f: 0.184 },
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
  goods: {
    tshirt:     { label: "T-shirt", f: 7 },
    jeans:      { label: "Jeans", f: 25 },
    shoes:      { label: "Pair of shoes", f: 14 },
    elec_small: { label: "Small electronics", f: 50 },
    elec_large: { label: "Large appliance", f: 300 },
    book:       { label: "Book", f: 1 },
  },
};
const SUSTAINABLE_DAILY = 5.5; // ~2 t CO2e/yr personal target

/* ---------------------------------------------------------------- helpers */
const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
const dayKeyToDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmt = (kg) => (kg >= 100 ? Math.round(kg).toLocaleString() : kg.toFixed(1));
const fmtYr = (kg) => (kg >= 1000 ? (kg / 1000).toFixed(1) + " t" : Math.round(kg).toLocaleString() + " kg");

function lastNDayStrings(n) {
  const out = [];
  const base = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base); d.setDate(base.getDate() - i);
    out.push(d.toLocaleDateString("en-CA"));
  }
  return out;
}
function entryCO2(e) { return (FACTORS[e.cat]?.[e.type]?.f ?? 0) * e.amount; }

/* ---------------------------------------------------------------- storage (browser localStorage, with safe fallback) */
const KEYS = { entries: "cinder:entries:v1", settings: "cinder:settings:v1" };
async function loadKey(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw != null ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
async function saveKey(key, val) {
  try { window.localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable; keep in memory */ }
}

/* ---------------------------------------------------------------- insights engine */
function buildInsights(entries, target) {
  const recentStrs = new Set(lastNDayStrings(7));
  const wk = entries.filter((e) => recentStrs.has(e.date));
  if (wk.length === 0) return { ready: false, list: [], wins: [], weekTotal: 0, dailyAvg: 0 };

  const byType = {};
  let weekTotal = 0;
  for (const e of wk) {
    const co2 = entryCO2(e);
    weekTotal += co2;
    const t = (byType[e.type] ||= { co2: 0, amount: 0, count: 0, cat: e.cat });
    t.co2 += co2; t.amount += e.amount; t.count += 1;
  }
  const list = [];

  // Transport — car
  const carCo2 = (byType.car_petrol?.co2 || 0) + (byType.car_diesel?.co2 || 0);
  const carKm = (byType.car_petrol?.amount || 0) + (byType.car_diesel?.amount || 0);
  if (carCo2 > 0.5) {
    const save = carCo2 * 0.5 * 52;
    list.push({
      cat: "transport",
      title: "Shift short car trips to transit or cycling",
      body: `You logged ${Math.round(carKm)} km by car this week (${fmt(carCo2)} kg CO₂e). Moving about half onto the MRT, bus, or a bike would avoid roughly ${fmtYr(save)} CO₂e a year.`,
      saving: save,
    });
  }
  // Transport — flights
  const flyCo2 = (byType.flight_sh?.co2 || 0) + (byType.flight_lg?.co2 || 0);
  if (flyCo2 > 5) {
    list.push({
      cat: "transport",
      title: "Flights dominate — make each one count",
      body: `Air travel added ${fmt(flyCo2)} kg this week. One fewer return short-haul trip a year (~400 kg) often beats every other change combined; consider rail or combining trips.`,
      saving: 400,
    });
  }
  // Food — red meat
  const redCo2 = (byType.beef?.co2 || 0) + (byType.lamb?.co2 || 0);
  const redCount = (byType.beef?.count || 0) + (byType.lamb?.count || 0);
  if (redCount > 0) {
    const avgRed = redCo2 / redCount;
    const save = Math.max(0, (avgRed - FACTORS.food.poultry.f) * (redCount / 2) * 52);
    list.push({
      cat: "food",
      title: "Swap half your red-meat meals",
      body: `Your ${redCount} red-meat meal${redCount > 1 ? "s" : ""} added ${fmt(redCo2)} kg — the single biggest lever on a plate. Replacing half with chicken, fish, or beans saves about ${fmtYr(save)} CO₂e a year.`,
      saving: save,
    });
  }
  // Energy — electricity
  if (byType.electricity && byType.electricity.co2 > 1) {
    const save = byType.electricity.co2 * 0.15 * 52;
    list.push({
      cat: "energy",
      title: "Trim cooling and standby load",
      body: `Electricity was ${fmt(byType.electricity.co2)} kg this week. A 15% cut — a warmer aircon setpoint, LED lighting, and killing standby power — is about ${fmtYr(save)} CO₂e a year.`,
      saving: save,
    });
  }
  // Goods
  const goodsCo2 = wk.filter((e) => e.cat === "goods").reduce((s, e) => s + entryCO2(e), 0);
  if (goodsCo2 > 20) {
    list.push({
      cat: "goods",
      title: "Buy less, keep things longer",
      body: `New purchases added ${fmt(goodsCo2)} kg this week. Most of an item's footprint is in making it — repairing, buying second-hand, or simply delaying replacements cuts that at the source.`,
      saving: goodsCo2 * 0.4 * 52,
    });
  }

  list.sort((a, b) => b.saving - a.saving);

  // Wins
  const wins = [];
  const greenKm = byType.walk_cycle?.amount || 0;
  if (greenKm > 0) wins.push(`You covered ${Math.round(greenKm)} km on foot or by bike — about ${fmt(greenKm * FACTORS.transport.car_petrol.f)} kg CO₂e avoided versus driving.`);
  const vegCount = (byType.vegan?.count || 0) + (byType.vegetarian?.count || 0);
  if (vegCount > 0) wins.push(`${vegCount} plant-based meal${vegCount > 1 ? "s" : ""} logged — among the lowest-impact choices on the menu.`);
  if (byType.train) wins.push(`${Math.round(byType.train.amount)} km by train, one of the cleanest ways to move.`);

  return { ready: true, list, wins, weekTotal, dailyAvg: weekTotal / 7 };
}

/* ---------------------------------------------------------------- small UI atoms */
function Card({ children, style }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, ...style }}>
      {children}
    </div>
  );
}
function Eyebrow({ children }) {
  return <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: C.sub, fontWeight: 600 }}>{children}</div>;
}

/* ================================================================ APP */
export default function App() {
  const [view, setView] = useState("dashboard");
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState({ name: "", target: 8 });
  const [loading, setLoading] = useState(true);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const [e, s] = await Promise.all([
        loadKey(KEYS.entries, []),
        loadKey(KEYS.settings, { name: "", target: 8 }),
      ]);
      setEntries(Array.isArray(e) ? e : []);
      setSettings({ name: "", target: 8, ...s });
      setLoading(false);
      hydrated.current = true;
    })();
  }, []);
  useEffect(() => { if (hydrated.current) saveKey(KEYS.entries, entries); }, [entries]);
  useEffect(() => { if (hydrated.current) saveKey(KEYS.settings, settings); }, [settings]);

  const target = settings.target || 8;

  const addEntry = (cat, type, amount, date) => {
    const amt = parseFloat(amount);
    if (!type || !amt || amt <= 0) return false;
    setEntries((p) => [{ id: Date.now() + Math.random(), cat, type, amount: amt, date }, ...p]);
    return true;
  };
  const deleteEntry = (id) => setEntries((p) => p.filter((e) => e.id !== id));

  const today = todayStr();
  const todayTotal = useMemo(
    () => entries.filter((e) => e.date === today).reduce((s, e) => s + entryCO2(e), 0),
    [entries, today]
  );
  const insights = useMemo(() => buildInsights(entries, target), [entries, target]);

  const nav = [
    { id: "dashboard", label: "Today", icon: BarChart3 },
    { id: "log", label: "Log", icon: Plus },
    { id: "insights", label: "Insights", icon: Lightbulb },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div style={{ fontFamily: FONT_SANS, color: C.ink, background: C.bg, minHeight: "100vh" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 16px 96px" }}>
        {/* masthead */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 2px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: C.brand, display: "grid", placeItems: "center" }}>
              <Flame size={19} color="#fff" strokeWidth={2.2} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1 }}>Cinder</div>
              <div style={{ fontSize: 11, color: C.sub, letterSpacing: "0.02em" }}>a personal carbon ledger</div>
            </div>
          </div>
          {settings.name ? (
            <div style={{ fontSize: 13, color: C.sub }}>Hi, {settings.name}</div>
          ) : null}
        </header>

        {/* nav */}
        <nav style={{ display: "flex", gap: 6, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 5, position: "sticky", top: 8, zIndex: 5, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
          {nav.map((n) => {
            const on = view === n.id;
            const Icon = n.icon;
            return (
              <button key={n.id} onClick={() => setView(n.id)}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  padding: "9px 6px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: on ? C.brand : "transparent", color: on ? "#fff" : C.sub,
                  fontWeight: on ? 600 : 500, fontSize: 13.5, transition: "all .15s", fontFamily: FONT_SANS,
                }}>
                <Icon size={16} strokeWidth={2.1} />
                <span>{n.label}</span>
              </button>
            );
          })}
        </nav>

        <main style={{ marginTop: 18 }}>
          {loading ? (
            <Card style={{ padding: 40, textAlign: "center", color: C.sub }}>Opening your ledger…</Card>
          ) : view === "dashboard" ? (
            <Dashboard entries={entries} todayTotal={todayTotal} target={target} insights={insights} go={setView} onDelete={deleteEntry} />
          ) : view === "log" ? (
            <LogView onAdd={addEntry} entries={entries} onDelete={deleteEntry} />
          ) : view === "insights" ? (
            <InsightsView insights={insights} target={target} go={setView} />
          ) : (
            <SettingsView settings={settings} setSettings={setSettings} clearAll={() => setEntries([])} count={entries.length} />
          )}
        </main>

        <footer style={{ marginTop: 28, textAlign: "center", fontSize: 11, color: C.sub, lineHeight: 1.6 }}>
          Estimates use published average emission factors (DEFRA / EPA / Our World in Data).<br />
          Figures are approximations for personal awareness, not a certified inventory.
        </footer>
      </div>
    </div>
  );
}

/* ================================================================ DASHBOARD */
function Dashboard({ entries, todayTotal, target, insights, go, onDelete }) {
  const weekStrs = lastNDayStrings(7);
  const weekData = weekStrs.map((d) => {
    const total = entries.filter((e) => e.date === d).reduce((s, e) => s + entryCO2(e), 0);
    return { day: dayKeyToDate(d).toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2), date: d, total: +total.toFixed(2) };
  });
  const weekTotal = weekData.reduce((s, d) => s + d.total, 0);
  const dailyAvg = weekTotal / 7;

  // category breakdown over the week
  const catTotals = {};
  for (const e of entries.filter((e) => weekStrs.includes(e.date))) {
    catTotals[e.cat] = (catTotals[e.cat] || 0) + entryCO2(e);
  }
  const catSum = Object.values(catTotals).reduce((a, b) => a + b, 0);

  if (entries.length === 0) {
    return (
      <Card style={{ padding: "44px 28px", textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: C.brandSoft, display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
          <Leaf size={26} color={C.brand} />
        </div>
        <div style={{ fontFamily: FONT_SERIF, fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Your ledger is empty</div>
        <p style={{ color: C.sub, fontSize: 14.5, maxWidth: 380, margin: "0 auto 22px", lineHeight: 1.55 }}>
          Log a trip, a meal, or your energy use and Cinder starts drawing your daily carbon budget — then tells you exactly where to cut.
        </p>
        <button onClick={() => go("log")} style={primaryBtn}>
          Log your first activity <ArrowRight size={16} />
        </button>
      </Card>
    );
  }

  const pct = Math.min(100, (todayTotal / target) * 100);
  const over = todayTotal > target;
  const remaining = target - todayTotal;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* SIGNATURE: today's budget gauge */}
      <Card style={{ padding: "22px 22px 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <Eyebrow>Today’s carbon · {dayKeyToDate(todayStr()).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</Eyebrow>
          <div style={{ fontSize: 12.5, color: over ? C.warn : C.good, fontWeight: 600 }}>
            {over ? `${fmt(todayTotal - target)} kg over budget` : `${fmt(remaining)} kg left in budget`}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, margin: "6px 0 16px" }}>
          <span style={{ fontFamily: FONT_SERIF, fontSize: 56, fontWeight: 600, lineHeight: 0.9, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
            {fmt(todayTotal)}
          </span>
          <span style={{ fontSize: 15, color: C.sub, paddingBottom: 8 }}>kg CO₂e</span>
        </div>
        {/* gauge */}
        <div style={{ position: "relative", height: 14, background: C.bg, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: over ? C.warn : C.good, borderRadius: 8, transition: "width .5s ease" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 11.5, color: C.sub }}>
          <span>0</span>
          <span>daily budget · {target} kg</span>
        </div>
      </Card>

      {/* stat strip */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        <Stat label="This week" value={fmt(weekTotal)} unit="kg" />
        <Stat label="Daily average" value={fmt(dailyAvg)} unit="kg"
          accent={dailyAvg <= target ? C.good : C.warn} />
        <Stat label="vs sustainable" value={`${dailyAvg <= SUSTAINABLE_DAILY ? "−" : "+"}${fmt(Math.abs(dailyAvg - SUSTAINABLE_DAILY))}`} unit="kg/day"
          accent={dailyAvg <= SUSTAINABLE_DAILY ? C.good : C.amber} />
      </div>

      {/* weekly trend */}
      <Card style={{ padding: "18px 18px 8px" }}>
        <Eyebrow>Last 7 days</Eyebrow>
        <div style={{ height: 180, marginTop: 10 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekData} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.sub }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: C.sub }} axisLine={false} tickLine={false} width={42} />
              <Tooltip
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
                contentStyle={{ borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 12, fontFamily: FONT_SANS }}
                formatter={(v) => [`${fmt(v)} kg CO₂e`, "Total"]}
                labelFormatter={(l, p) => p?.[0] ? dayKeyToDate(p[0].payload.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : l}
              />
              <ReferenceLine y={target} stroke={C.warn} strokeDasharray="4 4" strokeWidth={1.2} />
              <Bar dataKey="total" radius={[5, 5, 0, 0]} maxBarSize={42}>
                {weekData.map((d, i) => <Cell key={i} fill={d.total > target ? C.warn : C.good} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* breakdown */}
      {catSum > 0 && (
        <Card style={{ padding: 18 }}>
          <Eyebrow>Where it came from · this week</Eyebrow>
          <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", margin: "12px 0 14px", background: C.bg }}>
            {Object.keys(CATS).map((k) =>
              catTotals[k] ? (
                <div key={k} style={{ width: `${(catTotals[k] / catSum) * 100}%`, background: CATS[k].color }} title={CATS[k].label} />
              ) : null
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 18px" }}>
            {Object.keys(CATS).map((k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: CATS[k].color, flexShrink: 0 }} />
                <span style={{ fontSize: 13.5, flex: 1 }}>{CATS[k].label}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(catTotals[k] || 0)} kg</span>
                <span style={{ fontSize: 12, color: C.sub, width: 36, textAlign: "right" }}>{catSum ? Math.round(((catTotals[k] || 0) / catSum) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* top insight teaser */}
      {insights.ready && insights.list.length > 0 && (
        <button onClick={() => go("insights")} style={{ textAlign: "left", border: "none", cursor: "pointer", padding: 0, background: "none" }}>
          <Card style={{ padding: 18, display: "flex", gap: 14, alignItems: "center", background: C.brand }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(255,255,255,0.15)", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Lightbulb size={20} color="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>Biggest opportunity</div>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 15, marginTop: 2 }}>{insights.list[0].title}</div>
              <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 12.5, marginTop: 2 }}>
                Save up to {fmtYr(insights.list[0].saving)} CO₂e a year
              </div>
            </div>
            <ArrowRight size={18} color="#fff" />
          </Card>
        </button>
      )}

      <RecentLedger entries={entries} onDelete={onDelete} limit={5} />
    </div>
  );
}

function Stat({ label, value, unit, accent }) {
  return (
    <Card style={{ padding: "14px 14px 13px" }}>
      <div style={{ fontSize: 11, color: C.sub, letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 5 }}>
        <span style={{ fontFamily: FONT_SERIF, fontSize: 26, fontWeight: 600, color: accent || C.ink, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <span style={{ fontSize: 11, color: C.sub }}>{unit}</span>
      </div>
    </Card>
  );
}

/* ================================================================ LOG */
function LogView({ onAdd, entries, onDelete }) {
  const [cat, setCat] = useState("transport");
  const [type, setType] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [flash, setFlash] = useState(false);

  const items = FACTORS[cat];
  const unit = CATS[cat].unit;
  const preview = type && amount ? (FACTORS[cat][type].f * parseFloat(amount || 0)) : null;

  const submit = () => {
    if (onAdd(cat, type, amount, date)) {
      setAmount(""); setType("");
      setFlash(true); setTimeout(() => setFlash(false), 1400);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card style={{ padding: 18 }}>
        <Eyebrow>Add to your ledger</Eyebrow>

        {/* category picker */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, margin: "12px 0 16px" }}>
          {Object.keys(CATS).map((k) => {
            const on = cat === k; const Icon = CATS[k].icon;
            return (
              <button key={k} onClick={() => { setCat(k); setType(""); }}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 4px",
                  borderRadius: 12, cursor: "pointer", fontFamily: FONT_SANS, fontSize: 12, fontWeight: on ? 600 : 500,
                  border: `1.5px solid ${on ? CATS[k].color : C.line}`,
                  background: on ? CATS[k].color : C.surface, color: on ? "#fff" : C.ink, transition: "all .15s",
                }}>
                <Icon size={20} strokeWidth={2} />
                {CATS[k].label}
              </button>
            );
          })}
        </div>

        {/* type */}
        <label style={lbl}>What was it?</label>
        <select value={type} onChange={(e) => setType(e.target.value)} style={input}>
          <option value="">Choose…</option>
          {Object.keys(items).map((k) => <option key={k} value={k}>{items[k].label}</option>)}
        </select>

        {/* amount + date */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div>
            <label style={lbl}>Amount ({unit})</label>
            <input type="number" min="0" step="any" value={amount} placeholder={unit === "meal" || unit === "item" ? "1" : "10"}
              onChange={(e) => setAmount(e.target.value)} style={input} />
          </div>
          <div>
            <label style={lbl}>Date</label>
            <input type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} style={input} />
          </div>
        </div>

        {preview != null && (
          <div style={{ marginTop: 14, padding: "10px 14px", background: C.brandSoft, borderRadius: 10, fontSize: 13.5, color: C.ink }}>
            That’s about <strong style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(preview)} kg CO₂e</strong>.
          </div>
        )}

        <button onClick={submit} disabled={!type || !amount}
          style={{ ...primaryBtn, width: "100%", justifyContent: "center", marginTop: 16, opacity: (!type || !amount) ? 0.5 : 1, cursor: (!type || !amount) ? "not-allowed" : "pointer" }}>
          {flash ? <><Check size={16} /> Added to ledger</> : <><Plus size={16} /> Add to ledger</>}
        </button>
      </Card>

      <RecentLedger entries={entries} onDelete={onDelete} limit={8} title="Recent entries" />
    </div>
  );
}

/* ================================================================ INSIGHTS */
function InsightsView({ insights, target, go }) {
  if (!insights.ready) {
    return (
      <Card style={{ padding: "40px 28px", textAlign: "center" }}>
        <Lightbulb size={30} color={C.amber} style={{ margin: "0 auto 12px" }} />
        <div style={{ fontFamily: FONT_SERIF, fontSize: 21, fontWeight: 600, marginBottom: 6 }}>Insights need a few days of data</div>
        <p style={{ color: C.sub, fontSize: 14, maxWidth: 360, margin: "0 auto 20px", lineHeight: 1.55 }}>
          Log activity over a week and Cinder will rank your biggest, most realistic ways to cut — each with the carbon you’d save per year.
        </p>
        <button onClick={() => go("log")} style={primaryBtn}>Log activity <ArrowRight size={16} /></button>
      </Card>
    );
  }

  const { dailyAvg } = insights;
  const scaleMax = Math.max(dailyAvg, target, SUSTAINABLE_DAILY) * 1.15;
  const mark = (v) => `${Math.min(100, (v / scaleMax) * 100)}%`;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* benchmark bar */}
      <Card style={{ padding: 20 }}>
        <Eyebrow>How your daily average compares</Eyebrow>
        <div style={{ position: "relative", height: 16, background: C.bg, borderRadius: 8, margin: "26px 0 8px" }}>
          <div style={{ position: "absolute", inset: 0, width: mark(dailyAvg), background: dailyAvg <= SUSTAINABLE_DAILY ? C.good : dailyAvg <= target ? C.amber : C.warn, borderRadius: 8, transition: "width .5s" }} />
          {/* markers */}
          <Marker pos={mark(SUSTAINABLE_DAILY)} color={C.good} label={`Sustainable ${SUSTAINABLE_DAILY}`} />
          <Marker pos={mark(target)} color={C.ink} label={`Your goal ${target}`} top />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 18 }}>
          <span style={{ fontFamily: FONT_SERIF, fontSize: 32, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(dailyAvg)}</span>
          <span style={{ fontSize: 13, color: C.sub }}>kg CO₂e / day · annualised ≈ {fmtYr(dailyAvg * 365)}</span>
        </div>
      </Card>

      {/* ranked actions */}
      <div>
        <Eyebrow>Your biggest levers, ranked by yearly impact</Eyebrow>
      </div>
      {insights.list.map((ins, i) => {
        const c = CATS[ins.cat];
        return (
          <Card key={i} style={{ padding: 18, display: "flex", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: c.color, display: "grid", placeItems: "center", flexShrink: 0 }}>
              <c.icon size={20} color="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div style={{ fontWeight: 600, fontSize: 15.5, lineHeight: 1.25 }}>{ins.title}</div>
                <div style={{ flexShrink: 0, background: C.brandSoft, color: C.brand, fontWeight: 700, fontSize: 12.5, padding: "4px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                  −{fmtYr(ins.saving)}/yr
                </div>
              </div>
              <p style={{ color: C.sub, fontSize: 13.5, marginTop: 6, lineHeight: 1.55 }}>{ins.body}</p>
            </div>
          </Card>
        );
      })}

      {/* wins */}
      {insights.wins.length > 0 && (
        <Card style={{ padding: 18, background: C.brandSoft, border: `1px solid ${C.brandSoft}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Leaf size={17} color={C.brand} />
            <span style={{ fontWeight: 600, fontSize: 14.5, color: C.brand }}>What you’re already doing well</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {insights.wins.map((w, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 13.5, color: C.ink }}>
                <Check size={16} color={C.good} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{w}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
function Marker({ pos, color, label, top }) {
  return (
    <div style={{ position: "absolute", left: pos, top: 0, height: "100%", transform: "translateX(-50%)" }}>
      <div style={{ width: 2, height: "100%", background: color }} />
      <div style={{ position: "absolute", [top ? "bottom" : "top"]: top ? 20 : 20, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: 10.5, color, fontWeight: 600 }}>
        {label}
      </div>
    </div>
  );
}

/* ================================================================ SETTINGS */
function SettingsView({ settings, setSettings, clearAll, count }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card style={{ padding: 20 }}>
        <Eyebrow>Your details</Eyebrow>
        <label style={{ ...lbl, marginTop: 14 }}>Name (optional)</label>
        <input value={settings.name} placeholder="What should we call you?"
          onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))} style={input} />

        <label style={{ ...lbl, marginTop: 18 }}>
          Daily carbon budget · <strong style={{ color: C.brand }}>{settings.target} kg CO₂e</strong>
        </label>
        <input type="range" min="3" max="25" step="0.5" value={settings.target}
          onChange={(e) => setSettings((s) => ({ ...s, target: parseFloat(e.target.value) }))}
          style={{ width: "100%", accentColor: C.brand, marginTop: 8 }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.sub }}>
          <span>3 (very low)</span><span>25 (high)</span>
        </div>
        <p style={{ fontSize: 12.5, color: C.sub, marginTop: 12, lineHeight: 1.55, padding: "10px 12px", background: C.bg, borderRadius: 10 }}>
          The long-term sustainable target is about <strong>5.5 kg/day</strong> (~2 tonnes a year). Many people start far higher — set a budget you can actually beat, then ratchet it down.
        </p>
      </Card>

      <Card style={{ padding: 20 }}>
        <Eyebrow>Your data</Eyebrow>
        <p style={{ fontSize: 13.5, color: C.sub, margin: "10px 0 14px", lineHeight: 1.5 }}>
          {count} {count === 1 ? "entry" : "entries"} saved on this device. Nothing leaves it.
        </p>
        {!confirm ? (
          <button onClick={() => setConfirm(true)} style={{ ...ghostBtn, color: C.warn, borderColor: C.warnSoft }}>
            <Trash2 size={15} /> Clear all entries
          </button>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, color: C.warn, fontWeight: 600 }}>Delete everything? This can’t be undone.</span>
            <button onClick={() => { clearAll(); setConfirm(false); }} style={{ ...primaryBtn, background: C.warn }}>Yes, clear</button>
            <button onClick={() => setConfirm(false)} style={ghostBtn}>Cancel</button>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================================================================ shared: recent ledger list */
function RecentLedger({ entries, onDelete, limit = 6, title = "Ledger" }) {
  const rows = entries.slice(0, limit);
  if (rows.length === 0) return null;
  return (
    <Card style={{ padding: 6 }}>
      <div style={{ padding: "12px 14px 8px" }}><Eyebrow>{title}</Eyebrow></div>
      {rows.map((e) => {
        const c = CATS[e.cat];
        return (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: `1px solid ${C.bg}` }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: c.color, display: "grid", placeItems: "center", flexShrink: 0 }}>
              <c.icon size={16} color="#fff" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {FACTORS[e.cat]?.[e.type]?.label || e.type}
              </div>
              <div style={{ fontSize: 11.5, color: C.sub }}>
                {e.amount} {c.unit} · {dayKeyToDate(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(entryCO2(e))} kg</span>
            <button onClick={() => onDelete(e.id)} style={{ border: "none", background: "none", cursor: "pointer", color: C.sub, padding: 4, display: "grid", placeItems: "center" }} title="Remove">
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
    </Card>
  );
}

/* ---------------------------------------------------------------- inline style objects */
const primaryBtn = {
  display: "inline-flex", alignItems: "center", gap: 8, background: C.brand, color: "#fff",
  border: "none", borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 600,
  cursor: "pointer", fontFamily: FONT_SANS,
};
const ghostBtn = {
  display: "inline-flex", alignItems: "center", gap: 7, background: C.surface, color: C.sub,
  border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 14px", fontSize: 13.5, fontWeight: 600,
  cursor: "pointer", fontFamily: FONT_SANS,
};
const input = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
  border: `1px solid ${C.line}`, fontSize: 14, fontFamily: FONT_SANS, color: C.ink, background: C.surface, outline: "none",
};
const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 6 };
