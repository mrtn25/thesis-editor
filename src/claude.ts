// Claude calls run directly from the browser with the user's own API key.
// The key is kept in this browser only and sent only to api.anthropic.com.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export const MODEL = 'claude-sonnet-5-5';
const KEY = 'te.apiKey';

export function getKey(): string {
  try {
    return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setKey(key: string, remember: boolean) {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    if (key) (remember ? localStorage : sessionStorage).setItem(KEY, key);
  } catch {
    /* storage blocked: key lives only until reload */
    memoryKey = key;
  }
}

let memoryKey = '';
const client = () => new Anthropic({ apiKey: getKey() || memoryKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

export interface Cost {
  input: number;
  output: number;
  usd: number;
}

/** Price at Claude Sonnet 5.5 list prices ($2 / $10 per million tokens; thinking counts as output). */
function cost(u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): Cost {
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  const usd = (input * 2 + u.output_tokens * 10) / 1_000_000;
  return { input: u.input_tokens, output: u.output_tokens, usd: Math.round(usd * 1000) / 1000 };
}

/** Turn SDK errors into a short German message. */
export function explain(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Der Claude-Key ist ungültig. Bitte unter „Claude-Key“ prüfen.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Dieser Key hat keine Berechtigung für die API.';
  if (err instanceof Anthropic.RateLimitError) return 'Zu viele Anfragen – bitte kurz warten und erneut versuchen.';
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message))
    return 'Kein Guthaben auf dem Anthropic-Konto. In der Console unter „Plans & Billing“ aufladen.';
  if (err instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zu Anthropic.';
  return err instanceof Error ? err.message : String(err);
}

async function structured<T extends z.ZodType>(schema: T, system: string, content: string, maxTokens: number): Promise<{ data: z.infer<T>; cost: Cost }> {
  const stream = client().beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: z.toJSONSchema(schema) as Record<string, unknown> },
    },
    system,
    messages: [{ role: 'user', content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Claude hat die Anfrage abgelehnt.');
  if (msg.stop_reason === 'max_tokens') throw new Error('Text zu lang für einen Durchlauf.');
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return { data: schema.parse(JSON.parse(text)), cost: cost(msg.usage) };
}

// ---------- Analyse ----------

const AnalysisSchema = z.object({
  sentences: z.array(
    z.object({
      sid: z.string(),
      section: z.string(),
      move: z.string(),
      role: z.enum(['claim', 'evidence', 'warrant', 'qualifier', 'rebuttal', 'context']),
      argument: z.string().nullable(),
    }),
  ),
  arguments: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      verdict: z.enum(['coherent', 'partial', 'broken']),
      missing: z.array(z.string()),
      comment: z.string(),
      sids: z.array(z.string()),
    }),
  ),
  sections: z.array(
    z.object({
      section: z.string(),
      presentMoves: z.array(z.string()),
      missingMoves: z.array(z.string()),
      advice: z.string(),
    }),
  ),
});

const ANALYZE_SYSTEM = `You are a writing tutor for academic theses. You analyse the rhetorical structure of a draft. You never rewrite it.

For every sentence (identified by sid) decide:
- section: which of the given thesis sections the sentence functionally belongs to (by what it does, not only by the heading above it). Use exactly one of the given section names.
- move: the rhetorical move inside that section, chosen from the given move list for that section (exact name), or "" for headings.
- role: its Toulmin role in an argument: claim, evidence (data, cited studies, figures), warrant (the reasoning that links evidence to claim), qualifier (hedges, scope limits), rebuttal (counter-arguments or limits addressed), or context (transitions, definitions, headings, metadata).
- argument: the id of the argument the sentence belongs to (e.g. "A1"), or null for context sentences.

Then list the arguments. An argument is a claim plus the sentences that support or limit it, usually within one or two paragraphs. Give each a short title (in German), a verdict:
- coherent: claim, evidence and a warrant are present and fit together;
- partial: one element is missing or weak (e.g. claim without a source, evidence without explaining why it supports the claim);
- broken: the evidence does not support the claim, or the reasoning contradicts itself.
List missing elements by role name and add a one or two sentence comment in German that says concretely what to add or fix.

Finally, for each section that occurs in the text, list which moves are present and which are missing, and give one short piece of advice in German about structure or order.

Be strict but fair. Judge only what is in the text. Never mention sids inside titles, comments or advice; quote a few words of the sentence instead.`;

export async function analyze(sentences: { sid: string; text: string; heading: boolean }[], sections: { name: string; moves: string[] }[]) {
  const sectionSpec = sections.map((s) => `- ${s.name}: ${s.moves.map((m) => `"${m}"`).join(', ')}`).join('\n');
  const doc = sentences.map((s) => `[${s.sid}]${s.heading ? ' (HEADING)' : ''} ${s.text}`).join('\n');
  return structured(AnalysisSchema, ANALYZE_SYSTEM, `Sections and their moves:\n${sectionSpec}\n\nDraft, one sentence per line:\n${doc}`, 64000);
}

