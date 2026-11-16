// Shared model: sections, rhetorical moves, Toulmin roles, phrase bank, heuristic fallback.

export type Role = 'claim' | 'evidence' | 'warrant' | 'qualifier' | 'rebuttal' | 'context';

export const ROLES: Record<Role, { label: string; hint: string }> = {
  claim: { label: 'Behauptung', hint: 'Die These, die der Absatz vertritt.' },
  evidence: { label: 'Beleg', hint: 'Daten, Studien, Zitate, die die Behauptung stützen.' },
  warrant: { label: 'Begründung', hint: 'Warum der Beleg die Behauptung trägt (Schlussregel).' },
  qualifier: { label: 'Einschränkung', hint: 'Wie sicher / wie weit die Behauptung gilt.' },
  rebuttal: { label: 'Gegenargument', hint: 'Einwand oder Grenze, die adressiert wird.' },
  context: { label: 'Kontext', hint: 'Überleitung, Definition, Rahmen – trägt kein Argument.' },
};

export interface SectionDef {
  name: string;
  keywords: string[];
  /** What this part has to achieve, and the literature the move model follows. */
  purpose?: string;
  basis?: string;
  moves: { name: string; phrases: string[] }[];
}

// Moves follow Swales' CARS model for introductions and common move analyses
// for the later IMRaD parts. Phrases are our own generic templates.
export const DEFAULT_SECTIONS: SectionDef[] = [
  {
    name: 'Introduction',
    keywords: ['introduction', 'einleitung', 'topic', 'background', 'motivation', 'relevance', 'problem statement', 'research question', 'scope', 'thesis organization', 'structure of the thesis'],
    purpose: 'Führt zum Thema hin, zeigt die Forschungslücke und leitet daraus Ziel und Forschungsfrage ab.',
    basis: 'Swales (1990), CARS-Modell: Create a Research Space',
    moves: [
      {
        name: 'Feld abstecken (Relevanz)',
        phrases: [
          'X has become a central concern in …',
          'A growing body of research has examined …',
          'Recent years have seen increasing interest in …',
          'X accounts for … of …, which makes it …',
        ],
      },
      {
        name: 'Lücke aufzeigen',
        phrases: [
          'However, little is known about …',
          'Few studies have examined …',
          'What remains unclear is whether …',
          'Existing work has largely overlooked …',
        ],
      },
      {
        name: 'Lücke besetzen (Ziel, Frage, Beitrag)',
        phrases: [
          'This thesis addresses this gap by …',
          'The aim of this study is to …',
          'Specifically, it asks …',
          'The study contributes to … in two ways.',
        ],
      },
    ],
  },
  {
    name: 'Literature Review',
    keywords: ['literature', 'theory', 'theoretical', 'framework', 'review', 'state of research', 'conceptual'],
    purpose: 'Ordnet den Forschungsstand, vergleicht Positionen und begründet, worauf die eigene Arbeit aufbaut.',
    basis: 'Kwan (2006), Move-Struktur von Literature Reviews in Abschlussarbeiten',
    moves: [
      { name: 'Strömungen darstellen', phrases: ['Research on X falls into two broad streams.', 'One line of work treats X as …', 'Building on …, scholars have argued that …'] },
      { name: 'Positionen vergleichen', phrases: ['In contrast to …, … argue that …', 'While … emphasise …, … focus on …', 'These perspectives converge on …'] },
      { name: 'Kritik / offene Punkte', phrases: ['A limitation of this work is …', 'These accounts rarely consider …', 'This assumption has been questioned by …'] },
      { name: 'Eigene Arbeit verorten', phrases: ['This thesis builds on … and extends it by …', 'Following …, I define X as …'] },
    ],
  },
  {
    name: 'Methodology',
    keywords: ['method', 'methodology', 'research design', 'data collection', 'sample', 'approach', 'procedure', 'timeline'],
    purpose: 'Macht nachvollziehbar, wie die Daten entstanden und ausgewertet wurden, und warum so.',
    basis: 'Cotos, Huffman & Link (2017), Move-Analyse von Methods-Abschnitten',
    moves: [
      { name: 'Design begründen', phrases: ['A qualitative design was chosen because …', 'This approach suits the research question because …'] },
      { name: 'Kontext & Sample', phrases: ['The study was conducted at …', 'Participants were selected using …', 'The sample comprises …'] },
      { name: 'Datenerhebung', phrases: ['Data were collected through …', 'Each interview lasted approximately …', 'The interview guide covered …'] },
      { name: 'Datenanalyse', phrases: ['The transcripts were coded following …', 'Codes were then grouped into …', 'The analysis proceeded in three steps.'] },
      { name: 'Güte & Ethik', phrases: ['To ensure trustworthiness, …', 'All participants gave informed consent.', 'A limitation of this design is …'] },
    ],
  },
  {
    name: 'Findings',
    keywords: ['finding', 'findings', 'results', 'ergebnisse'],
    purpose: 'Berichtet die Ergebnisse mit Belegen, noch ohne sie ausführlich zu deuten.',
    basis: 'Yang & Allison (2003); Brett (1994), Moves in Results-Abschnitten',
    moves: [
      { name: 'Überblick', phrases: ['Three themes emerged from the analysis.', 'This section reports …'] },
      { name: 'Ergebnis berichten', phrases: ['Most participants described …', 'A recurring pattern was …', 'In contrast, …'] },
      { name: 'Beleg zeigen', phrases: ['As one employee put it, “…”', 'Table X shows …', 'This is illustrated by …'] },
      { name: 'Kurz kommentieren', phrases: ['This suggests that …', 'Notably, …'] },
    ],
  },
  {
    name: 'Discussion',
    keywords: ['discussion', 'implication', 'implications', 'limitations', 'diskussion'],
    purpose: 'Beantwortet die Forschungsfrage, deutet die Ergebnisse im Licht der Literatur und benennt Grenzen.',
    basis: 'Hopkins & Dudley-Evans (1988); Yang & Allison (2003), Discussion-Moves',
    moves: [
      { name: 'Hauptbefund', phrases: ['The central finding of this study is …', 'Overall, the results indicate …'] },
      { name: 'Mit Literatur vergleichen', phrases: ['This is consistent with …', 'Unlike …, this study finds …'] },
      { name: 'Erklären / Deuten', phrases: ['One explanation is that …', 'This may reflect …'] },
      { name: 'Implikationen', phrases: ['For practitioners, this means …', 'Theoretically, this extends …'] },
      { name: 'Limitationen & Ausblick', phrases: ['Several limitations should be noted.', 'Future research could …'] },
    ],
  },
  {
    name: 'Conclusion',
    keywords: ['conclusion', 'fazit', 'outlook', 'summary', 'concluding'],
    purpose: 'Fasst Antwort und Beitrag zusammen und schließt den Bogen zur Einleitung.',
    basis: 'Bunton (2005), Moves in Thesis-Conclusions',
    moves: [
      { name: 'Zusammenfassen', phrases: ['This thesis set out to …', 'In sum, …', 'Returning to the question posed at the outset, …'] },
      { name: 'Beitrag', phrases: ['The main contribution is …', 'This thesis adds to … by showing …'] },
      { name: 'Ausblick', phrases: ['Looking ahead, …', 'Future work could build on this by …'] },
    ],
  },
  {
    name: 'References',
    keywords: ['references', 'reference list', 'bibliography', 'literaturverzeichnis'],
    purpose: 'Vollständige Liste aller zitierten Quellen.',
    moves: [],
  },
];

