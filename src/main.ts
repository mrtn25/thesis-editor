import { SuperDoc, defineSuperDocExtension } from 'superdoc';
import 'superdoc/style.css';
import './style.css';
import {
  DEFAULT_SECTIONS,
  ROLES,
  heuristicAnalysis,
  splitSentences,
  type Analysis,
  type Role,
  type SectionDef,
  type Sentence,
} from './shared';

type View = 'sections' | 'moves' | 'roles' | 'off';
type Tab = 'outline' | 'coherence' | 'phrases' | 'rewrite' | 'log';

interface LogEntry {
  at: string;
  mode: string;
  before: string;
  after: string;
  accepted: boolean;
}

interface Coherence {
  source: 'claude' | 'offline';
  researchQuestion: string | null;
  overall: { score: number; summary: string } | null;
  thread: { section: string; status: 'ok' | 'weak' | 'missing'; comment: string; blockIds: string[] }[];
  transitions: { fromBlock: string; toBlock: string; issue: string; fix: string }[];
  consistency: { blockIds: string[]; issue: string; fix: string }[];
}

interface Block {
  id: string;
  type: string;
  text: string;
  heading: boolean;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Drop internal block/sentence ids (e.g. "(15#4)", "(7ED86F17)") that sometimes leak into Claude's comments. */
const clean = (s: string) => esc(s.replace(/\s*\((?:[0-9A-F]{6,}(?:#\d+)?|\d+#\d+)(?:[,;]\s*(?:[0-9A-F]{6,}(?:#\d+)?|\d+#\d+))*\)/gi, ''));

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  },
};

const SECTIONS_KEY = 'te.sections.v2';

const state = {
  superdoc: null as SuperDoc | null,
  layer: null as any,
  issueLayer: null as any,
  fileName: 'thesis',
  blocks: [] as Block[],
  sentences: [] as Sentence[],
  headings: new Map<string, string>(),
  targets: new Map<string, unknown>(),
  analysis: null as Analysis | null,
  /** Blocks the user created through "+ Abschnitt anlegen" keep their section. */
  manualSection: new Map<string, string>(),
  coherence: null as Coherence | null,
  coherenceBusy: false,
  view: 'sections' as View,
  tab: 'outline' as Tab,
  sections: store.get<SectionDef[]>(SECTIONS_KEY, structuredClone(DEFAULT_SECTIONS)),
  log: store.get<LogEntry[]>('te.log', []),
  claude: false,
  rewrite: null as null | { text: string; target: unknown; result?: { rewritten: string; notes: string }; mode?: string; busy?: boolean; error?: string },
  focusSid: null as string | null,
  /** Set when the analysis was restored from this browser's storage instead of freshly computed. */
  cachedAt: null as string | null,
  stale: false,
  spend: store.get<number>('te.spend', 0),
};

const usd = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

function track(cost?: { usd: number }) {
  if (!cost) return '';
  state.spend += cost.usd;
  store.set('te.spend', state.spend);
  return ` · Kosten ca. ${usd(cost.usd)}`;
}

// ---------- Saved results (per file name, in this browser) ----------

const cacheKey = () => `te.cache.${state.fileName}`;

function textHash() {
  let h = 2166136261;
  for (const s of state.sentences) for (let i = 0; i < s.text.length; i++) h = Math.imul(h ^ s.text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

function saveCache() {
  if (state.analysis?.source !== 'claude') return;
  store.set(cacheKey(), { at: new Date().toISOString(), hash: textHash(), analysis: state.analysis, coherence: state.coherence });
}

async function restoreCache(): Promise<boolean> {
  const c = store.get<any>(cacheKey(), null);
  if (!c?.analysis) return false;
  const sids = new Set(state.sentences.map((s) => s.sid));
  state.analysis = { ...c.analysis, sentences: c.analysis.sentences.filter((l: { sid: string }) => sids.has(l.sid)) };
  state.coherence = c.coherence ?? null;
  state.cachedAt = c.at;
  state.stale = c.hash !== textHash();
  setStatus('Lade gespeicherte Analyse …');
  await resolveTargets();
  paint();
  setStatus(`Gespeicherte Analyse vom ${new Date(c.at).toLocaleString('de-DE')} geladen – kostet nichts`);
  return true;
}

function cacheNote() {
  if (!state.cachedAt) return '';
  return `<p class="stale">Gespeicherte Analyse vom ${new Date(state.cachedAt).toLocaleString('de-DE')}.${
    state.stale ? ' Der Text hat sich seitdem geändert – für aktuelle Ergebnisse „Analysieren“ klicken.' : ' Neu analysieren ist nur nach Textänderungen nötig.'
  }</p>`;
}
if (import.meta.env.DEV) (window as any).__te = state;

function setStatus(msg: string) {
  $('#status').textContent = msg;
}

const doc = () => state.superdoc?.activeEditor?.doc as any;

// ---------- SuperDoc ----------

const Overlay = defineSuperDocExtension({
  id: 'thesis.overlay',
  activate(ctx) {
    state.layer = ctx.visuals.highlight('layer', { className: 'te-mark' });
    state.issueLayer = ctx.visuals.highlight('issues', { className: 'te-issue', scope: 'block' });
    ctx.onMutation({ affects: ['text'] }, () => {
      state.layer?.invalidate();
      state.issueLayer?.invalidate();
    });
  },
});

function openDocument(file: File | Blob, name: string) {
  state.superdoc?.destroy();
  $('#toolbar').innerHTML = '';
  state.fileName = name.replace(/\.docx$/i, '');
  state.analysis = null;
  state.coherence = null;
  state.cachedAt = null;
  state.manualSection.clear();
  state.targets.clear();
  setStatus('Lade Dokument …');
  state.superdoc = new SuperDoc({
    selector: '#editor',
    document: file as any,
    documentMode: 'editing',
    user: { name: 'Autor', email: 'author@local' },
    ui: { toolbar: { container: '#toolbar' } },
    extensions: [Overlay],
    onReady: async () => {
      await readBlocks();
      ($('#analyze') as HTMLButtonElement).disabled = false;
      ($('#export') as HTMLButtonElement).disabled = false;
      if (!(await restoreCache())) setStatus(`${state.sentences.length} Sätze geladen – jetzt „Analysieren“`);
      render();
    },
  } as any);
}

async function readBlocks() {
  const result = await doc().extract({});
  state.blocks = [];
  state.sentences = [];
  state.headings.clear();
  for (const b of result.blocks as { nodeId: string; type: string; text: string; tableContext?: unknown }[]) {
    const text = (b.text ?? '').trim();
    if (!text) continue;
    const words = text.split(/\s+/).length;
    const heading =
      b.type === 'heading' ||
      (!b.tableContext && words <= 8 && text.length < 80 && !/[.:;,]$/.test(text) && /^[A-ZÄÖÜ0-9]/.test(text));
    state.blocks.push({ id: b.nodeId, type: b.type, text: b.text, heading });
    // Stable sentence ids (block id + index) so labels survive re-reading after an insert.
    if (heading) {
      state.headings.set(b.nodeId, text);
      state.sentences.push({ sid: `${b.nodeId}#0`, blockId: b.nodeId, blockType: b.type, text });
    } else {
      splitSentences(text).forEach((s, i) => state.sentences.push({ sid: `${b.nodeId}#${i}`, blockId: b.nodeId, blockType: b.type, text: s }));
    }
  }
}

async function matchTarget(s: Sentence) {
  const block = state.blocks.find((b) => b.id === s.blockId)?.text ?? '';
  const pattern = block.includes(s.text) ? s.text : s.text.slice(0, 60);
  const select = { type: 'text', pattern, caseSensitive: true };
  for (const within of [{ kind: 'block', nodeType: s.blockType, nodeId: s.blockId }, undefined]) {
    try {
      const m = await doc().query.match({ select, ...(within ? { within } : {}), require: 'any', limit: 1 });
      const item = m.items?.[0];
      if (item?.matchKind === 'text') return item.target;
    } catch {
      /* try without block scope */
    }
  }
  return null;
}

async function resolveTargets(only?: Sentence[]) {
  if (!only) state.targets.clear();
  for (const s of only ?? state.sentences) {
    const t = await matchTarget(s);
    if (t) state.targets.set(s.sid, t);
  }
}

// ---------- Section model ----------

function labelOf(sid: string) {
  return state.analysis?.sentences.find((l) => l.sid === sid);
}

/** Section per block: manual choice first, otherwise majority vote of its sentences. */
function blockSections(): Map<string, string> {
  const out = new Map<string, string>();
  const bySid = new Map(state.analysis?.sentences.map((l) => [l.sid, l.section]) ?? []);
  for (const b of state.blocks) {
    const manual = state.manualSection.get(b.id);
    if (manual) {
      out.set(b.id, manual);
      continue;
    }
    const votes = new Map<string, number>();
    state.sentences.filter((s) => s.blockId === b.id).forEach((s) => {
      const sec = bySid.get(s.sid);
      if (sec) votes.set(sec, (votes.get(sec) ?? 0) + 1);
    });
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) out.set(b.id, best);
  }
  return out;
}

function sectionBlocks(name: string): Block[] {
  const map = blockSections();
  return state.blocks.filter((b) => map.get(b.id) === name);
}

function sectionIndex(name: string) {
  const i = state.sections.findIndex((s) => s.name === name);
  return i < 0 ? -1 : i % 8;
}

function moveIndex(section: string, move: string) {
  const sec = state.sections.find((s) => s.name === section);
  const i = sec ? sec.moves.findIndex((m) => m.name === move) : -1;
  return i < 0 ? 5 : i % 6;
}

function paint() {
  if (!state.layer) return;
  if (!state.analysis || state.view === 'off') return state.layer.clear();
  const targets: unknown[] = [];
  const focusArg = state.focusSid ? labelOf(state.focusSid)?.argument : null;
  for (const s of state.sentences) {
    const label = labelOf(s.sid);
    const target = state.targets.get(s.sid);
    if (!label || !target) continue;
    const section = state.manualSection.get(s.blockId) ?? label.section;
    let cls = '';
    if (state.view === 'sections') cls = sectionIndex(section) >= 0 ? `te-sec-${sectionIndex(section)}` : '';
    else if (state.view === 'moves') cls = label.move ? `te-mv-${moveIndex(section, label.move)}` : '';
    else if (state.view === 'roles') cls = section && section !== 'References' ? `te-role-${label.role}` : '';
    if (!cls) continue;
    if (focusArg && label.argument === focusArg) cls += ' te-focus';
    targets.push({ target, className: `te-mark ${cls}`, data: { sid: s.sid } });
  }
  state.layer.replace(targets);
}

async function showIssue(blockIds: string[]) {
  const targets: unknown[] = [];
  for (const id of blockIds) {
    const s = state.sentences.find((x) => x.blockId === id);
    const t = s && state.targets.get(s.sid);
    if (t) targets.push(t);
  }
  state.issueLayer?.replace(targets);
  if (blockIds[0]) await state.superdoc?.scrollToElement(blockIds[0]);
}

// ---------- Analyse ----------

async function analyze() {
  if (!state.sentences.length) return;
  const btn = $('#analyze') as HTMLButtonElement;
  btn.disabled = true;
  try {
    if (state.claude) {
      setStatus('Claude ordnet Sätze zu Abschnitten, Moves und Argumenten … (1–3 Min.)');
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentences: state.sentences.map(({ sid, text, blockId }) => ({ sid, text, blockType: state.headings.has(blockId) ? 'heading' : 'text' })),
          sections: state.sections.map((s) => ({ name: s.name, moves: s.moves.map((m) => m.name) })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? r.statusText);
      state.analysis = data;
    } else {
      setStatus('Ohne Claude: einfache Heuristik …');
      state.analysis = heuristicAnalysis(state.sentences, state.sections, state.headings);
    }
    state.coherence = null;
    state.cachedAt = null;
    const costNote = track((state.analysis as any).cost);
    saveCache();
    setStatus('Markiere Text …');
    await resolveTargets();
    paint();
    const src = state.analysis!.source === 'claude' ? 'Claude' : 'Heuristik (ohne Claude)';
    setStatus(`Analyse: ${src} · ${state.targets.size}/${state.sentences.length} Sätze markiert${costNote}`);
  } catch (e) {
    setStatus(`Fehler: ${e instanceof Error ? e.message : e}`);
  } finally {
    btn.disabled = false;
    render();
  }
}

// ---------- Outline actions ----------

/** Insert heading + placeholder after the last present section before it (or before the next present one). */
async function addSection(index: number) {
  const sec = state.sections[index];
  const map = blockSections();
  const lastOf = (name: string) => [...state.blocks].reverse().find((b) => map.get(b.id) === name);
  const firstOf = (name: string) => state.blocks.find((b) => map.get(b.id) === name);
  let at: any = { kind: 'documentEnd' };
  const prev = state.sections.slice(0, index).reverse().map((s) => lastOf(s.name)).find(Boolean);
  const next = state.sections.slice(index + 1).map((s) => firstOf(s.name)).find(Boolean);
  if (prev) at = { kind: 'after', target: { kind: 'block', nodeType: prev.type, nodeId: prev.id } };
  else if (next) at = { kind: 'before', target: { kind: 'block', nodeType: next.type, nodeId: next.id } };

  const h = await doc().create.heading({ level: 1, at, text: sec.name });
  if (!h?.success) return setStatus(`Konnte Abschnitt nicht anlegen: ${h?.failure?.message ?? 'unbekannt'}`);
  const firstMove = sec.moves[0];
  const placeholder = firstMove ? `[${firstMove.name}: z. B. „${firstMove.phrases[0]}“]` : '[Hier schreiben …]';
  const p = await doc().create.paragraph({ at: { kind: 'after', target: h.heading }, text: placeholder });

  state.manualSection.set(h.heading.nodeId, sec.name);
  if (p?.success) state.manualSection.set(p.paragraph.nodeId, sec.name);
  await readBlocks();
  const fresh = state.sentences.filter((s) => state.manualSection.has(s.blockId) && !labelOf(s.sid));
  if (state.analysis)
    state.analysis.sentences.push(...fresh.map((s) => ({ sid: s.sid, section: sec.name, move: s.blockId === h.heading.nodeId ? '' : firstMove?.name ?? '', role: 'context' as Role, argument: null })));
  else state.analysis = heuristicAnalysis(state.sentences, state.sections, state.headings);
  await resolveTargets(fresh);
  paint();
  render();
  await state.superdoc?.scrollToElement((p?.success ? p.paragraph : h.heading).nodeId);
  setStatus(`„${sec.name}“ angelegt – Platzhalter überschreiben`);
}

async function copySection(name: string) {
  const text = sectionBlocks(name).map((b) => b.text.trim()).join('\n\n');
  await navigator.clipboard.writeText(text).catch(() => {});
  setStatus(`„${name}“ kopiert (${text.split(/\s+/).length} Wörter)`);
}

// ---------- Coherence ----------

function offlineCoherence(): Coherence {
  // Without Claude: flag paragraphs that make claims but cite nothing.
  const map = blockSections();
  const issues: Coherence['consistency'] = [];
  for (const b of state.blocks) {
    const sec = map.get(b.id);
    if (b.heading || !sec || sec === 'References') continue;
    const labels = state.sentences.filter((s) => s.blockId === b.id).map((s) => labelOf(s.sid)?.role);
    if (labels.filter((r) => r === 'claim').length >= 2 && !labels.includes('evidence'))
      issues.push({ blockIds: [b.id], issue: 'Mehrere Behauptungen, aber kein erkennbarer Beleg im Absatz.', fix: 'Quelle oder Daten ergänzen, oder Behauptung als eigene These kennzeichnen.' });
  }
  return { source: 'offline', researchQuestion: null, overall: null, thread: [], transitions: [], consistency: issues };
}

async function checkCoherence() {
  if (!state.analysis) return setStatus('Erst „Analysieren“ klicken.');
  if (!state.claude) {
    state.coherence = offlineCoherence();
    return render();
  }
  state.coherenceBusy = true;
  render();
  setStatus('Claude prüft Kohärenz … (1–3 Min.)');
  const map = blockSections();
  try {
    const r = await fetch('/api/coherence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks: state.blocks.filter((b) => map.get(b.id) !== 'References').map((b) => ({ id: b.id, section: map.get(b.id) ?? '', text: b.text })) }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? r.statusText);
    state.coherence = { source: 'claude', ...data };
    saveCache();
    setStatus(`Kohärenz geprüft${track(data.cost)}`);
  } catch (e) {
    setStatus(`Fehler: ${e instanceof Error ? e.message : e}`);
  } finally {
    state.coherenceBusy = false;
    render();
  }
}

// ---------- Panels ----------

function legend(): string {
  const hint = (t: string) => `<p class="legend-hint">${t}</p>`;
  if (state.view === 'sections')
    return hint('Farbe = zu welchem Teil der Arbeit der Satz gehört. Ein Methodik-Satz mitten in der Einleitung fällt so sofort auf.') +
      state.sections.map((s, i) => `<span class="chip te-sec-${i % 8}">${esc(s.name)}</span>`).join('');
  if (state.view === 'roles')
    return hint('Farbe = Rolle des Satzes im Argument. Eine orange Behauptung ohne grünen Beleg in der Nähe ist unbelegt.') +
      (Object.keys(ROLES) as Role[]).map((r) => `<span class="chip te-role-${r}" title="${esc(ROLES[r].hint)}">${ROLES[r].label}</span>`).join('');
  if (state.view === 'moves')
    return hint('Farbe = welcher Schritt im Abschnitt. In der Einleitung z. B. 1 = Hinführung, 2 = Lücke, 3 = Ziel & Frage. Die Namen je Abschnitt stehen unter „Gliederung“.') +
      [0, 1, 2, 3, 4].map((i) => `<span class="chip te-mv-${i}">${i + 1}. Schritt</span>`).join('');
  return '';
}

/** One pill per role: filled with a count when present, dashed when a core role is missing. */
function rolePills(roles: Role[], missing: string[] = []): string {
  const order: Role[] = ['claim', 'evidence', 'warrant', 'qualifier', 'rebuttal'];
  const core: Role[] = ['claim', 'evidence', 'warrant'];
  return order
    .map((r) => {
      const n = roles.filter((x) => x === r).length;
      const weak = missing.includes(r);
      if (n && weak) return `<span class="chip te-role-${r} weak" title="Es gibt ${n} Satz/Sätze dieser Rolle, Claude hält sie aber für nicht tragfähig">${ROLES[r].label}<span class="n">${n}</span> · zu schwach</span>`;
      if (n) return `<span class="chip te-role-${r}" title="${n} Satz/Sätze mit dieser Rolle">${ROLES[r].label}<span class="n">${n}</span></span>`;
      return core.includes(r) || weak ? `<span class="chip absent" title="Kein Satz mit dieser Rolle">${ROLES[r].label} fehlt</span>` : '';
    })
    .join('');
}

function renderOutline(): string {
  const reports = new Map(state.analysis?.sections.map((r) => [r.section, r]) ?? []);
  const cards = state.sections
    .map((s, i) => {
      const blocks = state.analysis ? sectionBlocks(s.name) : [];
      const present = blocks.length > 0;
      const words = blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
      const r = reports.get(s.name);
      const moves = s.moves
        .map((m, j) => {
          const ok = r?.presentMoves.includes(m.name);
          const miss = r?.missingMoves.includes(m.name) || (!present && state.analysis);
          return `<li class="${ok ? 'ok' : miss ? 'miss' : ''}"><span class="dot te-mv-${j % 6}"></span>${esc(m.name)}${ok ? ' ✓' : r?.missingMoves.includes(m.name) ? ' <em>fehlt</em>' : ''}</li>`;
        })
        .join('');
      const actions = !state.analysis
        ? ''
        : present
          ? `<div class="row"><button class="btn small" data-jump="${esc(s.name)}">Hinspringen</button><button class="btn small" data-copy="${esc(s.name)}">Abschnitt kopieren</button></div>`
          : `<div class="row"><button class="btn small primary" data-add="${i}">+ Abschnitt anlegen</button></div>`;
      return `<div class="card section ${present ? '' : 'empty'}" style="--c: var(--sec-${i % 8})">
        <div class="card-h"><span class="chip te-sec-${i % 8}">${i + 1}. ${esc(s.name)}</span>
          <span class="muted">${state.analysis ? (present ? `${words} Wörter` : 'noch leer') : ''}</span>
          <button class="link" data-remove="${i}" title="Aus der Gliederung entfernen">×</button></div>
        ${s.purpose ? `<p class="purpose">${esc(s.purpose)}</p>` : ''}
        ${moves ? `<ol class="moves">${moves}</ol>` : ''}
        ${r?.advice ? `<p class="advice">${clean(r.advice)}</p>` : ''}
        ${s.basis ? `<p class="basis">Grundlage: ${esc(s.basis)}</p>` : ''}
        ${actions}
      </div>`;
    })
    .join('');
  return `${cacheNote()}
    <p class="muted">Typischer Aufbau einer Master Thesis. Jeder Abschnitt hat feste rhetorische Schritte („Moves“) aus der Genre-Forschung. Nach „Analysieren“ siehst du, was schon da ist und was fehlt.</p>
    ${cards}
    <form id="add-section" class="row"><input name="name" placeholder="Eigener Abschnitt, z. B. Theoretical Framework" /><button class="btn">+</button></form>
    <button class="link" id="reset-sections">Standard-Gliederung wiederherstellen</button>`;
}

const STATUS_LABEL = { ok: 'trägt', weak: 'schwach', missing: 'fehlt' };
const VERDICT_LABEL = { coherent: 'schlüssig', partial: 'lückenhaft', broken: 'trägt nicht' };

function renderCoherence(): string {
  const c = state.coherence;
  const a = state.analysis;
  const intro = `${cacheNote()}<p class="muted">Prüft drei Ebenen: roter Faden von der Forschungsfrage bis zum Fazit, Übergänge zwischen Absätzen, und ob jedes Argument aus Behauptung, Beleg und Begründung besteht (Toulmin 1958).</p>
    <button class="btn primary" id="coherence" ${state.coherenceBusy || !a ? 'disabled' : ''}>${state.coherenceBusy ? 'Prüfe …' : 'Kohärenz prüfen'}</button>
    ${!a ? '<p class="muted">Erst „Analysieren“ klicken.</p>' : ''}`;
  let body = '';
  if (c) {
    if (c.source === 'offline')
      body += '<p class="muted">Ohne Claude nur eine Grobprüfung: Absätze mit Behauptungen ohne Beleg. Roter Faden und Übergänge brauchen den API-Key.</p>';
    if (c.overall)
      body += `<div class="card score"><div class="card-h"><strong>Gesamt</strong><span class="score-n">${c.overall.score}/5</span></div><p class="advice">${clean(c.overall.summary)}</p></div>`;
    if (c.researchQuestion) body += `<h4>Forschungsfrage</h4><blockquote>${esc(c.researchQuestion)}</blockquote>`;
    if (c.thread.length)
      body += '<h4>Roter Faden</h4>' + c.thread
        .map((t) => `<div class="card issue thread ${t.status}" data-blocks="${esc(t.blockIds.join(','))}"><div class="card-h"><span class="chip te-sec-${Math.max(0, sectionIndex(t.section))}">${esc(t.section)}</span><span class="verdict ${t.status}">${STATUS_LABEL[t.status]}</span></div><p class="advice">${clean(t.comment)}</p></div>`)
        .join('');
    if (c.transitions.length)
      body += '<h4>Brüche zwischen Absätzen</h4>' + c.transitions
        .map((t) => `<div class="card issue" data-blocks="${esc(`${t.fromBlock},${t.toBlock}`)}"><p>${clean(t.issue)}</p><p class="advice">→ ${clean(t.fix)}</p></div>`)
        .join('');
    if (c.consistency.length)
      body += `<h4>${c.source === 'offline' ? 'Behauptungen ohne Beleg' : 'Widersprüche & Begriffe'}</h4>` + c.consistency
        .map((t) => `<div class="card issue" data-blocks="${esc(t.blockIds.join(','))}"><p>${clean(t.issue)}</p><p class="advice">→ ${clean(t.fix)}</p></div>`)
        .join('');
    if (!c.thread.length && !c.transitions.length && !c.consistency.length) body += '<p class="muted">Keine Auffälligkeiten gefunden.</p>';
  }
  if (a?.arguments.length) {
    const text = new Map(state.sentences.map((s) => [s.sid, s.text]));
    body += '<h4>Argumente einzeln</h4><p class="muted">Die Pills zählen, wie viele Sätze eines Arguments welche Rolle haben. Rot gestrichelt = fehlt ganz, roter Rand = vorhanden, aber zu schwach. Klick auf eine Karte rahmt das Argument im Text.</p>' + a.arguments
      .map((g) => {
        const claimSid = a.sentences.find((l) => l.argument === g.id && l.role === 'claim')?.sid ?? g.sids[0];
        const claim = claimSid ? text.get(claimSid) ?? '' : '';
        return `<div class="card arg ${g.verdict}" data-sid="${esc(claimSid ?? '')}">
          <div class="card-h"><strong>${esc(g.title)}</strong><span class="verdict ${g.verdict}">${VERDICT_LABEL[g.verdict]}</span></div>
          <p class="claim">${esc(claim.slice(0, 200))}${claim.length > 200 ? ' …' : ''}</p>
          <div class="roles">${rolePills(g.sids.map((sid) => a.sentences.find((l) => l.sid === sid)?.role).filter(Boolean) as Role[], g.missing)}</div>
          <p class="advice">${clean(g.comment)}</p>
          ${g.missing.includes('evidence') ? `<button class="btn small" data-evidence="${esc(claimSid ?? '')}">Quellen suchen (OpenAlex)</button><div class="evidence" data-for="${esc(claimSid ?? '')}"></div>` : ''}
        </div>`;
      })
      .join('');
  }
  return intro + body;
}

function renderPhrases(): string {
  return `<p class="muted">Typische Satzanfänge je Abschnitt und Schritt. Klick kopiert.</p>` + state.sections
    .filter((s) => s.moves.length)
    .map(
      (s, i) => `<details class="card"${i === 0 ? ' open' : ''}><summary><span class="chip te-sec-${sectionIndex(s.name)}">${esc(s.name)}</span></summary>
      ${s.moves.map((m, j) => `<h4><span class="dot te-mv-${j % 6}"></span>${esc(m.name)}</h4><div class="phrases">${m.phrases.map((p) => `<button class="phrase" data-phrase="${esc(p)}">${esc(p)}</button>`).join('')}</div>`).join('')}</details>`,
    )
    .join('');
}

const MODE_LABELS: Record<string, string> = {
  clearer: 'Klarer',
  shorter: 'Kürzer',
  academic: 'Präziser / wissenschaftlicher',
  transition: 'Übergänge verbessern',
  argument: 'Argument schärfen',
};

function renderRewrite(): string {
  const r = state.rewrite;
  if (!state.claude) return '<p class="muted">Umschreiben braucht Claude. Lege in <code>~/thesis-editor/.env</code> einen <code>ANTHROPIC_API_KEY</code> an und starte neu.</p>';
  return `<p class="muted">Text im Dokument markieren, dann übernehmen. Claude behält Inhalt, Zitate und deinen Ton. Übernommene Vorschläge landen als <strong>nachverfolgte Änderung</strong> im Dokument und im KI-Protokoll.</p>
    <button class="btn" id="grab">Markierung übernehmen</button>
    ${r ? `${r.text ? `<blockquote>${esc(r.text)}</blockquote>` : ''}
      ${r.text ? `<div class="modes">${Object.entries(MODE_LABELS).map(([k, v]) => `<button class="btn small${r.mode === k ? ' primary' : ''}" data-mode="${k}" ${r.busy ? 'disabled' : ''}>${v}</button>`).join('')}</div>` : ''}` : ''}
    ${r?.busy ? '<p class="muted">Claude schreibt …</p>' : ''}
    ${r?.error ? `<p class="miss">${esc(r.error)}</p>` : ''}
    ${r?.result ? `<div class="card"><p>${esc(r.result.rewritten)}</p><p class="advice">${esc(r.result.notes)}</p>
      <div class="row"><button class="btn primary" id="accept">Als Änderung einfügen</button><button class="btn" id="discard">Verwerfen</button></div></div>` : ''}`;
}

function renderLog(): string {
  const rows = state.log
    .slice()
    .reverse()
    .map((e) => `<div class="card"><div class="card-h"><span>${new Date(e.at).toLocaleString('de-DE')}</span><span class="muted">${esc(MODE_LABELS[e.mode] ?? e.mode)} · ${e.accepted ? 'übernommen' : 'verworfen'}</span></div>
      <p class="before">${esc(e.before)}</p><p class="after">${esc(e.after)}</p></div>`)
    .join('');
  return `<p class="muted">Jeder KI-Vorschlag wird hier protokolliert. Daraus lässt sich die Erklärung zur KI-Nutzung für den Anhang erstellen.</p>
    <p class="muted">API-Kosten in diesem Browser bisher: <strong>ca. ${usd(state.spend)}</strong> (Listenpreis Claude Sonnet 5.5; genaue Abrechnung in der Anthropic Console).</p>
    <div class="row"><button class="btn" id="log-md" ${state.log.length ? '' : 'disabled'}>Als Markdown kopieren</button><button class="link" id="log-clear">Protokoll leeren</button></div>
    ${rows || '<p class="muted">Noch keine Einträge.</p>'}`;
}

function render() {
  const html = { outline: renderOutline, coherence: renderCoherence, phrases: renderPhrases, rewrite: renderRewrite, log: renderLog }[state.tab]();
  $('#panel').innerHTML = html;
  $('#legend').innerHTML = state.analysis ? legend() : '';
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  document.querySelectorAll<HTMLButtonElement>('.views button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
}

// ---------- Rewrite ----------

async function grabSelection() {
  if (!doc()) return;
  const sel = await doc().selection.current({ includeText: true });
  state.rewrite = !sel || sel.empty || !sel.text?.trim()
    ? { text: '', target: null, error: 'Bitte zuerst Text im Dokument markieren.' }
    : { text: sel.text, target: sel.target };
  render();
}

async function runRewrite(mode: string) {
  const r = state.rewrite;
  if (!r?.text) return;
  Object.assign(r, { mode, busy: true, error: undefined, result: undefined });
  render();
  const hit = state.sentences.find((s) => r.text.includes(s.text.slice(0, 40)));
  const section = hit ? blockSections().get(hit.blockId) : undefined;
  try {
    const resp = await fetch('/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: r.text, mode, section, context: hit ? state.blocks.find((b) => b.id === hit.blockId)?.text : undefined }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error ?? resp.statusText);
    r.result = data;
    setStatus(`Vorschlag fertig${track(data.cost)}`);
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
  } finally {
    r.busy = false;
    render();
  }
}

function addLog(accepted: boolean) {
  const r = state.rewrite;
  if (!r?.result) return;
  state.log.push({ at: new Date().toISOString(), mode: r.mode ?? '', before: r.text, after: r.result.rewritten, accepted });
  store.set('te.log', state.log);
}

async function acceptRewrite() {
  const r = state.rewrite;
  if (!r?.result || !doc()) return;
  let target = r.target;
  if (!target) {
    const m = await doc().query.match({ select: { type: 'text', pattern: r.text, caseSensitive: true }, require: 'any', limit: 1 });
    target = m.items?.[0]?.target;
  }
  const receipt = await doc().replace({ target, text: r.result.rewritten }, { changeMode: 'tracked' });
  if (receipt && receipt.success === false) {
    r.error = receipt.failure?.message ?? 'Einfügen fehlgeschlagen – bitte neu markieren.';
    return render();
  }
  addLog(true);
  state.rewrite = null;
  setStatus('Änderung eingefügt (nachverfolgt). Nach größeren Änderungen neu analysieren.');
  render();
}

async function findEvidence(sid: string, box: HTMLElement) {
  const text = state.sentences.find((s) => s.sid === sid)?.text ?? '';
  box.innerHTML = '<p class="muted">Suche …</p>';
  const r = await fetch(`/api/evidence?q=${encodeURIComponent(text.replace(/\([^)]*\)/g, '').slice(0, 200))}`);
  const data = await r.json();
  box.innerHTML = (data.results ?? [])
    .map((w: any) => `<div class="paper"><a href="${w.doi ?? '#'}" target="_blank" rel="noopener">${esc(w.title ?? '')}</a>
      <span class="muted">${esc((w.authors ?? []).join(', '))} · ${w.year ?? ''} · ${esc(w.venue ?? '')} · ${w.cited ?? 0}× zitiert</span></div>`)
    .join('') || '<p class="muted">Nichts gefunden.</p>';
}

// ---------- Wiring ----------

$('#file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) openDocument(f, f.name);
});
$('#sample').addEventListener('click', async () => {
  const blob = await (await fetch('/api/sample')).blob();
  openDocument(new File([blob], 'sample.docx', { type: blob.type }), 'sample.docx');
});
$('#analyze').addEventListener('click', analyze);
$('#export').addEventListener('click', () => state.superdoc?.export({ exportedName: `${state.fileName}-bearbeitet` } as any));

document.querySelector('.views')!.addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.view as View | undefined;
  if (!v) return;
  state.view = v;
  paint();
  render();
});
document.querySelector('.tabs')!.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.tab as Tab | undefined;
  if (!t) return;
  state.tab = t;
  if (t === 'coherence' && state.view !== 'roles') {
    state.view = 'roles';
    paint();
  }
  if (t !== 'coherence') state.issueLayer?.clear();
  render();
});

const saveSections = () => store.set(SECTIONS_KEY, state.sections);

$('#panel').addEventListener('click', async (e) => {
  const el = e.target as HTMLElement;
  const data = (name: string) => el.closest<HTMLElement>(`[data-${name}]`)?.getAttribute(`data-${name}`);
  if (data('remove') != null) {
    state.sections.splice(Number(data('remove')), 1);
    saveSections();
    paint();
    return render();
  }
  if (data('add') != null) return addSection(Number(data('add')));
  if (data('copy')) return copySection(data('copy')!);
  if (data('jump')) {
    const b = sectionBlocks(data('jump')!)[0];
    if (b) await state.superdoc?.scrollToElement(b.id);
    return;
  }
  if (el.id === 'reset-sections') {
    state.sections = structuredClone(DEFAULT_SECTIONS);
    saveSections();
    paint();
    return render();
  }
  if (data('phrase')) {
    await navigator.clipboard.writeText(data('phrase')!).catch(() => {});
    return setStatus(`Kopiert: „${data('phrase')}“`);
  }
  if (data('evidence') != null) {
    const id = data('evidence')!;
    const box = $('#panel').querySelector<HTMLElement>(`.evidence[data-for="${CSS.escape(id)}"]`);
    if (box) await findEvidence(id, box);
    return;
  }
  if (data('mode')) return runRewrite(data('mode')!);
  if (el.id === 'grab') return grabSelection();
  if (el.id === 'accept') return acceptRewrite();
  if (el.id === 'discard') {
    addLog(false);
    state.rewrite = null;
    return render();
  }
  if (el.id === 'coherence') return checkCoherence();
  if (el.id === 'log-md') {
    const md = state.log
      .map((e) => `- ${new Date(e.at).toLocaleString('de-DE')} · ${MODE_LABELS[e.mode] ?? e.mode} · ${e.accepted ? 'übernommen' : 'verworfen'}\n  - Vorher: ${e.before}\n  - Vorschlag: ${e.after}`)
      .join('\n');
    await navigator.clipboard.writeText(`# Protokoll der KI-Nutzung (Claude, ${new Date().toLocaleDateString('de-DE')})\n\n${md}\n`).catch(() => {});
    return setStatus('Protokoll als Markdown kopiert');
  }
  if (el.id === 'log-clear') {
    state.log = [];
    store.set('te.log', state.log);
    return render();
  }
  const blocks = data('blocks');
  if (blocks) return showIssue(blocks.split(',').filter(Boolean));
  const sid = el.closest<HTMLElement>('.arg')?.dataset.sid;
  if (sid) {
    state.focusSid = sid;
    paint();
    const s = state.sentences.find((x) => x.sid === sid);
    if (s) await state.superdoc?.scrollToElement(s.blockId);
  }
});

$('#panel').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = (e.target as HTMLFormElement).elements.namedItem('name') as HTMLInputElement;
  const name = input.value.trim();
  if (!name) return;
  // Custom sections go before References.
  const refIdx = state.sections.findIndex((s) => s.name === 'References');
  state.sections.splice(refIdx < 0 ? state.sections.length : refIdx, 0, {
    name,
    keywords: [name.toLowerCase()],
    moves: [
      { name: 'Einführen', phrases: ['This section outlines …'] },
      { name: 'Ausführen', phrases: ['Specifically, …'] },
      { name: 'Überleiten', phrases: ['Taken together, …'] },
    ],
  });
  saveSections();
  render();
});

// Click on a painted sentence in "Argumente" view: frame the whole argument it belongs to.
$('#editor').addEventListener('click', (e) => {
  const sid = (e.target as HTMLElement).closest<HTMLElement>('[data-superdoc-ext-sid]')?.dataset.superdocExtSid;
  if (!sid || state.view !== 'roles') return;
  state.focusSid = state.focusSid === sid ? null : sid;
  paint();
});

(async () => {
  try {
    const s = await (await fetch('/api/status')).json();
    state.claude = s.claude;
    ($('#sample') as HTMLButtonElement).hidden = !s.sample;
    setStatus(s.claude ? `Claude verbunden (${s.model})` : 'Ohne Claude-Key: Analyse nur per Heuristik');
  } catch {
    setStatus('API-Server nicht erreichbar');
  }
  render();
})();
