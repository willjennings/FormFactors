/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VoiceTool } from './voice/types';

// --- Single source of truth for the point-and-speak demo content ---
//
// Two orthogonal taxonomies keep this sustainable as we add programs and actions:
//
//   1. ElementCategory — WHAT is on screen (program / os / ui / content). Drives the
//      highlight HUE. See CATEGORY_COLORS.
//   2. ActionCategory  — WHAT a task asks you to do (edit / format / file / share /
//      photo / …). Drives task grouping + the chip shown on each task card.
//
// Tasks live in ONE reusable TASK_LIBRARY. Each task declares which programs it applies
// to (a specific list, or 'all' for cross-cutting actions like Save / Share). The active
// program's carousel is derived by `tasksForProgram()` — so a "Share" task is authored
// ONCE and appears in every program, and adding a new action type or a new program is a
// local, additive edit here. Nothing in App.tsx needs to change to add content.

export type ProgramId = 'word' | 'excel' | 'powerpoint' | 'photo';

// ── Axis 1: element category (highlight hue) ───────────────────────────────────────
export type ElementCategory = 'program' | 'os' | 'ui' | 'content';

export const CATEGORY_COLORS: Record<ElementCategory, string> = {
  program: '59, 130, 246',  // blue   — the application itself (ribbon, app chrome)
  os: '34, 197, 94',        // green  — OS / workspace surface around the app
  ui: '245, 158, 11',       // amber  — interactive UI controls (buttons, menus)
  content: '139, 92, 246',  // purple — document content (text, cells, slides, image)
};

export const CATEGORY_LABELS: Record<ElementCategory, string> = {
  program: 'Program',
  os: 'OS / Workspace',
  ui: 'UI control',
  content: 'Content',
};

// Category for regions that aren't one of the program's images (e.g. the lower
// workspace/preview pane that App.tsx still calls "Google Maps").
export const DEFAULT_CATEGORY: ElementCategory = 'os';

// ── Axis 2: action category (what a task does) ─────────────────────────────────────
export type ActionCategory =
  | 'identify'  // pinpoint / "what is this?"
  | 'lookalike' // the honest-mode ambiguity beat (confusable controls)
  | 'edit'      // change content
  | 'format'    // styling / appearance
  | 'insert'    // add an object (chart, slide, shape)
  | 'photo'     // image-editing actions
  | 'file'      // save / open / export (cross-program)
  | 'share';    // send outward (cross-program)

export interface ActionMeta {
  label: string;
  /** "r, g, b" triplet for the task-card chip. */
  color: string;
}

export const ACTION_CATEGORIES: Record<ActionCategory, ActionMeta> = {
  identify: { label: 'Identify', color: '100, 116, 139' }, // slate
  lookalike: { label: 'Look-alike', color: '245, 158, 11' }, // amber
  edit: { label: 'Edit', color: '139, 92, 246' },          // purple
  format: { label: 'Format', color: '236, 72, 153' },      // pink
  insert: { label: 'Insert', color: '20, 184, 166' },      // teal
  photo: { label: 'Photo', color: '249, 115, 22' },        // orange
  file: { label: 'File', color: '59, 130, 246' },          // blue
  share: { label: 'Share', color: '34, 197, 94' },         // green
};

// Order tasks appear in the carousel (a coherent arc: identify → showcase → do → ship).
const ACTION_ORDER: ActionCategory[] = [
  'identify', 'lookalike', 'edit', 'format', 'insert', 'photo', 'file', 'share',
];

// ── Programs (images only — tasks come from the shared library) ─────────────────────
export interface ProgramImage {
  id: number;
  url: string;
  /** Primary key: used for pointer hit-testing and for matching the AI's named result. */
  title: string;
  category: ElementCategory;
  /** Seeded look-alikes — point here and honest mode asks which one you meant. */
  confusableWith?: string[];
}

export interface Program {
  id: ProgramId;
  /** Shown in the runtime program dropdown, e.g. "Microsoft Word". */
  label: string;
  images: ProgramImage[];
}