export interface Sentence {
  sid: string;
  blockId: string;
  blockType: string;
  text: string;
}

export interface SentenceLabel {
  sid: string;
  section: string;
  move: string;
  role: Role;
  argument: string | null;
}

export interface ArgumentReport {
  id: string;
  title: string;
  verdict: 'coherent' | 'partial' | 'broken';
  missing: string[];
  comment: string;
  sids: string[];
}

export interface SectionReport {
  section: string;
  presentMoves: string[];
  missingMoves: string[];
  advice: string;
}

export interface Analysis {
  source: 'claude' | 'heuristic';
  sentences: SentenceLabel[];
  arguments: ArgumentReport[];
  sections: SectionReport[];
}

/** Split a paragraph into sentences without breaking on "et al." / "e.g." etc. */
export function splitSentences(text: string): string[] {
  const protectedText = text.replace(/\b(et al|e\.g|i\.e|cf|vs|Prof|Dr|No|pp|Fig|ca|bzw|z\.B)\./g, (m) => m.replace(/\./g, '\u0000'));
  const parts = protectedText.split(/(?<=[.!?…])["”’)]?\s+(?=[A-ZÄÖÜ“"(\[])/);
  return parts.map((p) => p.replace(/\u0000/g, '.').trim()).filter((p) => p.length > 0);
}

const CITATION = /\(([A-ZÄÖÜ][^()]*?(19|20)\d{2}[a-z]?[^()]*)\)|\b[A-Z][a-z]+ (et al\. )?\((19|20)\d{2}\)/;

/** Offline fallback: section from nearest heading, role from surface cues. Clearly weaker than Claude. */
export function heuristicAnalysis(sentences: Sentence[], sections: SectionDef[], headings: Map<string, string>): Analysis {
  let current = ''; // front matter (title page etc.) until the first recognised heading
  const labels: SentenceLabel[] = [];
  const seenBlocks = new Set<string>();
  for (const s of sentences) {
    if (!seenBlocks.has(s.blockId)) {
      seenBlocks.add(s.blockId);
      const heading = headings.get(s.blockId);
      if (heading) {
        const h = heading.toLowerCase();
        const hit = sections.find((sec) => sec.keywords.some((k) => h.includes(k)) || h.includes(sec.name.toLowerCase()));
        if (hit) current = hit.name;
      }
    }
    const t = s.text;
    let role: Role = 'claim';
    if (headings.has(s.blockId) || t.split(/\s+/).length < 6) role = 'context';
    else if (/^(however|yet|but|although|while|on the other hand|critics)/i.test(t)) role = 'rebuttal';
    else if (CITATION.test(t) || /\d+(\.\d+)? ?(percent|%)/i.test(t)) role = 'evidence';
    else if (/\b(because|therefore|thus|hence|so that|this means|since)\b/i.test(t)) role = 'warrant';
    else if (/\b(may|might|could|likely|possibly|suggests?|tend)\b/i.test(t)) role = 'qualifier';
    if (current === 'References') role = 'context';
    labels.push({ sid: s.sid, section: current, move: '', role, argument: null });
  }
  return {
    source: 'heuristic',
    sentences: labels,
    arguments: [],
    sections: sections.map((sec) => ({ section: sec.name, presentMoves: [], missingMoves: [], advice: '' })),
  };
}