// ---------- Kohärenz ----------

const CoherenceSchema = z.object({
  researchQuestion: z.string().nullable(),
  overall: z.object({ score: z.number(), summary: z.string() }),
  thread: z.array(z.object({ section: z.string(), status: z.enum(['ok', 'weak', 'missing']), comment: z.string(), blockIds: z.array(z.string()) })),
  transitions: z.array(z.object({ fromBlock: z.string(), toBlock: z.string(), issue: z.string(), fix: z.string() })),
  consistency: z.array(z.object({ blockIds: z.array(z.string()), issue: z.string(), fix: z.string() })),
});

const COHERENCE_SYSTEM = `You review the coherence of a thesis draft, the way a careful supervisor would. You do not rewrite it.
Check four things, all in German in your output:
1. Golden thread: find the research question(s) or aim. For each section that is present, say whether it serves that question (ok / weak / missing link) and why. Introduction should lead to the question, the literature should justify it, the method should be able to answer it, findings and discussion should answer exactly it, the conclusion should close the loop.
2. Argument chain across paragraphs: where does one paragraph not follow from the previous one (missing transition, jump in topic, a step of reasoning left out)? Only report real breaks.
3. Consistency: contradicting claims, a key term used with shifting meaning, numbers or names that do not match, a promise in one place that is not kept elsewhere.
4. An overall score from 1 (incoherent) to 5 (fully coherent) with a two-sentence summary.
Reference paragraphs by their ids only in the id fields, never inside comment, issue or fix texts (quote a few words instead). Each issue gets a concrete fix in one sentence. Be specific, skip praise, report at most the 8 most important transitions and 8 consistency issues.`;

export async function coherence(blocks: { id: string; section: string; text: string }[]) {
  const doc = blocks.map((b) => `[${b.id}] (${b.section || 'front matter'}) ${b.text}`).join('\n\n');
  const res = await structured(CoherenceSchema, COHERENCE_SYSTEM, `Draft, one paragraph per entry with its id and section:\n\n${doc}`, 32000);
  res.data.overall.score = Math.min(5, Math.max(1, Math.round(res.data.overall.score)));
  return res;
}

// ---------- Umschreiben ----------

const MODES: Record<string, string> = {
  clearer: 'Make it clearer and easier to follow. Shorter sentences where a sentence carries two ideas.',
  shorter: 'Make it more concise. Remove redundancy and filler; keep every substantive point.',
  academic: 'Make the register more precise and academic: exact terms instead of vague ones, appropriate hedging, no colloquialisms. Do not make it more ornate.',
  transition: 'Improve the transitions so each sentence follows from the previous one and the link to the surrounding argument is explicit.',
  argument: 'Sharpen the argument: state the claim plainly, make the link between evidence and claim explicit. Where evidence is missing, insert a placeholder like [SOURCE NEEDED] instead of inventing one.',
};

const REWRITE_SYSTEM = `You are an editor for a master's thesis written in English. You improve a passage the author selected.
Rules:
- Keep the author's meaning, claims and level of certainty. Do not add new claims, facts or sources.
- Keep every citation exactly as written, in the same position relative to the claim it supports.
- Keep the author's own voice and vocabulary where it already works; change only what the instruction asks for.
- Plain, precise academic English. No filler, no buzzwords, no em-dash chains.
Return JSON with "rewritten" (the new passage) and "notes" (one or two sentences in German on what you changed and why).`;

const RewriteSchema = z.object({ rewritten: z.string(), notes: z.string() });

export async function rewrite(text: string, mode: string, section?: string, context?: string) {
  const instruction = MODES[mode] ?? MODES.clearer;
  const content = `Instruction: ${instruction}\n${section ? `This passage is part of the ${section} section.\n` : ''}${
    context ? `Surrounding paragraph for context (do not rewrite):\n${context}\n\n` : ''
  }Passage to edit:\n${text}`;
  return structured(RewriteSchema, REWRITE_SYSTEM, content, 16000);
}

// ---------- Quellen (OpenAlex, free, CORS-enabled) ----------

export async function evidence(q: string) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(q.slice(0, 300))}&per-page=6&sort=relevance_score:desc&select=id,doi,display_name,publication_year,cited_by_count,authorships,primary_location`;
  const r = await fetch(url);
  if (r.status === 429) throw new Error('OpenAlex ist gerade überlastet – bitte in etwa einer halben Minute nochmal versuchen.');
  if (!r.ok) throw new Error('OpenAlex nicht erreichbar.');
  const data = (await r.json()) as { results: any[] };
  return data.results.map((w) => ({
    title: w.display_name as string,
    year: w.publication_year as number,
    cited: w.cited_by_count as number,
    doi: w.doi as string | null,
    venue: (w.primary_location?.source?.display_name ?? null) as string | null,
    authors: (w.authorships ?? []).slice(0, 3).map((a: any) => a.author?.display_name).filter(Boolean) as string[],
  }));
}