// As consumed by the canvas renderer / hit-tester (bbox is filled from the DOM layout).
export interface InteractiveObject {
  name: string;
  bbox: number[];
  category?: ElementCategory;
}

// Placeholder imagery so the demo runs out of the box. Swap these `url`s for real
// program screenshots — that's the only change needed.
const ph = (seed: string) => `https://picsum.photos/seed/${seed}/400/533`;

export const PROGRAMS: Program[] = [
  {
    id: 'word',
    label: 'Microsoft Word',
    images: [
      { id: 1, url: ph('word-ribbon'), title: 'Word Ribbon', category: 'program' },
      { id: 2, url: ph('word-save'), title: 'Save button', category: 'ui', confusableWith: ['Save As button'] },
      { id: 3, url: ph('word-saveas'), title: 'Save As button', category: 'ui' },
      { id: 4, url: ph('word-body'), title: 'Document body', category: 'content' },
    ],
  },
  {
    id: 'excel',
    label: 'Microsoft Excel',
    images: [
      { id: 1, url: ph('excel-ribbon'), title: 'Excel Ribbon', category: 'program' },
      { id: 2, url: ph('excel-sum'), title: 'SUM function', category: 'ui', confusableWith: ['AVERAGE function'] },
      { id: 3, url: ph('excel-avg'), title: 'AVERAGE function', category: 'ui' },
      { id: 4, url: ph('excel-cell'), title: 'Cell A1', category: 'content' },
    ],
  },
  {
    id: 'powerpoint',
    label: 'Microsoft PowerPoint',
    images: [
      { id: 1, url: ph('ppt-ribbon'), title: 'PowerPoint Ribbon', category: 'program' },
      { id: 2, url: ph('ppt-new'), title: 'New Slide button', category: 'ui', confusableWith: ['Duplicate Slide button'] },
      { id: 3, url: ph('ppt-dup'), title: 'Duplicate Slide button', category: 'ui' },
      { id: 4, url: ph('ppt-slide'), title: 'Slide canvas', category: 'content' },
    ],
  },
  {
    id: 'photo',
    label: 'Photo Editor',
    images: [
      { id: 1, url: ph('photo-toolbar'), title: 'Editor Toolbar', category: 'program' },
      { id: 2, url: ph('photo-crop'), title: 'Crop tool', category: 'ui', confusableWith: ['Resize tool'] },
      { id: 3, url: ph('photo-resize'), title: 'Resize tool', category: 'ui' },
      { id: 4, url: ph('photo-canvas'), title: 'Image canvas', category: 'content' },
    ],
  },
];

export const DEFAULT_PROGRAM: ProgramId = 'word';

export const getProgram = (id: ProgramId): Program =>
  PROGRAMS.find(p => p.id === id) ?? PROGRAMS[0];

// ── The reusable task library ───────────────────────────────────────────────────────
// `programs: 'all'` → cross-cutting action authored once, shown everywhere.
// `targetElement`   → the element title this task points at; its image is used on the
//                     card (keeping card art consistent with the highlight). Omit + set
//                     `image` for a standalone illustrative image.
export interface ScenarioTask {
  /** Stable identity for authoring/debugging (not shown). */
  key: string;
  action: ActionCategory;
  title: string;
  description: string;
  /** Carousel extracts the quoted phrase via /"(.*?)"/ — keep a quoted example. */
  hint: string;
  programs: ProgramId[] | 'all';
  targetElement?: string;
  image?: string;
}

// A task as consumed by the App carousel: image resolved, numeric positional id assigned.
export interface ResolvedTask {
  id: number;
  key: string;
  action: ActionCategory;
  title: string;
  description: string;
  hint: string;
  image: string;
  /** The on-screen element this scenario wants the user to point at (if any). */
  targetElement?: string;
}

