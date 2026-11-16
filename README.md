# Thesis Editor

Ein Word-Editor im Browser für Abschlussarbeiten. Er öffnet und speichert echte `.docx`-Dateien und zeigt mit Claude, wie eine Arbeit aufgebaut ist: welcher Satz zu welchem Abschnitt gehört, welche rhetorischen Schritte fehlen und ob die Argumente tragen.

*A browser-based Word editor for theses that uses Claude to visualise structure, rhetorical moves and argument coherence. German UI.*

## Was er kann

- **.docx öffnen und speichern.** Formatierung bleibt erhalten (Editor: [SuperDoc](https://github.com/superdoc/docx-editor)). Die Farbmarkierungen sind nur eine Ansicht und landen nie in der Datei.
- **Text einfärben nach …**
  - **Abschnitt**: zu welchem Teil der Arbeit jeder Satz gehört (Introduction, Methodology …).
  - **Schritt**: welcher rhetorische Schritt („Move“) der Satz im Abschnitt ist, z. B. Hinführung → Forschungslücke → Forschungsfrage (Swales 1990).
  - **Argument-Rolle**: Behauptung, Beleg, Begründung, Einschränkung, Gegenargument (Toulmin 1958).
- **Gliederung**: typischer Aufbau einer Master Thesis mit Zweck, Schritten und Literaturgrundlage je Abschnitt. Vorhandene Abschnitte lassen sich anspringen und einzeln kopieren, fehlende per „+ Abschnitt anlegen“ an der richtigen Stelle einfügen. Eigene Abschnitte sind möglich.
- **Kohärenz**: roter Faden von der Forschungsfrage bis zum Fazit, Brüche zwischen Absätzen, Widersprüche, Gesamtnote 1–5 und ein Urteil je Argument. Klick auf einen Befund springt zur Stelle.
- **Quellen suchen** für unbelegte Behauptungen über [OpenAlex](https://openalex.org) (kostenlos, ohne Key).
- **Satzanfänge** je Abschnitt und Schritt.
- **Umschreiben**: markierte Passage klarer, kürzer, präziser, mit besseren Übergängen oder schärferem Argument. Inhalt, Zitate und Ton bleiben; Übernahme als nachverfolgte Änderung.
- **KI-Protokoll**: jeder Vorschlag wird festgehalten und lässt sich als Markdown für die Erklärung zur KI-Nutzung im Anhang kopieren.

Ohne API-Key läuft eine einfache Heuristik (Abschnitte nach Überschriften, Rollen nach Signalwörtern). Kohärenz-Check, Schritte und Umschreiben brauchen Claude.

## Eigener API-Key

Jede Person nutzt ihren eigenen Anthropic-API-Key (Button „Claude-Key“ oben rechts). Der Key bleibt im Browser und geht nur direkt an `api.anthropic.com`; die App hat keinen eigenen Server. Abgerechnet wird über das Anthropic-Konto der Person. Einen Key gibt es auf [console.anthropic.com](https://console.anthropic.com/settings/keys).

## Installation

Online: einfach die gehostete Version öffnen, Key eintragen, `.docx` laden.

Lokal, mit [Node.js](https://nodejs.org) 20 oder neuer:

```bash
git clone https://github.com/mrtn25/thesis-editor.git
cd thesis-editor
npm install
npm run dev
```

Dann <http://localhost:5180> öffnen, Claude-Key eintragen, eine `.docx` laden und „Analysieren“ klicken.

Selbst hosten: Die App ist eine statische Seite (`npm run build` → `dist/`). Auf Vercel reicht „Import Git Repository“, das Framework (Vite) wird erkannt.

## Kosten

Der Editor nutzt Claude Sonnet 5.5 ($2 / $10 pro Million Tokens). Für eine Arbeit mit ca. 2.500 Wörtern (geschätzt aus einer Messung mit Opus 5.5, Sonnet kostet je Token die Hälfte):

| Aktion | ca. Kosten |
|---|---|
| Analysieren | ca. 0,20 $ |
| Kohärenz prüfen | ca. 0,15–0,30 $ |
| Eine Passage umschreiben | < 0,02 $ |

Ergebnisse werden pro Datei im Browser gespeichert und beim nächsten Öffnen ohne neue Kosten geladen. Neu analysieren lohnt sich erst nach Textänderungen. Die Kosten jedes Laufs stehen in der Statuszeile, die Summe im Reiter „KI-Protokoll“.

## Datenschutz

Beim Analysieren und Umschreiben schickt der Browser den Text direkt an die Anthropic API. Die Quellensuche schickt nur den betreffenden Satz an OpenAlex. Dokumente, Analysen und Protokoll bleiben sonst lokal (Browser-Speicher).

## Aufbau

- `src/main.ts`: Oberfläche, SuperDoc, Farb-Layer (render-only über `ctx.visuals.highlight`)
- `src/shared.ts`: Abschnitte, Schritte, Satzanfänge, Heuristik
- `src/claude.ts`: Claude-Aufrufe aus dem Browser (Analyse, Kohärenz, Umschreiben; Structured Outputs) und Quellensuche über OpenAlex

## Lizenz

AGPL-3.0, wie SuperDoc. Wer eine veränderte Version öffentlich betreibt, muss deren Quellcode ebenfalls offenlegen.