export const TASK_LIBRARY: ScenarioTask[] = [
  // ── Cross-cutting actions (authored once, appear in every program) ──
  { key: 'identify', action: 'identify', programs: 'all',
    title: 'Pinpointing',
    description: 'Point at a control and ask what it does. When it’s sure, it just tells you — no friction.',
    hint: 'Say "What is this?"' },
  { key: 'cant-tell', action: 'identify', programs: 'all',
    title: 'When it can’t tell',
    description: 'Point at empty space or a crowded toolbar and ask what it is. Instead of inventing an answer, it admits it isn’t sure.',
    hint: 'Say "What’s that?"' },
  { key: 'save', action: 'file', programs: 'all',
    title: 'Save your work',
    description: 'Ask it to save the current file. A file action is consequential, so honest mode confirms before it writes.',
    hint: 'Say "Save this"', image: ph('file-save') },
  { key: 'export-pdf', action: 'file', programs: 'all',
    title: 'Export as PDF',
    description: 'Ask it to export a copy. It shows the format and destination before producing the file.',
    hint: 'Say "Export this as a PDF"', image: ph('file-pdf') },
  { key: 'pattern', action: 'file', programs: 'all',
    title: 'It spots a pattern',
    description: 'Point at a few things without asking for anything. Honest mode notices, offers to help — and never acts unless you say yes.',
    hint: 'When it offers, say "Yes please"' },
  { key: 'share-person', action: 'share', programs: 'all',
    title: 'Share with a person',
    description: 'Ask it to send your work to someone. Outward actions show exactly who and what before anything goes out.',
    hint: 'Say "Share this with Lia"', image: ph('share-person') },
  { key: 'email-copy', action: 'share', programs: 'all',
    title: 'Email a copy',
    description: 'Ask it to email the file. It witness-renders the recipient and attachment before sending.',
    hint: 'Say "Email this to my team"', image: ph('share-email') },

  // ── Word ──
  { key: 'word.lookalike', action: 'lookalike', programs: ['word'], targetElement: 'Save button',
    title: 'The look-alike',
    description: 'Save and Save As sit side by side and look near-identical. Point at Save — honest mode asks which one you mean instead of silently overwriting your file.',
    hint: 'Say "Save this"' },
  { key: 'word.bold', action: 'format', programs: ['word'], targetElement: 'Document body',
    title: 'Format the text',
    description: 'Point at the document body and ask to style it.',
    hint: 'Say "Make this bold"' },
  { key: 'word.heading', action: 'edit', programs: ['word'], targetElement: 'Document body',
    title: 'Insert a heading',
    description: 'Point where you want a heading and dictate it.',
    hint: 'Say "Add a heading here"' },

  // ── Excel ──
  { key: 'excel.lookalike', action: 'lookalike', programs: ['excel'], targetElement: 'SUM function',
    title: 'The look-alike',
    description: 'SUM and AVERAGE buttons look almost the same. Point at SUM — honest mode asks which aggregate you meant instead of guessing the wrong formula.',
    hint: 'Say "Total this column"' },
  { key: 'excel.enter', action: 'edit', programs: ['excel'], targetElement: 'Cell A1',
    title: 'Enter a value',
    description: 'Point at a cell and ask to fill it in.',
    hint: 'Say "Put 100 here"' },
  { key: 'excel.currency', action: 'format', programs: ['excel'], targetElement: 'Cell A1',
    title: 'Format as currency',
    description: 'Point at a cell or range and ask to reformat it.',
    hint: 'Say "Format this as currency"' },
  { key: 'excel.chart', action: 'insert', programs: ['excel'], targetElement: 'Cell A1',
    title: 'Insert a chart',
    description: 'Point across some cells and ask for a chart.',
    hint: 'Say "Make a chart from this"' },

  // ── PowerPoint ──
  { key: 'ppt.lookalike', action: 'lookalike', programs: ['powerpoint'], targetElement: 'New Slide button',
    title: 'The look-alike',
    description: 'New Slide and Duplicate Slide sit together and look alike. Point at New Slide — honest mode asks which one you meant before changing your deck.',
    hint: 'Say "Add a slide"' },
  { key: 'ppt.new-slide', action: 'insert', programs: ['powerpoint'], targetElement: 'New Slide button',
    title: 'Insert a slide',
    description: 'Point at the New Slide button and ask to add one.',
    hint: 'Say "Add a slide"' },
  { key: 'ppt.title', action: 'edit', programs: ['powerpoint'], targetElement: 'Slide canvas',
    title: 'Edit the slide',
    description: 'Point at the slide canvas and ask to change it.',
    hint: 'Say "Add a title here"' },
  { key: 'ppt.transition', action: 'format', programs: ['powerpoint'], targetElement: 'Slide canvas',
    title: 'Apply a transition',
    description: 'Point at a slide and ask for a transition.',
    hint: 'Say "Add a fade transition"' },

  // ── Photo Editor ──
  { key: 'photo.lookalike', action: 'lookalike', programs: ['photo'], targetElement: 'Crop tool',
    title: 'The look-alike',
    description: 'Crop and Resize sit next to each other and look alike. Point at Crop — honest mode asks which one you meant before altering your image.',
    hint: 'Say "Crop this"' },
  { key: 'photo.crop', action: 'photo', programs: ['photo'], targetElement: 'Image canvas',
    title: 'Crop the image',
    description: 'Point at the image and ask to crop it to a region.',
    hint: 'Say "Crop to here"' },
  { key: 'photo.brightness', action: 'photo', programs: ['photo'], targetElement: 'Image canvas',
    title: 'Adjust brightness',
    description: 'Point at the image and ask to adjust the exposure.',
    hint: 'Say "Brighten this"' },
  { key: 'photo.remove-bg', action: 'photo', programs: ['photo'], targetElement: 'Image canvas',
    title: 'Remove the background',
    description: 'Point at the subject and ask to cut out the background.',
    hint: 'Say "Remove the background here"' },
];

const orderIndex = (a: ActionCategory) => {
  const i = ACTION_ORDER.indexOf(a);
  return i === -1 ? ACTION_ORDER.length : i;
};

/**
 * Build the carousel for a program: filter the library by applicability, order by the
 * action arc, resolve each task's image (explicit → target element → first program
 * image), and assign a 1-based positional id (the App tracks completion by this id).
 */
export function tasksForProgram(programId: ProgramId): ResolvedTask[] {
  const program = getProgram(programId);
  const fallbackImage = program.images[0]?.url ?? ph(programId);
  const imageFor = (t: ScenarioTask): string => {
    if (t.image) return t.image;
    if (t.targetElement) {
      const el = program.images.find(img => img.title === t.targetElement);
      if (el) return el.url;
    }
    return fallbackImage;
  };

  return TASK_LIBRARY
    .filter(t => t.programs === 'all' || t.programs.includes(programId))
    .sort((a, b) => orderIndex(a.action) - orderIndex(b.action))
    .map((t, i) => ({
      id: i + 1,
      key: t.key,
      action: t.action,
      title: t.title,
      description: t.description,
      hint: t.hint,
      image: imageFor(t),
      targetElement: t.targetElement,
    }));
}

// ════════════════════════════════════════════════════════════════════════════════════
//  Action verbs + mock-document model
//  The action taxonomy now drives REAL voice tools and a mock document the verbs mutate.
//  Adding a new action verb (or program doc behaviour) is a local, additive edit here.
// ════════════════════════════════════════════════════════════════════════════════════

export interface ActionVerb extends VoiceTool {
  action: ActionCategory;
  /** Honest mode witness-renders 'high'-commitment verbs before committing. */
  commitment: 'low' | 'high';
}

// Uniform argument schema for every action verb.
const VERB_PARAMETERS = {
  type: 'object',
  properties: {
    target: { type: 'string', description: 'The element or region being acted on (e.g. "Document body", "Cell A1", "Slide canvas", "Image canvas").' },
    detail: { type: 'string', description: 'The specifics of the action (e.g. "bold", "currency", "title", "Fade", "crop", "brightness", "background", "PDF").' },
    confirm: { type: 'boolean', description: 'Set true ONLY after the user has explicitly confirmed. Omit/false to witness-render the interpretation first.' },
  },
  required: ['target'],
} as const;

// Verbs keyed by action category. `identify` reuses the app's existing `explain` verb and
// `share` reuses the existing `share` verb, so they are intentionally NOT redefined here;
// `lookalike` is a confidence/disambiguation beat with no verb of its own.
export const ACTION_VERBS: Partial<Record<ActionCategory, ActionVerb>> = {
  edit: {
    action: 'edit', commitment: 'high', name: 'edit_content',
    description: 'Change the content the user is pointing at (type text, enter a value, set a slide title). HIGH-COMMITMENT: it mutates the document. Witness-render WHAT and WHERE first, then commit with confirm=true after the user agrees.',
    parameters: VERB_PARAMETERS,
  },
  format: {
    action: 'format', commitment: 'high', name: 'format_content',
    description: 'Change the appearance/formatting of what the user is pointing at (bold, currency, a slide transition). HIGH-COMMITMENT. Witness-render first, then commit with confirm=true.',
    parameters: VERB_PARAMETERS,
  },
  insert: {
    action: 'insert', commitment: 'high', name: 'insert_object',
    description: 'Insert a new object (a chart, a new slide, a shape). HIGH-COMMITMENT — it adds to the document. Witness-render first, then commit with confirm=true.',
    parameters: VERB_PARAMETERS,
  },
  photo: {
    action: 'photo', commitment: 'high', name: 'photo_edit',
    description: 'Apply a photo edit to the image (crop, adjust brightness, remove background). HIGH-COMMITMENT — it alters the image. Witness-render first, then commit with confirm=true.',
    parameters: VERB_PARAMETERS,
  },
  file: {
    action: 'file', commitment: 'high', name: 'save_file',
    description: 'Save or export the current file (use detail="PDF" to export a PDF). HIGH-COMMITMENT — it writes a file. Witness-render WHAT is being written first, then commit with confirm=true.',
    parameters: VERB_PARAMETERS,
  },
};

/** All action-verb names (used by the App to recognise an action-verb tool call). */
export const ACTION_VERB_NAMES: string[] =
  Object.values(ACTION_VERBS).map(v => v!.name);

/**
 * The action verbs a program exposes — derived from the action categories actually present
 * in its task library subset. Returns clean VoiceTool objects (name/description/parameters).
 */
export function buildActionTools(programId: ProgramId): VoiceTool[] {
  const present = new Set(tasksForProgram(programId).map(t => t.action));
  const seen = new Set<string>();
  const tools: VoiceTool[] = [];
  for (const action of present) {
    const verb = ACTION_VERBS[action];
    if (!verb || seen.has(verb.name)) continue;
    seen.add(verb.name);
    tools.push({ name: verb.name, description: verb.description, parameters: verb.parameters });
  }
  return tools;
}

// ── Mock document the verbs visibly mutate ─────────────────────────────────────────────
export type MockDoc =
  | { kind: 'word'; text: string; bold: boolean; heading?: string; saved: boolean }
  | { kind: 'excel'; cells: Record<string, string>; currency: string[]; chart: boolean; saved: boolean }
  | { kind: 'powerpoint'; slides: string[]; transition?: string; saved: boolean }
  | { kind: 'photo'; cropped: boolean; brightness: number; bgRemoved: boolean; saved: boolean };

export function initialMockDoc(programId: ProgramId): MockDoc {
  switch (programId) {
    case 'excel':
      return { kind: 'excel', cells: { A1: '10', A2: '20', A3: '30' }, currency: [], chart: false, saved: false };
    case 'powerpoint':
      return { kind: 'powerpoint', slides: ['Title slide'], transition: undefined, saved: false };
    case 'photo':
      return { kind: 'photo', cropped: false, brightness: 0, bgRemoved: false, saved: false };
    case 'word':
    default:
      return { kind: 'word', text: 'The quarterly report summary.', bold: false, heading: undefined, saved: false };
  }
}

const has = (s: unknown, needle: string) => typeof s === 'string' && s.toLowerCase().includes(needle);
// Parse a cell ref like "Cell A1" / "A1" → "A1" (falls back to A1).
const cellRef = (target?: string) => (target?.match(/[A-Za-z]\d+/)?.[0]?.toUpperCase()) ?? 'A1';

/**
 * Pure reducer: given the current mock doc and an action verb call, return the next doc.
 * Unknown verb/arg combinations return the doc unchanged (safe by default).
 */
export function applyAction(doc: MockDoc, verb: string, args: { target?: string; detail?: string } = {}): MockDoc {
  const detail = args.detail ?? '';
  if (verb === 'save_file') {
    return { ...doc, saved: true };
  }
  switch (doc.kind) {
    case 'word':
      if (verb === 'format_content') return { ...doc, bold: true };
      if (verb === 'edit_content') {
        if (has(args.target, 'head') || has(detail, 'head')) return { ...doc, heading: detail || 'Heading' };
        return { ...doc, text: detail || doc.text };
      }
      return doc;
    case 'excel':
      if (verb === 'edit_content') return { ...doc, cells: { ...doc.cells, [cellRef(args.target)]: detail || '100' } };
      if (verb === 'format_content') {
        const ref = cellRef(args.target);
        return { ...doc, currency: doc.currency.includes(ref) ? doc.currency : [...doc.currency, ref] };
      }
      if (verb === 'insert_object') return { ...doc, chart: true };
      return doc;
    case 'powerpoint':
      if (verb === 'insert_object') return { ...doc, slides: [...doc.slides, `Slide ${doc.slides.length + 1}`] };
      if (verb === 'edit_content') {
        const slides = [...doc.slides];
        slides[slides.length - 1] = detail || slides[slides.length - 1];
        return { ...doc, slides };
      }
      if (verb === 'format_content') return { ...doc, transition: detail || 'Fade' };
      return doc;
    case 'photo':
      if (verb === 'photo_edit') {
        if (has(detail, 'crop') || has(args.target, 'crop')) return { ...doc, cropped: true };
        if (has(detail, 'bright') || has(detail, 'expos')) return { ...doc, brightness: Math.min(3, doc.brightness + 1) };
        if (has(detail, 'background') || has(detail, 'remove')) return { ...doc, bgRemoved: true };
        return { ...doc, cropped: true };
      }
      return doc;
  }
}

// ── Policy layer: verb class + autonomy → commit-vs-witness ────────────────────────────
// VerbClass is the policy taxonomy (speech-act force × reversibility). It is distinct from
// ActionCategory (which is about task UX) and ElementCategory (highlight hue).
export type VerbClass = 'query' | 'command' | 'control' | 'transform' | 'mutate' | 'create' | 'destroy' | 'share';

// Map every tool/verb NAME (action verbs + the tourism verbs) to its policy class.
export const VERB_CLASS: Record<string, VerbClass> = {
  // document action verbs
  edit_content: 'mutate',
  format_content: 'transform',
  insert_object: 'create',
  photo_edit: 'transform',
  save_file: 'mutate',
  // tourism / map verbs
  update_map: 'control',
  show_directions: 'control',
  explain: 'query',
  synthesize: 'create',
  share: 'share',
};

export const classOf = (verb: string): VerbClass => VERB_CLASS[verb] ?? 'command';

// DIAL A notches (Levels of Automation). 'auto-safe' is the default.
export type Autonomy = 'manual' | 'confirm' | 'auto-safe' | 'autonomous';

export const AUTONOMY_OPTIONS: { id: Autonomy; label: string }[] = [
  { id: 'manual', label: 'Manual (preview all)' },
  { id: 'confirm', label: 'Confirm changes' },
  { id: 'auto-safe', label: 'Auto-safe (default)' },
  { id: 'autonomous', label: 'Autonomous' },
];

/**
 * Decide whether a state-changing verb commits now or must be witness-rendered first.
 * `confirmed` = the model already passed confirm=true (the user said yes). Read-only
 * (query) verbs never gate; the irreversible/outward classes gate until 'autonomous'.
 */
export function decideCommit(verbClass: VerbClass, autonomy: Autonomy, confirmed: boolean): 'commit' | 'witness' {
  if (confirmed) return 'commit';
  if (verbClass === 'query') return 'commit';
  switch (autonomy) {
    case 'manual': return 'witness';
    case 'confirm': return 'witness';
    case 'auto-safe': return (verbClass === 'destroy' || verbClass === 'share') ? 'witness' : 'commit';
    case 'autonomous': return 'commit';
  }
}

// ── G5: grounding reconciliation ───────────────────────────────────────────────────────
// Map the model's free-text `target` ("the document body", "save") to one of the program's
// element titles, so it can be compared against the app's pointer hit-test. Disagreement
// between the two = a *perceived* ambiguity (real low confidence), not a seeded one.
const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function matchElement(images: ProgramImage[], text?: string): string | null {
  if (!text) return null;
  const t = normText(text);
  if (!t) return null;
  const tokens = new Set(t.split(' '));
  let best: { title: string; score: number } | null = null;
  for (const img of images) {
    const title = normText(img.title);
    let score = 0;
    if (t === title) score = 1000;
    // The full element name is contained in what was said → specific; longer = more specific.
    else if (t.includes(title)) score = 500 + title.length;
    // The phrase is a fragment of the element name → score by how much of it it covers,
    // so "save" prefers "Save button" over "Save As button".
    else if (title.includes(t)) score = 100 + Math.round((t.length / title.length) * 100);
    else score = title.split(' ').filter(w => tokens.has(w)).length; // token overlap
    if (score > 0 && (!best || score > best.score)) best = { title: img.title, score };
  }
  return best ? best.title : null;
}

/** Compact serialization of the mock document — the structured "world state" the model reads
 *  so it can see the result of its own edits (closes the action→result loop). */
export function serializeMockDoc(doc: MockDoc): string {
  switch (doc.kind) {
    case 'word':
      return `Word — text:"${doc.text}"${doc.heading ? `, heading:"${doc.heading}"` : ''}, bold:${doc.bold ? 'yes' : 'no'}, saved:${doc.saved ? 'yes' : 'no'}`;
    case 'excel':
      return `Excel — ${Object.entries(doc.cells).map(([k, v]) => `${k}=${doc.currency.includes(k) && v ? '$' + v : v}`).join(' ')}, chart:${doc.chart ? 'yes' : 'no'}, saved:${doc.saved ? 'yes' : 'no'}`;
    case 'powerpoint':
      return `PowerPoint — slides:[${doc.slides.join(', ')}]${doc.transition ? `, transition:${doc.transition}` : ''}, saved:${doc.saved ? 'yes' : 'no'}`;
    case 'photo':
      return `Photo — ${doc.cropped ? 'cropped, ' : ''}brightness:+${doc.brightness}${doc.bgRemoved ? ', background removed' : ''}, saved:${doc.saved ? 'yes' : 'no'}`;
  }
}

/** Human-readable witness text for a pending action ("About to {label} {target}"). */
export function describeAction(
  verb: string,
  args: { target?: string; detail?: string } = {},
): { label: string; target: string; detail?: string } {
  const labels: Record<string, string> = {
    edit_content: 'Edit',
    format_content: 'Format',
    insert_object: 'Insert',
    photo_edit: 'Edit photo',
    save_file: has(args.detail, 'pdf') ? 'Export' : 'Save',
  };
  return { label: labels[verb] ?? 'Apply', target: args.target ?? 'this', detail: args.detail };
}
