/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { GoogleGenAI, Modality, GenerateContentResponse } from '@google/genai';
import type { VoiceTool, VoiceProvider, ProviderKind } from './voice/types';
import {
  X,
  CheckCircle,
  Shield,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MenuBar } from './shell/MenuBar';
import { Dock } from './shell/Dock';
import { CursorTrail, CursorResources } from './components/CursorEffects';
import { createGeminiProvider } from './voice/gemini';
import { createOpenAIRealtimeProvider } from './voice/openai';
import { createAzureRealtimeProvider } from './voice/azure';
import {
  PROGRAMS,
  DEFAULT_PROGRAM,
  getProgram,
  tasksForProgram,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  DEFAULT_CATEGORY,
  ACTION_CATEGORIES,
  buildActionTools,
  ACTION_VERB_NAMES,
  initialMockDoc,
  applyAction,
  describeAction,
  classOf,
  decideCommit,
  AUTONOMY_OPTIONS,
  serializeMockDoc,
} from './scenarios';
import type { ProgramId, ElementCategory, MockDoc, Program, Autonomy } from './scenarios';
import type { PerceivedCache } from './perception/perceiveTile';
import { buildEntities, entityById, entityByTitle, displayName, resolveEchoedTarget } from './entities/registry';
import type { SceneEntity, EntityId } from './entities/registry';
import { TeachingLayer } from './teaching/TeachingLayer';
import { emitFeedbackAudio, FEEDBACK_OPTIONS } from './feedback';
import type { FeedbackMode, FeedbackEvent } from './feedback';
import { primeEarcons } from './feedback/earcons';
import { telemetry, detectDevice } from './telemetry';
import { referents } from './referents';
import { CallDeduper, argsKey, parseRepair } from './coherence';
import { assignTargetNumbers, parseTargetSelection } from './input_targets';
import { ocrImage, terminateOcr, clearOcrCache } from './ocr';
import type { OcrWord } from './ocr';
import { buildSpreadsheetSnapshot, formatSnapshotForModel } from './widgets/spreadsheetData';
import { ProgramSurface } from './widgets/ProgramSurface';
import { ProgramWindow } from './shell/ProgramWindow';
import { Omnibox } from './shell/Omnibox';
import { DebugDrawer } from './shell/DebugDrawer';
import { clampWindow, loadWindowRect, saveWindowRect, type WindowRect } from './shell/windowState';
import { docStatusLabel } from './widgets/surfaceModels';
import type { TeachingEvent, TeachingState } from './teaching/types';
import { initialRailState, reduceRail, railComplete, type RailEvent, type RailState } from './rail/railStore';
import { respondCallToRail } from './rail/respondCallToRail';
import { buildRailDemo } from './rail/demoRail';
import { projectTeaching } from './rail/projectTeaching';
import { RailPanel } from './rail/RailPanel';
import { snapshotNode, makeThrottle } from './vision/snapshotNode';
import { parseTypedSubmit } from './input/typedInput';
import type { InputModality } from './telemetry';
import { buildInstructions } from './prompt/instructions';

// --- Types ---
interface Marker {
  x: number;
  y: number;
  timestamp: number;
  displayLabel: string;
  identifiedObject?: EntityId;
  isConsumed?: boolean;
  // Honest-mode rendering: a guess must never look like a confident success.
  confidence?: 'high' | 'low';
  candidates?: EntityId[];
  // Element category drives the highlight hue (program/os/ui/content).
  category?: ElementCategory;
}

interface BBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

interface DebugLog {
  time: string;
  type: 'info' | 'gemini' | 'tool' | 'event';
  message: string;
}

// --- Constants ---
const MAGIC_KEYWORDS = [
  "this", "that", "here", "there", "it", "that one", "this one", 
  "hear", "hair", "their", "they're", "this spot", "that spot", 
  "right here", "right there", "look at this", "look at that"
];
const SORTED_KEYWORDS = [...MAGIC_KEYWORDS].sort((a, b) => b.length - a.length);
const KEYWORD_MAP: Record<string, string> = {
  "hear": "here",
  "hair": "here",
  "their": "there",
  "they're": "there"
};

// Scenario content (TASKS / PHOTOS / interactive objects / confusable pairs) now lives
// in src/scenarios.ts, bundled per program, and is derived from the active program inside
// the App component. Swap programs (Word/Excel/PowerPoint) via the dropdown — or repoint
// the whole demo by editing scenarios.ts.

// --- DIFF 1: pointing confidence (demo-grade proxy) ---
// This is NOT a perception-confidence model. It's a composite signal — a geometric
// margin plus a seeded confusable-pairs table — sufficient to demonstrate the interaction
// grammar (hint carries confidence → low confidence triggers an honest ask). See README.
// The confusable map is passed in from the active program (e.g. Save ↔ Save As).

function computePointingConfidence(
  found: SceneEntity, hX: number, hY: number, entities: SceneEntity[],
  confusablePairs: Record<string, string[]>,
): { level: 'high' | 'low'; candidates: EntityId[]; reason: string } {
  // 1. Seeded confusable pairs — the headline ambiguity (e.g. Save ↔ Save As).
  const confusables = confusablePairs[found.title];
  if (confusables && confusables.length) {
    const confusableIds = confusables
      .map(t => entityByTitle(entities, t)?.id)
      .filter((id): id is EntityId => Boolean(id));
    return {
      level: 'low',
      candidates: [found.id, ...confusableIds],
      reason: `seeded confusable — ${found.title} looks like ${confusables.join(', ')}`,
    };
  }

  // 2. Geometric: cursor sits inside more than one photo region → ambiguous overlap.
  const containing = entities.filter(o => {
    const [ymin, xmin, ymax, xmax] = o.bbox;
    return hX >= xmin && hX <= xmax && hY >= ymin && hY <= ymax;
  });
  if (containing.length > 1) {
    return {
      level: 'low',
      candidates: containing.map(o => o.id),
      reason: `cursor inside ${containing.length} overlapping regions`,
    };
  }

  // 3. Geometric: cursor near the edge of its region → shaky hit.
  const [ymin, xmin, ymax, xmax] = found.bbox;
  const w = Math.max(1, xmax - xmin);
  const h = Math.max(1, ymax - ymin);
  const margin = Math.min(hX - xmin, xmax - hX, hY - ymin, ymax - hY);
  const edgeThreshold = 0.1 * Math.min(w, h);
  if (margin < edgeThreshold) {
    return {
      level: 'low',
      candidates: [found.id],
      reason: `near region edge (margin ${Math.round(margin)} < ${Math.round(edgeThreshold)})`,
    };
  }

  // 4. Clean hit inside a single region, no confusable → high.
  return { level: 'high', candidates: [found.id], reason: 'clean hit inside a single region' };
}

const VOICE_TOOLS: VoiceTool[] = [
  {
    name: 'respond',
    description: 'Render your answer or instructions as typed cards in the response rail. THIS IS HOW YOU DELIVER ALL INSTRUCTIONAL AND INFORMATIONAL CONTENT — one respond call per user request. Card types: do (one action: verb click/press/type/drag/open + target + text + result), answer (a short answer), orient, check (verify:"auto" with expect:{path,equals} against the document, or "user"), caution, concept (front/back), try (prompt/notice), recap (≤3 lines). Keep every text within its budget; put rationale in "why". Include exactly ONE guideLine sentence — SAY the guideLine aloud; do not speak the card contents.',
    parameters: { type: 'object', properties: {
      seq: { type: 'string', description: 'Task key for this response, e.g. "word.save" or "answer".' },
      cards: { type: 'array', items: { type: 'object', properties: {
        t: { type: 'string', description: 'do|answer|orient|check|caution|concept|try|recap' },
        text: { type: 'string' }, verb: { type: 'string' }, target: { type: 'string' },
        result: { type: 'string' }, why: { type: 'string' },
        verify: { type: 'string' }, expect: { type: 'object', properties: { path: { type: 'string' }, equals: {} } },
        front: { type: 'string' }, back: { type: 'string' }, analogy: { type: 'string' },
        prompt: { type: 'string' }, notice: { type: 'string' },
        lines: { type: 'array', items: { type: 'string' } },
      }, required: ['t'] } },
      guideLine: { type: 'string', description: 'ONE warm sentence. Speak this aloud; nothing else.' },
    }, required: ['seq', 'cards', 'guideLine'] },
  },
  {
    name: 'explain',
    description: 'Verbally name or describe what the user is pointing at (e.g. "what is this?", "what am I looking at?"). LOW-COMMITMENT: it does NOT change any state. Call it when the user asks to identify something.',
    parameters: { type: 'object', properties: { subject: { type: 'string', description: 'The on-screen element or thing being identified.' } }, required: ['subject'] },
  },
  {
    name: 'share',
    description: 'Share the current document with another person. OUTWARD, high-commitment action. Call WITHOUT confirm to witness-render the recipient and payload first; call with confirm=true only after the user explicitly approves sending.',
    parameters: { type: 'object', properties: { recipient: { type: 'string', description: 'Who to send to.' }, payload: { type: 'string', description: 'A short description of what is being shared.' }, confirm: { type: 'boolean', description: 'Set true ONLY after the user has explicitly confirmed they want it sent. Omit/false to first witness-render.' } }, required: ['recipient'] },
  },
];

const PaintLayer = ({ paths, activePath, containerSize }: { paths: { x: number, y: number }[][], activePath: { x: number, y: number }[], containerSize: { width: number, height: number } }) => {
  const allPaths = [...paths];
  if (activePath.length >= 2) allPaths.push(activePath);
  
  if (allPaths.length === 0) return null;

  return (
    <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none z-[9900]">
      {allPaths.map((path, idx) => {
        if (path.length < 2) return null;
        const points = path.map(p => ({
          x: (p.x / 1000) * containerSize.width,
          y: (p.y / 1000) * containerSize.height
        }));

        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          d += ` Q ${p1.x} ${p1.y} ${midX} ${midY}`;
        }
        d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;

        return (
          <path
            key={idx}
            d={d}
            fill="none"
            stroke="url(#gradient-trail)"
            strokeWidth="16"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: 'blur(4px)' }}
          />
        );
      })}
    </svg>
  );
};

// Physics Constants for Cursor Trail
const MIN_DISTANCE = 1;          // px - Lowered for maximum precision
const MAX_POINTS = 40;           // Hard limit to prevent memory issues
const BASE_LIFETIME = 100;       // ms - Reduced 50%
const MAX_LIFETIME = 400;        // ms - Reduced 50%
// Backends without continuous video + streaming partial transcripts (Azure/OpenAI realtime)
// get the pointing target proactively on hover-change, throttled, so "this/here" is grounded
// before the transcript lands. Min gap between proactive hints.
const HOVER_HINT_THROTTLE_MS = 700;

const LaptopSmileyIcon = ({ size = 64, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 400 300" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {/* Screen Frame */}
    <rect x="40" y="40" width="320" height="200" rx="12" stroke="currentColor" strokeWidth="12" />
    
    {/* Smiley Eyes */}
    <rect x="165" y="100" width="10" height="24" rx="5" fill="currentColor" />
    <rect x="225" y="100" width="10" height="24" rx="5" fill="currentColor" />
    
    {/* Smiley Mouth */}
    <path d="M130 155c10 40 130 40 140 0" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
    
    {/* Laptop Base */}
    <rect x="40" y="260" width="320" height="12" rx="6" fill="currentColor" />
  </svg>
);

export default function App() {
  // --- Active program (Word / Excel / PowerPoint) — single source of truth for content ---
  const [activeProgram, setActiveProgram] = useState<ProgramId>(DEFAULT_PROGRAM);
  const program = React.useMemo(() => getProgram(activeProgram), [activeProgram]);
  // The carousel is built from the shared task library, filtered + ordered for this program.
  const TASKS = React.useMemo(() => tasksForProgram(activeProgram), [activeProgram]);
  // Suggestion chips shown in the Omnibox — one per task, color-coded by action category.
  const suggestions = useMemo(() => TASKS.map(t => ({
    key: t.key,
    label: t.title,
    phrase: t.hint.match(/"(.*?)"/)?.[1] ?? t.title,
    color: ACTION_CATEGORIES[t.action].color,
  })), [TASKS]);
  // Tools offered to the voice model = the kept verbs (explain, share) + the action verbs this
  // program exposes. Read at connect time; program swap reconnects (see handleProgramChange).
  const voiceTools = React.useMemo(
    () => [...VOICE_TOOLS, ...buildActionTools(activeProgram)],
    [activeProgram],
  );
  const CONFUSABLE_PAIRS = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const img of program.images) {
      if (img.confusableWith && img.confusableWith.length) map[img.title] = img.confusableWith;
    }
    return map;
  }, [program]);
  // Scene source of truth: the entity registry (one entity per program element).
  const [entities, setEntities] = useState<SceneEntity[]>([]);
  const entitiesRef = useRef<SceneEntity[]>([]);
  // id → category, read live by the canvas renderer (kept in a ref to avoid stale closures).
  const categoryMapRef = useRef<Record<string, ElementCategory>>({});
  React.useEffect(() => {
    const m: Record<string, ElementCategory> = {};
    for (const e of entitiesRef.current) m[e.id] = e.category as ElementCategory;
    categoryMapRef.current = m;
  }, [entities]);
  const categoryOf = (id?: EntityId | null): ElementCategory =>
    (id && categoryMapRef.current[id]) || DEFAULT_CATEGORY;

  // The active scenario's target element name, read live by the canvas renderer (ref avoids
  // stale closures since the render loop's effect doesn't re-run on every task switch).
  const focusTitleRef = useRef<string | undefined>(undefined);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [firstRunHint, setFirstRunHint] = useState(true);
  const [showRotateOverlay, setShowRotateOverlay] = useState(false);
  const [showMobileOverlay, setShowMobileOverlay] = useState(false);
  // Testbed: run on phone/tablet to evaluate the paradigm across form factors, bypassing the
  // desktop-only gate + the mobile/rotate overlays.
  const [bypassDeviceGate, setBypassDeviceGate] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' || 
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);
  const [showMarkings, setShowMarkings] = useState(false);
  // honestMode === false → confident Google baseline (byte-for-byte unchanged).
  // honestMode === true  → honest variant: hints carry confidence, ask when unsure.
  const [honestMode, setHonestMode] = useState(false);
  const [voiceBackend, setVoiceBackend] = useState<ProviderKind>('gemini');
  const voiceBackendRef = useRef<ProviderKind>(voiceBackend);
  const [enableVoiceFeedback, setEnableVoiceFeedback] = useState(true);
  const [voiceVolume, setVoiceVolume] = useState(1.0);
  const [audioStatus, setAudioStatus] = useState<'suspended' | 'running' | 'closed'>('suspended');
  const [isLive, setIsLive] = useState(false);
  // Detect running inside an embedded preview iframe — such frames usually don't delegate
  // microphone access, so we surface an "open in a new tab" escape hatch.
  const [isEmbedded, setIsEmbedded] = useState(false);
  useEffect(() => {
    try { setIsEmbedded(window.self !== window.top); } catch { setIsEmbedded(true); }
  }, []);
  const [mainSize, setMainSize] = useState({ width: 0, height: 0 });
  const [liveTranscription, setLiveTranscription] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const pendingTypedRef = useRef<string | null>(null);
  const lastInputModalityRef = useRef<InputModality>('voice');
  const [lastError, setLastError] = useState<string | null>(null);
  // Draft text restored to the omnibox when a cold-start connect fails (R1 path).
  const [restoredDraft, setRestoredDraft] = useState<{ text: string; at: number } | null>(null);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [mousePos, setMousePos] = useState({ x: -100, y: -100 });
  const [isPainting, setIsPainting] = useState(false);
  const [trailMousePos, setTrailMousePos] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<EntityId | null>(null);
  const perceivedLabelsRef = useRef<PerceivedCache>({});
  const teachMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('teach');
  const railMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('rail');
  const hoveredIdRef = useRef<EntityId | null>(null);
  // Throttle state for proactive hover grounding (non-Gemini backends).
  const lastHoverHintRef = useRef<string | null>(null);
  const lastHoverHintAtRef = useRef(0);

  const showRotateOverlayRef = useRef(showRotateOverlay);
  const showMobileOverlayRef = useRef(showMobileOverlay);

  useEffect(() => {
    showRotateOverlayRef.current = showRotateOverlay;
    showMobileOverlayRef.current = showMobileOverlay;
  }, [showRotateOverlay, showMobileOverlay]);

  // honestMode is read live by the hint builder (Diff 1) and at connect time by the
  // prompt selector (Diffs 2/3). Mirror it into a ref so both can read it without
  // stale closures. If the user flips it mid-session, reconnect so the (system) prompt
  // variant matches — the hint confidence already updates live.
  const honestModeRef = useRef(honestMode);
  const isInitialHonestSync = useRef(true);
  useEffect(() => {
    honestModeRef.current = honestMode;
    if (isInitialHonestSync.current) { isInitialHonestSync.current = false; return; }
    if (isLive && providerRef.current) {
      addLog('info', `Honest mode ${honestMode ? 'ON' : 'OFF'} — reconnecting to apply prompt variant...`);
      providerRef.current.close(); // onClose sets isLive=false
      setTimeout(() => { startLiveSession(); }, 800);
    }
  }, [honestMode]);

  const isInitialBackendSync = useRef(true);
  useEffect(() => {
    voiceBackendRef.current = voiceBackend;
    if (isInitialBackendSync.current) { isInitialBackendSync.current = false; return; }
    if (isLive && providerRef.current) {
      addLog('info', `Switching voice backend to ${voiceBackend} — reconnecting...`);
      providerRef.current.close();
      setTimeout(() => { startLiveSession(); }, 800);
    }
  }, [voiceBackend]);

  // The active program now drives the tool list AND the system prompt, so a mid-session swap
  // must reconnect to load them. Runs after re-render → captures the new program's closure.
  const isInitialProgramSync = useRef(true);
  useEffect(() => {
    if (isInitialProgramSync.current) { isInitialProgramSync.current = false; return; }
    if (isLive && providerRef.current) {
      addLog('info', `Reconnecting to load ${program.label} tools + prompt...`);
      providerRef.current.close();
      setTimeout(() => { startLiveSession(); }, 800);
    }
  }, [activeProgram]);

  // Refs for logic
  const traceCanvasRef = useRef<HTMLCanvasElement>(null);
  const mainContainerRef = useRef<HTMLElement>(null);
  const cursorRef = useRef<{x: number, y: number}>({x: 500, y: 500}); // Normalized 0-1000
  const cursorHistoryRef = useRef<{x: number, y: number, t: number, hovered: EntityId | null}[]>([]);
  const markersRef = useRef<Marker[]>([]);
  const sessionRef = useRef<any>(null);
  const providerRef = useRef<VoiceProvider | null>(null);
  const lastTranscriptionTimeRef = useRef(0);
  const lastMarkerTimeRef = useRef<Record<string, number>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const lastAudioTimeRef = useRef(0);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const transcriptionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedTranscriptionRef = useRef<string>("");

  const [sendFrequency, setSendFrequency] = useState(150); // Increased frequency for better AI responsiveness
  // PHASE G: an outward share request — witness recipient + payload before sending.
  const [shareRequest, setShareRequest] = useState<{ recipient: string; payload?: string; confirmed: boolean } | null>(null);
  // Action verbs (save/edit/format/insert/photo) mutate this mock document; a pending action
  // is witness-rendered before it commits — the same grammar as `share`.
  const [mockDoc, setMockDoc] = useState<MockDoc>(() => initialMockDoc(DEFAULT_PROGRAM));
  // Live mirror so the tool-call closure can read the current doc without stale-closure risk.
  const mockDocRef = useRef(mockDoc);
  useEffect(() => { mockDocRef.current = mockDoc; }, [mockDoc]);
  // Undo stack: pre-commit document snapshots (mementos). applyAction is pure, so undo = restore.
  const [undoStack, setUndoStack] = useState<{ doc: MockDoc; label: string }[]>([]);
  // G9: dedup duplicate tool calls. G7: a layout version stamped onto deixis hints so the
  // model has temporal context (bumped on structural layout changes, e.g. program swap).
  const callDeduperRef = useRef(new CallDeduper());
  const layoutVersionRef = useRef(0);
  // G3 OCR sub-elements: opt-in word-level pointing. ocrWordsRef[title] = normalized words.
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const ocrWordsRef = useRef<Record<string, OcrWord[]>>({});
  const [hoveredWord, setHoveredWord] = useState<string | null>(null);
  const hoveredWordRef = useRef<string | null>(null);

  // Find the OCR word (if any) under a normalized 0–1000 point, mapping each word's image-
  // relative bbox into the live tile bbox. Returns the word text + its containing element.
  const wordAt = (x: number, y: number): { word: string; photoTitle: string } | null => {
    for (const obj of entitiesRef.current) {
      const [tymin, txmin, tymax, txmax] = obj.bbox;
      if (x < txmin || x > txmax || y < tymin || y > tymax) continue;
      const words = ocrWordsRef.current[obj.title];
      if (!words || words.length === 0) return null;
      const tw = txmax - txmin, th = tymax - tymin;
      for (const w of words) {
        const gx0 = txmin + w.nx0 * tw, gx1 = txmin + w.nx1 * tw;
        const gy0 = tymin + w.ny0 * th, gy1 = tymin + w.ny1 * th;
        if (x >= gx0 && x <= gx1 && y >= gy0 && y <= gy1) return { word: w.text, photoTitle: obj.title };
      }
      return null;
    }
    return null;
  };
  const [pendingAction, setPendingAction] = useState<{ verb: string; label: string; target: string; detail?: string; confirmed: boolean; note?: string } | null>(null);
  // Mirror in a ref so voice callbacks (stale closures) can read the live value.
  const pendingActionRef = useRef<typeof pendingAction>(null);
  useEffect(() => { pendingActionRef.current = pendingAction; }, [pendingAction]);

  // --- The two control dials ---
  // DIAL A (autonomy/friction): how readily verbs commit vs. witness-render first.
  const [autonomy, setAutonomy] = useState<Autonomy>('auto-safe');
  const autonomyRef = useRef<Autonomy>(autonomy);
  useEffect(() => { autonomyRef.current = autonomy; }, [autonomy]);
  // DIAL B (feedback modality): silent / earcon / app-spoken. The model never self-confirms.
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode>('earcon');
  const feedbackModeRef = useRef<FeedbackMode>(feedbackMode);
  useEffect(() => { feedbackModeRef.current = feedbackMode; }, [feedbackMode]);
  // Visual feedback channel — always on (the minimum-feedback floor), independent of DIAL B.
  const [feedbackToast, setFeedbackToast] = useState<{ outcome: FeedbackEvent['outcome']; label: string; at: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single entry point for action feedback: routes audio per DIAL B and always shows a toast.
  const emitFeedback = (ev: FeedbackEvent) => {
    emitFeedbackAudio(ev, feedbackModeRef.current);
    addLog(ev.outcome === 'error' ? 'info' : 'event', `Feedback: ${ev.outcome} — ${ev.label}`);
    setFeedbackToast({ outcome: ev.outcome, label: ev.label, at: Date.now() });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setFeedbackToast(null), 2600);
  };
  const [layoutBounds, setLayoutBounds] = useState<{
    window: BBox;
    photoItems: { id: number; bbox: BBox }[];
    surface?: BBox;
  } | null>(null);
  const defaultWindowRect = (): WindowRect => clampWindow({ x: 48, y: 48, w: 680, h: 620 },
    { width: mainContainerRef.current?.clientWidth ?? 1200, height: mainContainerRef.current?.clientHeight ?? 800 });
  const [windowRect, setWindowRect] = useState<WindowRect>(() => loadWindowRect(DEFAULT_PROGRAM) ?? { x: 48, y: 48, w: 680, h: 620 });
  const [windowOpen, setWindowOpen] = useState(true);
  useEffect(() => { setWindowRect(loadWindowRect(activeProgram) ?? defaultWindowRect()); setWindowOpen(true); }, [activeProgram]);
  useEffect(() => { saveWindowRect(activeProgram, windowRect); }, [activeProgram, windowRect]);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const surfaceSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  const teachingDispatchRef = useRef<((e: TeachingEvent) => void) | null>(null);
  const [teachingSnapshot, setTeachingSnapshot] = useState<TeachingState | null>(null);

  const [railState, setRailState] = useState<RailState>(initialRailState());
  const railStateRef = useRef(railState);
  railStateRef.current = railState;
  const railDispatch = (e: RailEvent) => {
    const prev = railStateRef.current;
    const next = reduceRail(prev, e, Date.now());
    // Interaction telemetry — only on the opening/adding direction
    if (e.type === 'user.whyToggle' && next.openWhy !== null && next.openWhy !== prev.openWhy)
      telemetry.guidance('why_opened', { taskKey: prev.rail?.seq });
    if (e.type === 'user.flip' && next.flipped.length > prev.flipped.length)
      telemetry.guidance('card_flipped', { taskKey: prev.rail?.seq });
    // Dismiss with active step → abandoned
    if (e.type === 'rail.dismiss' && prev.rail && prev.rail.activeIndex !== null)
      telemetry.guidance('rail_abandoned', { taskKey: prev.rail.seq });
    // Rail completed (activeIndex flipped to null)
    if (!railComplete(prev) && railComplete(next))
      telemetry.guidance('rail_complete', { taskKey: next.rail?.seq ?? prev.rail?.seq });
    // Check card state transitions
    if (prev.rail && prev.rail.activeIndex !== null) {
      const ci = prev.rail.activeIndex;
      const prevCard = prev.rail.cards[ci];
      if (prevCard.t === 'check') {
        const nextCard = next.rail?.cards[ci];
        if (prevCard.verify === 'auto' && nextCard) {
          if (nextCard.state === 'done' && prevCard.state !== 'done')
            telemetry.guidance('check_auto_pass', { taskKey: prev.rail.seq });
          else if (nextCard.state === 'failed' && prevCard.state !== 'failed')
            telemetry.guidance('check_auto_fail', { taskKey: prev.rail.seq });
        } else if (prevCard.verify === 'user' && e.type === 'user.checkConfirm' && next.rail?.activeIndex !== ci)
          telemetry.guidance('check_user_confirmed', { taskKey: prev.rail.seq });
      }
    }
    railStateRef.current = next;
    setRailState(next);
  };
  const railDispatchRef = useRef(railDispatch);
  railDispatchRef.current = railDispatch;
  useEffect(() => { railDispatch({ type: 'doc.changed', doc: mockDoc }); }, [mockDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Demo driver: play the scripted rail once entities exist. StrictMode-safe: `played` is set
  // when the first dispatch FIRES (not when scheduled), and cleanup re-arms only if nothing fired yet.
  const railScheduled = useRef(false);
  const railPlayed = useRef(false);
  useEffect(() => {
    if (!railMode || railScheduled.current || entities.length < 4) return;
    railScheduled.current = true;
    const timer = setTimeout(() => {
      railPlayed.current = true;
      const demoRail = buildRailDemo(program, entitiesRef.current, mockDocRef.current, Date.now());
      if (demoRail) railDispatchRef.current({ type: 'rail.set', rail: demoRail });
    }, 800);
    return () => {
      clearTimeout(timer);
      if (!railPlayed.current) railScheduled.current = false;
    };
  }, [railMode, entities.length, program]); // eslint-disable-line react-hooks/exhaustive-deps

  const [pointerPath, setPointerPath] = useState<{ x: number, y: number, timestamp: number }[]>([]);
  const [persistentPaths, setPersistentPaths] = useState<{ x: number, y: number }[][]>([]);

  // 2. Effect to "fade" the paint by pruning old points
  useEffect(() => {
    if (pointerPath.length > 0) {
      const timer = setInterval(() => {
        const now = Date.now();
        setPointerPath(prev => {
          const filtered = prev.filter(p => now - p.timestamp < 5000); // 5 second lifetime
          return filtered.length !== prev.length ? filtered : prev;
        });
      }, 50);
      return () => clearInterval(timer);
    }
  }, [pointerPath.length]);

  // Effect to clear persistent paths after silence - REMOVED in favor of clearing on model response
  /*
  useEffect(() => {
    if (persistentPaths.length === 0) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const timeSinceTranscription = now - lastTranscriptionTimeRef.current;
      
      // If it's been 3.5 seconds since last transcription, clear the paths
      if (timeSinceTranscription > 3500) {
        setPersistentPaths([]);
      }
    }, 500);

    return () => clearInterval(timer);
  }, [persistentPaths.length]);
  */

  // Stable layout measurement function — hoisted so multiple effects can share it without
  // creating new ResizeObserver instances on every render. Deps: program (drives entity shape)
  // and isLive (decides whether to push a layout hint to the model).
  const updateLayout = React.useCallback(() => {
    const main = mainContainerRef.current;
    if (!main) return;
    const mainRect = main.getBoundingClientRect();

    const winEl = main.querySelector('.program-window');

    const toBBox = (r: DOMRect) => ({
      ymin: ((r.top - mainRect.top) / mainRect.height) * 1000,
      xmin: ((r.left - mainRect.left) / mainRect.width) * 1000,
      ymax: ((r.bottom - mainRect.top) / mainRect.height) * 1000,
      xmax: ((r.right - mainRect.left) / mainRect.width) * 1000,
    });

    if (!winEl) {
      // Window is closed — zero-bbox degradation so entities/overlays render nothing honestly.
      setMainSize({ width: mainRect.width, height: mainRect.height });
      const zeroWindow = { ymin: 0, xmin: 0, ymax: 0, xmax: 0 };
      setLayoutBounds({ window: zeroWindow, photoItems: [], surface: undefined });
      const es = buildEntities(program, perceivedLabelsRef.current, { items: [] });
      setEntities(es);
      entitiesRef.current = es;
      return;
    }

    const pRect = winEl.getBoundingClientRect();
    setMainSize({ width: mainRect.width, height: mainRect.height });

    // Generic element contract: anything with data-element-id is a measurable scene
    // element (tiles today, surface controls after the surface migration).
    const photoItems = Array.from(winEl.querySelectorAll<HTMLElement>('[data-element-id]')).map((el: HTMLElement) => {
      const id = Number(el.dataset.elementId);
      return Number.isFinite(id) ? { id, bbox: toBBox(el.getBoundingClientRect()) } : null;
    }).filter(Boolean) as { id: number; bbox: BBox }[];

    const surfEl = main.querySelector('.program-surface');
    setLayoutBounds({
      window: toBBox(pRect),
      photoItems,
      surface: surfEl ? toBBox((surfEl as HTMLElement).getBoundingClientRect()) : undefined,
    });

    // Update the scene entities for Gemini (single source of truth).
    const es = buildEntities(program, perceivedLabelsRef.current, {
      items: photoItems.map(it => ({ id: it.id, bbox: it.bbox })),
    });
    setEntities(es);
    entitiesRef.current = es;

    // Notify AI of the new layout if session is active (core context — both backends).
    if (providerRef.current) {
      const layoutInfo = es.map(e => `${displayName(e)}: [${e.bbox.map(Math.round).join(', ')}]`).join('\n');
      providerRef.current.sendTextHint(`[SYSTEM UPDATE: The on-screen program elements are at these coordinates (ymin, xmin, ymax, xmax):\n${layoutInfo}\nUse these to identify what the user is pointing at when they say "this" or "here". DO NOT RESPOND TO THIS UPDATE. STAY SILENT UNTIL THE USER SPEAKS.]`);
    }
  }, [program, isLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-measure on window move/resize/open/close — ResizeObserver only fires on size changes,
  // so drags and reopen would otherwise leave stale bboxes (a false screen for the AI).
  useEffect(() => { updateLayout(); }, [updateLayout, windowRect, windowOpen]);

  // Mount/reattach observers — re-runs when windowOpen flips so the new .program-window
  // element (which the old observer never saw) gets observed immediately on reopen.
  useEffect(() => {
    const observer = new ResizeObserver(updateLayout);
    if (mainContainerRef.current) observer.observe(mainContainerRef.current);

    // Also observe the program window specifically in case it moves independently
    const winBox = document.querySelector('.program-window');
    if (winBox) observer.observe(winBox);

    updateLayout();
    window.addEventListener('resize', updateLayout);
    window.addEventListener('scroll', updateLayout, true); // Capture scroll events that might shift layout

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('scroll', updateLayout, true);
    };
  }, [updateLayout, windowOpen]); // re-attach when window open/close so new DOM element is observed

  useEffect(() => {
    const checkDevice = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const minDimension = Math.min(width, height);
      const isPortrait = window.matchMedia('(orientation: portrait)').matches;
      
      // Mobile: smallest dimension < 600px (covers phones in both orientations)
      setShowMobileOverlay(minDimension < 600 && !bypassDeviceGate);

      // Tablet range: smallest dimension >= 600px and width <= 1024px
      const isTabletWidth = width >= 600 && width <= 1024;
      setShowRotateOverlay(isPortrait && isTabletWidth && !bypassDeviceGate);
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, [bypassDeviceGate]);


  // focusTitle: set by chip tap (the task's targetElement), cleared on submit.
  // Drives the "Point here" ring on the program surface and pre-focuses the trace canvas.
  const [focusTitle, setFocusTitle] = useState<string | undefined>(undefined);
  useEffect(() => { focusTitleRef.current = focusTitle; }, [focusTitle]);

  // Program swap is a deliberate context switch — clear transient interaction state.
  useEffect(() => {
    markersRef.current = [];
    lastMarkerTimeRef.current = {};
    setPersistentPaths([]);
    setPendingAction(null);
  }, [activeProgram]);

  const addLog = (type: DebugLog['type'], message: string) => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), type, message }, ...prev].slice(0, 50));
  };

  const speakFeedback = async (editPrompt: string) => {
    if (!process.env.GEMINI_API_KEY) {
      addLog('info', 'Voice feedback: Missing API Key');
      return;
    }
    
    try {
      // 1. Ensure AudioContext is ready
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      setAudioStatus(audioContextRef.current.state as any);

      // 2. Prepare the text (Shorter for faster response)
      const prefixes = ["Sure thing!", "No problem!", "Got it!", "Right away!"];
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      
      let cleanPrompt = editPrompt
        .replace(/\[\d+\s*,\s*\d+\]/g, "") // Remove [123, 456]
        .replace(/\d+/g, "")               // Remove any remaining numbers
        .replace(/BOTTOM RIGHT AREA/gi, "") // Remove technical area names
        .replace(/\bMONSTER ISLAND\b/gi, "")
        .replace(/\bMIDDLE ISLAND\b/gi, "")
        .replace(/\bLEFT ISLAND\b/gi, "")
        .replace(/\bEMPTY ISLAND\b/gi, "")
        .replace(/\bat\s*$/i, "")            // Remove trailing "at" only if it's a word
        .replace(/\s+/g, " ")              // Collapse spaces
        .trim();

      // Ensure it starts with a lowercase for the "I'll" transition
      if (cleanPrompt.length > 0) {
        cleanPrompt = cleanPrompt.charAt(0).toLowerCase() + cleanPrompt.slice(1);
      }

      const textToSpeak = `${prefix} I'll ${cleanPrompt}.`;
      addLog('event', `Voice Request: "${textToSpeak}"`);

      // 3. Request TTS from Gemini with a timeout
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const ttsPromise = ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say cheerfully: ${textToSpeak}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
        },
      });

      // Race against a timeout to prevent hanging
      const ttsResponse = await Promise.race([
        ttsPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Voice request timed out")), 8000))
      ]) as GenerateContentResponse;

      const audioPart = ttsResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      const base64Audio = audioPart?.inlineData?.data;

      if (base64Audio && audioContextRef.current) {
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Create WAV Header for maximum browser compatibility
        const createWavHeader = (dataLength: number) => {
          const buffer = new ArrayBuffer(44);
          const view = new DataView(buffer);
          const writeString = (offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
          };
          writeString(0, 'RIFF');
          view.setUint32(4, 36 + dataLength, true);
          writeString(8, 'WAVE');
          writeString(12, 'fmt ');
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true); // PCM
          view.setUint16(22, 1, true); // Mono
          view.setUint32(24, 24000, true); // Sample Rate
          view.setUint32(28, 24000 * 2, true); // Byte Rate
          view.setUint16(32, 2, true); // Block Align
          view.setUint16(34, 16, true); // Bits per Sample
          writeString(36, 'data');
          view.setUint32(40, dataLength, true);
          return buffer;
        };

        const wavHeader = createWavHeader(bytes.length);
        const wavData = new Uint8Array(wavHeader.byteLength + bytes.byteLength);
        wavData.set(new Uint8Array(wavHeader), 0);
        wavData.set(bytes, wavHeader.byteLength);

        // Use decodeAudioData for robust playback within the AudioContext
        const audioBuffer = await audioContextRef.current.decodeAudioData(wavData.buffer);
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        
        const gainNode = audioContextRef.current.createGain();
        gainNode.gain.value = voiceVolume;
        
        source.connect(gainNode);
        gainNode.connect(audioContextRef.current.destination);
        
        source.start(0);
        addLog('event', 'Voice playback started');
      } else {
        addLog('info', 'Voice: No audio data received');
      }
    } catch (err) {
      addLog('info', `Voice error: ${err}`);
    }
  };

  const playTestBeep = async () => {
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      await audioContextRef.current.resume();
      
      const osc = audioContextRef.current.createOscillator();
      const gain = audioContextRef.current.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, audioContextRef.current.currentTime);
      
      gain.gain.setValueAtTime(0.1, audioContextRef.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContextRef.current.currentTime + 0.5);
      
      osc.connect(gain);
      gain.connect(audioContextRef.current.destination);
      
      osc.start();
      osc.stop(audioContextRef.current.currentTime + 0.5);
      addLog('event', 'Test beep played');
    } catch (err) {
      addLog('info', `Beep error: ${err}`);
    }
  };

  const addMarker = (text: string, x?: number, y?: number, isIdentification = false) => {
    const now = Date.now();
    const finalX = x !== undefined ? x : cursorRef.current.x;
    const finalY = y !== undefined ? y : cursorRef.current.y;

    const lastMarker = markersRef.current[0];
    const hasMovedSignificantly = lastMarker ? (Math.abs(lastMarker.x - finalX) > 50 || Math.abs(lastMarker.y - finalY) > 50) : true;
    
    // Update last marker time for this specific keyword
    lastMarkerTimeRef.current[text] = now;
    
    if (isIdentification) {
      // AI IDENTIFICATION:
      // If a marker was recently dropped by the user (transcription), we KEEP the user's coordinates
      // and only update the label. This prevents the marker from "jumping" if the AI's 
      // coordinate detection is slightly off.
      if (lastMarker && (now - lastMarker.timestamp < 4000)) {
        const resolvedMarkerEntity = resolveEchoedTarget(entitiesRef.current, text);
        lastMarker.identifiedObject = resolvedMarkerEntity?.entity.id;
        // We do NOT update lastMarker.x/y here to keep the user's precise point
        addLog('event', `AI Identified: "${text}" at user's point`);
      } else {
        // Fallback: If no recent user marker, use the AI's suggested coordinates
        const newMarker: Marker = {
          x: finalX,
          y: finalY,
          displayLabel: "THIS",
          identifiedObject: resolveEchoedTarget(entitiesRef.current, text)?.entity.id,
          timestamp: now,
          isConsumed: false
        };
        markersRef.current = [newMarker, ...markersRef.current].slice(0, 2);
        addLog('event', `AI Identified: "${text}" at AI point`);
      }
    } else {
      // Transcription keyword detected
      const newMarker: Marker = { 
        x: finalX, 
        y: finalY, 
        displayLabel: text.toUpperCase(), 
        timestamp: now,
        isConsumed: false
      };

      // Keep up to 2 markers to support "Move this to here"
      markersRef.current = [newMarker, ...markersRef.current].slice(0, 2);
      addLog('event', `Keyword detected: "${text}"`);
    }
  };

  const handleLiveAudio = (base64Data: string) => {
    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      
      // Ensure we don't crash if byte length is odd (though it shouldn't be for PCM16)
      const int16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
      
      const now = Date.now();
      // If it's been more than 1s since last audio, it's a new turn
      const isNewTurn = (now - lastAudioTimeRef.current) > 1000;
      lastAudioTimeRef.current = now;

      if (isNewTurn && audioContextRef.current) {
        const ctxNow = audioContextRef.current.currentTime;
        // Delay the start of the turn by 1.2s to wait for user to finish
        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctxNow + 1.2);
      }

      audioQueueRef.current.push(int16);
      processAudioQueue();
    } catch (err) {
      addLog('info', `Audio decode error: ${err}`);
    }
  };

  const processAudioQueue = () => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') return;
    
    // If context is suspended, we can't play yet
    if (audioContextRef.current.state === 'suspended') return;

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift()!;
      if (!chunk || chunk.length === 0) continue;

      const audioBuffer = audioContextRef.current.createBuffer(1, chunk.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < chunk.length; i++) {
        channelData[i] = chunk[i] / 32768;
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      
      const gainNode = audioContextRef.current.createGain();
      gainNode.gain.value = voiceVolume;
      
      source.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);
      
      // Schedule for gapless playback with a tiny lookahead buffer (20ms) to handle jitter
      const now = audioContextRef.current.currentTime;
      const startTime = Math.max(now + 0.02, nextStartTimeRef.current);
      
      activeSourcesRef.current.push(source);
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
      };

      source.start(startTime);
      nextStartTimeRef.current = startTime + audioBuffer.duration;
    }
  };

  const [isWideEnough, setIsWideEnough] = useState(true);

  useEffect(() => {
    const checkWidth = () => {
      // Threshold for "laptop/desktop" experience - usually 1024px (overridable for the testbed)
      setIsWideEnough(window.innerWidth >= 1024 || bypassDeviceGate);
    };

    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, [bypassDeviceGate]);

  const handleVoiceToolCall = (call: { id: string; name: string; args: any }) => {
    const fc = { id: call.id, name: call.name, args: call.args };
    // G9 IDEMPOTENCY: drop a duplicate tool call the model re-emitted within the window (a
    // known agent failure mode — e.g. replaying a chain). Ack it so the model doesn't hang.
    if (callDeduperRef.current.seen(fc.name, argsKey(fc.args), Date.now())) {
      addLog('info', `Duplicate tool call skipped: ${fc.name}`);
      providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, deduped: true });
      return;
    }
    if (fc.name === 'explain') {
      // Low-commitment identify. The durable artifact is an ANSWER card in the rail;
      // the spoken answer remains the model's (prompt: hedges stay voice).
      const args = fc.args as any;
      const subject = typeof args.subject === 'string' ? args.subject : '';
      const hit = resolveEchoedTarget(entitiesRef.current, subject);
      const mapped = respondCallToRail({ seq: 'answer', guideLine: 'answer', cards: [
        hit ? { t: 'answer', text: `That's the ${displayName(hit.entity)}.`, target: subject }
            : { t: 'answer', text: subject ? `I can't point at "${subject}" — not on this screen.` : `I'm not sure what that is.` },
      ] }, entitiesRef.current, mockDocRef.current, Date.now());
      if (!('error' in mapped)) railDispatchRef.current?.({ type: 'rail.set', rail: { ...mapped.rail, guideLine: undefined } });
      addLog('tool', `Tool Call: explain(${subject}) - verbal only, changes nothing`);
      providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true });
    } else if (fc.name === 'respond') {
      const mapped = respondCallToRail(fc.args, entitiesRef.current, mockDocRef.current, Date.now());
      if ('error' in mapped) {
        addLog('tool', `Tool Call: respond REJECTED — ${mapped.error}`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: false, error: mapped.error });
      } else {
        railDispatchRef.current?.({ type: 'rail.set', rail: mapped.rail });
        mapped.rail.cards.forEach(() => telemetry.guidance('card_dealt', { taskKey: mapped.rail.seq }));
        addLog('tool', `Tool Call: respond(${mapped.rail.seq}) — ${mapped.rail.cards.length} cards`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, rendered: mapped.rail.cards.length });
      }
    } else if (fc.name === 'share') {
      // PHASE G: outward action. Witness recipient + payload before sending; commit only
      // on explicit confirm. (Sending itself is simulated — no real outward integration.)
      const args = fc.args as any;
      const recipient = typeof args.recipient === 'string' ? args.recipient : '';
      const payload = typeof args.payload === 'string' ? args.payload : undefined;
      const confirmed = args.confirm === true;
      if (!confirmed) {
        addLog('tool', `Tool Call: share(witness) - to ${recipient}${payload ? `: ${payload}` : ''}`);
        setShareRequest({ recipient, payload, confirmed: false });
        emitFeedback({ outcome: 'needs-confirm', verbClass: 'share', label: `Confirm: share with ${recipient}` });
      } else {
        addLog('event', `Shared ${payload ?? 'item'} with ${recipient}`);
        setShareRequest({ recipient, payload, confirmed: true });
        emitFeedback({ outcome: 'committed', verbClass: 'share', label: `Shared with ${recipient}` });
      }
      providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, sent: confirmed });
    } else if (ACTION_VERB_NAMES.includes(fc.name)) {
      // ACTION VERBS (save/edit/format/insert/photo). The Policy layer (DIAL A: autonomy ×
      // verb class) decides commit-vs-witness; the Feedback layer (DIAL B) signals the
      // outcome via earcon / app-speech / visual. The model never self-confirms — the app
      // owns confirmation. The mock document mutates on commit; the preview shows the result.
      const args = (fc.args ?? {}) as { target?: string; detail?: string; confirm?: boolean };
      const { label, target, detail } = describeAction(fc.name, args);
      const confirmed = args.confirm === true;

      // Double-apply guard: if the button already confirmed this action, don't re-apply the
      // voice-confirm call that follows (button sets confirmed=true, then the model also fires
      // confirm=true — one apply is enough). Witness-mode calls (confirmed=false) are unaffected.
      if (confirmed) {
        const pa = pendingActionRef.current;
        if (pa?.confirmed === true && pa.verb === fc.name && pa.target === (args.target ?? pa.target)) {
          providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, deduped: true, note: 'already applied via button confirm' });
          return;
        }
      }

      const verbClass = classOf(fc.name);
      const phrase = `${label} ${target}${detail ? ` (${detail})` : ''}`;
      const decision = decideCommit(verbClass, autonomyRef.current, confirmed);

      // G5 GROUNDING RECONCILIATION on stable ids: the app's pointer referent vs the model's
      // echoed target resolved across ALL aliases (title + perceived). Below the resolver's
      // threshold → honest null (no phantom match, no spurious witness). See the 2026-07-02
      // session regression: “Cell A3” must not bind to the Cell A1 tile.
      const appReferentId = markersRef.current[0]?.identifiedObject ?? hoveredIdRef.current ?? null;
      const appReferentEntity = entityById(entitiesRef.current, appReferentId);
      const resolved = resolveEchoedTarget(entitiesRef.current, args.target);
      const agree = (appReferentId && resolved) ? appReferentId === resolved.entity.id : null;
      const resolution: 'structural' | 'visual' | 'none' =
        appReferentId ? 'structural' : (resolved ? 'visual' : 'none');
      telemetry.grounding(displayName(appReferentEntity) || null, args.target ?? null, agree, resolution);
      const disagreement = honestModeRef.current && agree === false && !confirmed;
      const effectiveDecision: 'commit' | 'witness' = disagreement ? 'witness' : decision;
      const note = disagreement
        ? `You pointed at “${displayName(appReferentEntity)}”, but I read “${displayName(resolved!.entity)}”.`
        : undefined;

      telemetry.action(fc.name, verbClass, effectiveDecision, lastInputModalityRef.current);
      if (effectiveDecision === 'witness') {
        addLog('tool', `Tool Call: ${fc.name}(witness${disagreement ? ', grounding mismatch' : ''}) — ${phrase}`);
        setPendingAction({ verb: fc.name, label, target, detail, confirmed: false, note });
        emitFeedback({ outcome: 'needs-confirm', verbClass, label: disagreement ? `Mismatch: ${displayName(appReferentEntity)} vs ${displayName(resolved?.entity)}` : `Confirm: ${phrase}` });
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, witnessed: true, grounding_mismatch: disagreement, app_referent: displayName(appReferentEntity) || null, model_target: resolved ? displayName(resolved.entity) : null });
      } else {
        const prevDoc = mockDocRef.current;
        const nextDoc = applyAction(prevDoc, fc.name, args);
        mockDocRef.current = nextDoc;
        setMockDoc(nextDoc);
        setUndoStack(s => [...s, { doc: prevDoc, label: phrase }]); // memento for undo
        setPendingAction({ verb: fc.name, label, target, detail, confirmed: true });
        emitFeedback({ outcome: 'committed', verbClass, label: phrase });
        // G4: register newly-created objects so "send the chart I just made" resolves later.
        if (verbClass === 'create') {
          const createdName = nextDoc.kind === 'excel' ? 'Chart'
            : nextDoc.kind === 'powerpoint' ? (nextDoc.slides[nextDoc.slides.length - 1] ?? 'Slide')
            : (resolved ? displayName(resolved.entity) : target);
          referents.note(createdName, 'created');
        }
        // G2: feed the new document state back so the model can SEE the result of its edit
        // (closes the action→result loop for multi-step work). Also drawn into the vision frame.
        providerRef.current?.sendTextHint(`[DOCUMENT STATE after your edit: ${serializeMockDoc(nextDoc)}. DO NOT acknowledge this message.]`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, done: true });
      }
    }
  };

  // G8 INPUT FALLBACK: select a target by its number (voice "number two" / number key) — a
  // pointer-free deixis. Simulates pointing at the element so a command resolves to it.
  const selectTargetByNumber = (n: number) => {
    lastInputModalityRef.current = 'direct';
    const img = program.images[n - 1];
    if (!img) return;
    const entity = entitiesRef.current.find(e => e.title === img.title); // scenario index → entity
    if (!entity) return;
    const [ymin, xmin, ymax, xmax] = entity.bbox;
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
    cursorRef.current = { x: cx, y: cy };
    hoveredIdRef.current = entity.id;
    setHoveredId(entity.id);
    cursorHistoryRef.current.push({ x: cx, y: cy, t: Date.now(), hovered: entity.id });
    addMarker('THIS', cx, cy);
    referents.note(displayName(entity), 'pointed', entity.id);
    telemetry.deixis('number', entity.title, focusTitleRef.current ?? null, 'high', 'direct');
    addLog('event', `Selected target ${n}: ${displayName(entity)}`);
    providerRef.current?.sendTextHint(`[USER SELECTED target ${n}: ${displayName(entity)} (numbered selection). Treat this as what they are pointing at.]`);
  };

  // Surface element click: deixis (numbered-selection path) + teaching step action. This is
  // how a click on a REAL control both selects it and advances an active teach sequence.
  const handleSurfaceElementClick = (elementId: number) => {
    const entity = entitiesRef.current.find(e => e.id === `${program.id}-${elementId}`);
    if (entity) teachingDispatchRef.current?.({ type: 'user.stepAction', entityId: entity.id });
    if (entity) railDispatch({ type: 'user.elementAction', entityId: entity.id });
    const idx = program.images.findIndex(im => im.id === elementId);
    if (isLive && idx >= 0) selectTargetByNumber(idx + 1);
  };

  // Direct manipulation commits immediately — the click IS the confirmation (no witness
  // gate; that gate exists for voice, where interpretation can be wrong). Same reducer,
  // same undo memento, same world-state feedback loop as the voice path.
  const handleSurfaceAction = (verb: string, args: { target?: string; detail?: string }) => {
    const prevDoc = mockDocRef.current;
    const nextDoc = applyAction(prevDoc, verb, args);
    if (nextDoc === prevDoc) return;
    mockDocRef.current = nextDoc;
    setMockDoc(nextDoc);
    const d = describeAction(verb, args);
    setUndoStack(s => [...s, { doc: prevDoc, label: `${d.label} ${d.target}` }]);
    lastInputModalityRef.current = 'direct';
    telemetry.action(verb, classOf(verb), 'commit', 'direct');
    emitFeedback({ outcome: 'committed', verbClass: classOf(verb), label: `${d.label} ${d.target}` });
    providerRef.current?.sendTextHint(`[DOCUMENT STATE after the user's direct edit: ${serializeMockDoc(nextDoc)}. DO NOT acknowledge this message.]`);
  };

  // Witness cards are keyboard/click-confirmable — voice is no longer the only path (gap 9).
  const confirmPendingAction = () => {
    const p = pendingAction;
    if (!p || p.confirmed) return;
    const prevDoc = mockDocRef.current;
    const nextDoc = applyAction(prevDoc, p.verb, { target: p.target, detail: p.detail });
    mockDocRef.current = nextDoc;
    setMockDoc(nextDoc);
    setUndoStack(s => [...s, { doc: prevDoc, label: `${p.label} ${p.target}` }]);
    telemetry.action(p.verb, classOf(p.verb), 'commit', 'direct');
    emitFeedback({ outcome: 'committed', verbClass: classOf(p.verb), label: `${p.label} ${p.target}` });
    setPendingAction({ ...p, confirmed: true });
    providerRef.current?.sendTextHint(`[SYSTEM: the user confirmed via button — the action was applied. DOCUMENT STATE: ${serializeMockDoc(nextDoc)}. Do not re-call the tool; do not acknowledge.]`);
  };
  const cancelPendingAction = () => {
    if (!pendingAction || pendingAction.confirmed) return;
    setPendingAction(null);
    providerRef.current?.sendTextHint('[SYSTEM: the user cancelled the pending action via button — drop it and wait.]');
  };
  const confirmShare = () => {
    if (!shareRequest || shareRequest.confirmed) return;
    setShareRequest({ ...shareRequest, confirmed: true });
    emitFeedback({ outcome: 'committed', verbClass: 'share', label: `Shared with ${shareRequest.recipient}` });
    providerRef.current?.sendTextHint('[SYSTEM: the user confirmed the share via button — it was sent. Do not re-call the tool; do not acknowledge.]');
  };
  const cancelShare = () => {
    if (!shareRequest || shareRequest.confirmed) return;
    setShareRequest(null);
    providerRef.current?.sendTextHint('[SYSTEM: the user cancelled the share via button — drop it and wait.]');
  };

  const processInputTranscript = (text: string) => {
    addLog('info', `User: "${text}"`);
    lastTranscriptionTimeRef.current = Date.now();

    // Clean transcription: remove <noise>, [noise], (noise), *noise*, etc.
    const cleanedText = text
      .replace(/<[^>]*>/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\*[^*]*\*/g, '')
      // Only allow English letters, numbers, spaces, and standard punctuation
      .replace(/[^a-zA-Z0-9\s.,?!'":;-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanedText) return;

    // G9 REPAIR GRAMMAR: handle conversational corrections app-side. "undo that" → undo;
    // "cancel / never mind" → drop the pending action; "no, the other one" → swap to the
    // alternative candidate of the last ambiguous point and re-offer it.
    const repair = parseRepair(cleanedText);
    if (repair === 'undo') {
      handleUndo();
    } else if (repair === 'cancel') {
      setPendingAction(null);
      markersRef.current = [];
      providerRef.current?.sendTextHint('[SYSTEM: the user cancelled — drop the pending action and wait.]');
    } else if (repair === 'other') {
      const m = markersRef.current[0];
      const alt = m?.candidates?.find(c => c !== m.identifiedObject);
      const altEntity = alt ? entityById(entitiesRef.current, alt) : undefined;
      if (alt && altEntity && providerRef.current) {
        if (m) m.identifiedObject = alt;
        referents.note(displayName(altEntity), 'pointed', alt);
        providerRef.current.sendTextHint(`[SYSTEM: the user meant the OTHER one — they are pointing at "${displayName(altEntity)}", not your previous guess. Use ${displayName(altEntity)} now.]`);
      }
    }

    // G8: pointer-free deixis by spoken number ("number two", "the second one").
    const sel = parseTargetSelection(cleanedText, program.images.length);
    if (sel !== null) selectTargetByNumber(sel);

    // Smart accumulation: show the whole sentence instead of flashing words
    const prevText = lastProcessedTranscriptionRef.current || "";
    let currentText = cleanedText;

    const lowerPrev = prevText.toLowerCase().trim();
    const lowerNext = cleanedText.toLowerCase().trim();

    // If the new text doesn't already start with the old text, append it
    if (lowerPrev && !lowerNext.startsWith(lowerPrev)) {
      currentText = prevText + " " + cleanedText;
    }

    setLiveTranscription(currentText);

    if (transcriptionTimeoutRef.current) clearTimeout(transcriptionTimeoutRef.current);
    transcriptionTimeoutRef.current = setTimeout(() => {
      setLiveTranscription("");
      lastProcessedTranscriptionRef.current = "";
    }, 3000);

    const lowerText = currentText.toLowerCase();
    const prevLowerText = lowerPrev;

    // Update ref for next turn comparison
    lastProcessedTranscriptionRef.current = currentText;

    const detectedKeywords: string[] = [];
    let tempText = lowerText;
    let tempPrevText = prevLowerText;

    const countOccurrences = (str: string, word: string) => {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      return (str.match(regex) || []).length;
    };

    // Only detect keywords that are NEW in this transcription update
    SORTED_KEYWORDS.forEach(kw => {
      const currentCount = countOccurrences(tempText, kw);
      const prevCount = countOccurrences(tempPrevText, kw);
      const newCount = Math.max(0, currentCount - prevCount);

      for (let i = 0; i < newCount; i++) {
        detectedKeywords.push(kw);
      }

      // "Consume" this keyword so shorter ones don't match the same text
      const regex = new RegExp(`\\b${kw}\\b`, 'g');
      tempText = tempText.replace(regex, ' '.repeat(kw.length));
      tempPrevText = tempPrevText.replace(regex, ' '.repeat(kw.length));
    });

    lastProcessedTranscriptionRef.current = text;

    detectedKeywords.forEach((kw, index) => {
      const canonicalLabel = KEYWORD_MAP[kw] || kw;

      // COORDINATE DETECTION (Density-based Focus Point Algorithm):
      // Transcription arrives with latency (usually 1-2 seconds).
      // We look for the "Focus Point" - the place where the user's cursor was most
      // concentrated in a sliding window.
      // If multiple keywords arrive, we offset the windows to match the temporal order of speech.
      const now = Date.now();
      const totalKws = detectedKeywords.length;
      const offset = (totalKws - 1 - index) * 1000; // Increased to 1s for better separation of "here" and "there"
      const lookbackStart = now - 2500 - offset;   // Slightly wider lookback for latency
      const lookbackEnd = now - offset;

      const windowEntries = cursorHistoryRef.current.filter(h => h.t >= lookbackStart && h.t <= lookbackEnd);

      // 1. HISTORY PURPLE TEXT CHECK (Prioritize what was hovered DURING the speech window)
      const hoveredCounts: Record<string, number> = {};
      windowEntries.forEach(entry => {
        if (entry.hovered) {
          hoveredCounts[entry.hovered] = (hoveredCounts[entry.hovered] || 0) + 1;
        }
      });

      let mostFrequentHovered: string | null = null;
      let maxCount = 0;
      for (const [name, count] of Object.entries(hoveredCounts)) {
        if (count > maxCount) {
          maxCount = count;
          mostFrequentHovered = name;
        }
      }

      let foundObject: SceneEntity | null = mostFrequentHovered
        ? entitiesRef.current.find(e => e.id === mostFrequentHovered) || null
        : null;

      if (foundObject) {
        addLog('info', `Using historical "Purple Text": ${displayName(foundObject)}`);
      }

      // 2. DIRECT PURPLE TEXT CHECK (Only for the very latest keyword if history is sparse)
      if (!foundObject && index === totalKws - 1 && hoveredIdRef.current) {
        foundObject = entityById(entitiesRef.current, hoveredIdRef.current) || null;
        if (foundObject) {
          addLog('info', `Using current "Purple Text" for latest keyword: ${displayName(foundObject)}`);
        }
      }

      let focusPoint = cursorRef.current;

      // PREFER ACTIVE PAINTING (Maximum accuracy for "drawn over/circled")
      if (isPainting && pointerPath.length > 0) {
        focusPoint = pointerPath[pointerPath.length - 1];
        addLog('info', 'Using active painting point for marker');
      } else if (persistentPaths.length > 0) {
        // Use center of most recent persistent path if it's very recent
        const lastPath = persistentPaths[persistentPaths.length - 1];
        const centerX = lastPath.reduce((sum, p) => sum + p.x, 0) / lastPath.length;
        const centerY = lastPath.reduce((sum, p) => sum + p.y, 0) / lastPath.length;
        focusPoint = { x: centerX, y: centerY };
        addLog('info', 'Using center of recent persistent path for marker');
      } else if (windowEntries.length > 0) {
        // Fallback to density-based focus point if no hovered object found
        let maxNeighbors = -1;
        let bestPoint = windowEntries[windowEntries.length - 1];

        for (let i = 0; i < windowEntries.length; i++) {
          let neighbors = 0;
          for (let j = 0; j < windowEntries.length; j++) {
            const dist = Math.sqrt(
              Math.pow(windowEntries[i].x - windowEntries[j].x, 2) +
              Math.pow(windowEntries[i].y - windowEntries[j].y, 2)
            );
            if (dist < 15) neighbors++;
          }
          if (neighbors > maxNeighbors) {
            maxNeighbors = neighbors;
            bestPoint = windowEntries[i];
          }
        }
        focusPoint = bestPoint;
      } else if (cursorHistoryRef.current.length > 0) {
        // Fallback to last known point if no history in window
        focusPoint = cursorHistoryRef.current[cursorHistoryRef.current.length - 1];
      }

      // ADD MARKER IMMEDIATELY
      addMarker(canonicalLabel, focusPoint.x, focusPoint.y);
      addLog('info', `Marker added for "${kw}"`);

      const isDestination = [
        "here", "there", "hear", "hair", "their", "they're", "that",
        "this spot", "that spot", "right here", "right there"
      ].includes(kw);

      const hX = Math.round(focusPoint.x);
      const hY = Math.round(focusPoint.y);

      // Final check for object at focus point if still unknown
      if (!foundObject) {
        foundObject = entitiesRef.current.find(e => {
          const [ymin, xmin, ymax, xmax] = e.bbox;
          const padding = 5; // Reduced from 15 for stricter, non-guessy detection
          return hX >= (xmin - padding) && hX <= (xmax + padding) && hY >= (ymin - padding) && hY <= (ymax + padding);
        }) || null;
      }

      if (foundObject) {
        // Attach the object name to the marker
        const lastM = markersRef.current[0];
        if (lastM && (Date.now() - lastM.timestamp < 1000)) {
          lastM.identifiedObject = foundObject.id;
          addLog('info', `Identified: ${displayName(foundObject)}`);
        }

        // DIFF 1: compute a (demo-grade) confidence for this resolution and log it.
        // Computed in both modes so the signal is visible in the debug panel even on
        // the confident baseline (which deliberately ignores it).
        const confidence = computePointingConfidence(foundObject, hX, hY, entitiesRef.current, CONFUSABLE_PAIRS);
        const otherCandidates = confidence.candidates.filter(c => c !== foundObject!.id);
        addLog('info', `Confidence: ${confidence.level.toUpperCase()} — ${confidence.reason}${otherCandidates.length ? ` (vs ${otherCandidates.map(c => displayName(entityById(entitiesRef.current, c))).join(', ')})` : ''}`);

        // PHASE B: thread confidence onto the most recent marker so the canvas can
        // render a guess differently from a confident hit (honest mode only).
        const markerForConfidence = markersRef.current[0];
        if (markerForConfidence && (Date.now() - markerForConfidence.timestamp < 1000)) {
          markerForConfidence.confidence = confidence.level;
          markerForConfidence.candidates = confidence.candidates;
          markerForConfidence.category = categoryOf(foundObject.id);
        }

        // TESTBED: record this deixis resolution against the active scenario's target (ground
        // truth) so we can measure pointing accuracy + confidence calibration per config/device.
        telemetry.deixis(kw, foundObject.title, focusTitleRef.current ?? null, confidence.level, lastInputModalityRef.current);

        // G4: remember this referent so later turns can resolve "make THAT bold" / "send IT".
        referents.note(displayName(foundObject), 'pointed', foundObject.id);

        // Proactive pattern-offer seam retired with the map-era payload; re-aim at program behavior when a goal model exists.

        // SEND DEIXIS HINT to whichever backend is live.
        if (providerRef.current) {
          const commandWords = ["show", "go", "directions", "where", "what", "search", "find", "how", "get", "near"];
          const isCommand = commandWords.some(w => lowerText.includes(w));
          // Honest mode threads confidence into the hint; the baseline hint is unchanged.
          const confidenceTag = honestModeRef.current
            ? (confidence.level === 'high'
                ? ' (confidence: high)'
                : otherCandidates.length
                  ? ` (confidence: low — could also be ${otherCandidates.map(c => displayName(entityById(entitiesRef.current, c))).join(' or ')})`
                  : ' (confidence: low — not certain this is the right photo)')
            : '';
          // G4: give the model recent referents so it can resolve cross-turn back-references
          // ("make that bold", "the chart I just made") to a concrete element.
          const refCtx = referents.promptContext();
          // G3: if an OCR word sits under the focus point, refine the referent to that word.
          const sub = wordAt(hX, hY);
          const subTag = sub && sub.photoTitle === foundObject.title ? ` (specifically the word "${sub.word}")` : '';
          const hintText = `[USER JUST SAID "${kw.toUpperCase()}" WHILE POINTING AT: ${displayName(foundObject)}${subTag}${confidenceTag}. ${isCommand ? "NOTE: This is part of an explicit command." : "NOTE: This is just a mention, stay silent unless they give a command."}${refCtx ? ` ${refCtx}` : ''}]`;
          providerRef.current?.sendTextHint(hintText);
          if (sub && sub.photoTitle === foundObject.title) referents.note(`"${sub.word}"`, 'pointed');
        }
      } else {
        // SEND "NOTHING" HINT TO PREVENT GUESSING
        if (providerRef.current) {
          providerRef.current?.sendTextHint(`[USER JUST SAID "${kw.toUpperCase()}" WHILE POINTING AT: Nothing (Empty Space). Ask them to point at a program element.]`);
        }
      }

    });
  };

  // R1 TYPED PARITY: a typed command rides the exact same pipeline as speech —
  // local grammar first (deixis binds to the pointer at type-time, repair, numbers),
  // then a forced model turn. No session? Stash the text and auto-start one.
  const sendTypedInput = (raw: string) => {
    const text = parseTypedSubmit(raw);
    if (!text) return;
    lastInputModalityRef.current = 'typed';
    addLog('event', `⌨ ${text}`);
    setLiveTranscription(text);
    processInputTranscript(text);
    if (providerRef.current) {
      providerRef.current.sendUserText(text);
    } else {
      pendingTypedRef.current = text;
      setIsConnecting(true);
      startLiveSession();
    }
  };

  // R1: a typed command may have auto-started this session attempt. If session
  // startup fails BEFORE the provider callbacks exist (missing key, mic denied,
  // insecure context, connect throw), unwind: re-enable the box and give the
  // user their text back so nothing is lost.
  const abortPendingTyped = () => {
    setIsConnecting(false);
    if (pendingTypedRef.current) setRestoredDraft({ text: pendingTypedRef.current, at: Date.now() });
    pendingTypedRef.current = null;
  };

  const startLiveSession = async () => {
    if (isLive) return; // Prevent multiple sessions
    lastTranscriptionTimeRef.current = 0;

    const apiKey = process.env.GEMINI_API_KEY;
    if (voiceBackendRef.current === 'gemini' && !apiKey) {
        const msg = 'Missing GEMINI_API_KEY — set it in .env.local and restart the dev server.';
        abortPendingTyped();
        setLastError(msg);
        addLog('info', msg);
        return;
    }
    if (voiceBackendRef.current === 'azure' && (!process.env.AZURE_OPENAI_API_KEY || !process.env.AZURE_OPENAI_ENDPOINT)) {
        const msg = 'Missing AZURE_OPENAI_API_KEY / AZURE_OPENAI_ENDPOINT — set them in .env.local and restart the dev server.';
        abortPendingTyped();
        setLastError(msg);
        addLog('info', msg);
        return;
    }

    // Secure-context check: getUserMedia only exists over HTTPS or http://localhost.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const msg = "This page can't reach the microphone API. It requires a secure context — open the app over HTTPS or http://localhost (a plain http forwarded URL will block it).";
        abortPendingTyped();
        setLastError(msg);
        addLog('info', msg);
        return;
    }

    // Mic pre-flight: acquire the microphone up front so we fail fast with a precise,
    // actionable reason (and surface the browser prompt) instead of opening a dead session.
    // The provider re-acquires its own stream once connected, so release this one.
    try {
      const preflight = await navigator.mediaDevices.getUserMedia({ audio: true });
      preflight.getTracks().forEach(t => t.stop());
    } catch (err: any) {
      let inIframe = false;
      try { inIframe = window.self !== window.top; } catch { inIframe = true; } // cross-origin access throws ⇒ framed
      const denied = err?.name === 'NotAllowedError' || /Permission denied|NotAllowed/.test(err?.message ?? '');
      const msg = denied
        ? (inIframe
            ? "Microphone blocked: the app is running inside an embedded preview that doesn't allow mic access. Open it in a full browser tab (the HTTPS URL), then allow the microphone."
            : "Microphone access was denied. Click the mic/lock icon in the address bar, set Microphone to Allow, then reload and try again.")
        : (err?.name === 'NotFoundError'
            ? "No microphone was found. Plug in or enable a mic and try again."
            : `Microphone unavailable: ${err?.message ?? err}`);
      abortPendingTyped();
      setLastError(msg);
      addLog('info', `Session Error: ${msg}`);
      return;
    }

    addLog('info', 'Starting Live Session...');
    try {
      addLog('info', 'Initializing AudioContext...');
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await audioContextRef.current.resume();
      primeEarcons(); // unlock the earcon audio context on this user gesture

      const honest = honestModeRef.current;
      addLog('info', `Prompt variant: ${honest ? 'HONEST (carries confidence, asks when unsure)' : 'CONFIDENT (Google baseline)'}`);

      // GeminiProvider owns the live session + mic; audio playback and response/interruption
      // UI stay in this component via the callbacks below. onSessionReady mirrors the raw
      // session into sessionRef so the Gemini-only auxiliary features keep working.
      const backend = voiceBackendRef.current;
      providerRef.current =
        backend === 'azure'
          ? createAzureRealtimeProvider(
              process.env.AZURE_OPENAI_ENDPOINT || '',
              process.env.AZURE_REALTIME_DEPLOYMENT || 'gpt-realtime-2',
              process.env.AZURE_OPENAI_API_KEY || '',
              process.env.AZURE_TRANSCRIBE_DEPLOYMENT || undefined,
            )
          : backend === 'openai'
            ? createOpenAIRealtimeProvider()
            : createGeminiProvider(apiKey!, (s) => { sessionRef.current = s; });
      const voice = backend === 'gemini' ? 'Zephyr' : backend === 'azure' ? 'alloy' : 'marin';
      await providerRef.current.connect(
        { instructions: buildInstructions(honest, program, entitiesRef.current), tools: voiceTools, voice },
        {
          onOpen: () => {
            setIsLive(true);
            addLog('info', 'Live Link Established');
            // TESTBED: snapshot the config + device so this session's metrics are attributable.
            telemetry.start({
              backend: voiceBackendRef.current,
              autonomy: autonomyRef.current,
              feedback: feedbackModeRef.current,
              program: activeProgram,
              honest: honestModeRef.current,
              device: detectDevice(),
            });
            setIsConnecting(false);
            if (pendingTypedRef.current) {
              providerRef.current?.sendUserText(pendingTypedRef.current);
              pendingTypedRef.current = null;
            }
          },
          onClose: () => { setIsLive(false); setIsConnecting(false); sessionRef.current = null; providerRef.current = null; addLog('info', 'Live Link Closed'); },
          onError: (m: string) => {
            setIsConnecting(false);
            pendingTypedRef.current = null;
            let errMsg = m;
            if (errMsg.includes('Permission denied') || errMsg.includes('NotAllowedError')) {
              errMsg = "Microphone access denied. Please check your browser settings and ensure this site has permission to use your microphone.";
            }
            setLastError(errMsg);
            addLog('info', `Session Error: ${errMsg}`);
            telemetry.error(errMsg);
            emitFeedback({ outcome: 'error', label: errMsg });
          },
          onInputTranscript: (text: string) => { lastInputModalityRef.current = 'voice'; processInputTranscript(text); },
          onToolCall: (call) => {
            if (showRotateOverlayRef.current || showMobileOverlayRef.current) return;
            if (lastTranscriptionTimeRef.current === 0) { addLog('info', 'Ignoring tool call before first transcription'); return; }
            handleVoiceToolCall(call);
          },
          onResponseStart: () => {
            if (showRotateOverlayRef.current || showMobileOverlayRef.current) return;
            if (lastTranscriptionTimeRef.current === 0) { addLog('info', 'Ignoring model turn before first transcription'); return; }
            setPersistentPaths([]);
            setLiveTranscription("");
            lastProcessedTranscriptionRef.current = "";
          },
          onModelAudio: (b64: string) => { handleLiveAudio(b64); },
          onInterrupted: () => {
            activeSourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
            activeSourcesRef.current = [];
            audioQueueRef.current = [];
            nextStartTimeRef.current = 0;
            lastAudioTimeRef.current = 0;
            setLiveTranscription("");
            lastProcessedTranscriptionRef.current = "";
            addLog('event', 'Model interrupted');
          },
        },
      );
    } catch (err) {
      let errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Permission denied') || errMsg.includes('NotAllowedError')) {
        errMsg = "Microphone access denied. Please check your browser settings and ensure this site has permission to use your microphone.";
      }
      abortPendingTyped();
      setLastError(errMsg);
      addLog('info', `Session Error: ${errMsg}`);
      console.error('Session Error:', err);
    }
  };

  // Keyboard Fallback
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
      if (!isLive) return;
      if (e.key === 't') addMarker("this");
      if (e.key === 'i') addMarker("it");
      if (e.key === 'h') addMarker("here");
      // G8: number keys 1–9 select a numbered target (pointer-free deixis).
      if (e.key >= '1' && e.key <= '9') selectTargetByNumber(Number(e.key));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // undoStack is a dep so ⌘Z never fires a stale handleUndo (its closure reads the stack).
  }, [isLive, activeProgram, undoStack]);

  // Visual Shimmering Loop
  useEffect(() => {
    const canvas = traceCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame: number;
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const now = Date.now();

      // Draw Cursor Trail (Only when Point and speak is active)
      if (isLive && cursorHistoryRef.current.length > 1) {
        ctx.beginPath();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        // Only render the most recent points for the trail
        const trailPoints = cursorHistoryRef.current.slice(-MAX_POINTS);
        
        for (let i = 1; i < trailPoints.length; i++) {
          const p1 = trailPoints[i - 1];
          const p2 = trailPoints[i];
          
          const age = now - p2.t;
          // Use the new MAX_LIFETIME for fade out
          const alpha = Math.max(0, 1 - age / MAX_LIFETIME);
          
          if (alpha > 0) {
            const x1 = (p1.x / 1000) * canvas.width;
            const y1 = (p1.y / 1000) * canvas.height;
            const x2 = (p2.x / 1000) * canvas.width;
            const y2 = (p2.y / 1000) * canvas.height;
            
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            // Use a slightly more vibrant version of the theme color
            ctx.strokeStyle = `rgba(133, 127, 231, ${alpha * 0.6})`;
            ctx.lineWidth = (2 + 4 * alpha); // Tapered line
            ctx.stroke();
          }
        }
      }

      // Markers no longer expire by time, they are cleared on image change
      // Keep markers visible during processing so the user sees where they pointed
      markersRef.current.forEach((m, mi) => {
          if (!m.displayLabel) return; // Hide markers without labels (e.g. from painting)

          const age = now - m.timestamp;
          // Instant appearance as requested
          const alpha = 1;
          // PHASE B: in honest mode, a low-confidence resolution is a GUESS, and a guess must
          // never render like a confident success. Uncertain markers are amber, dashed, and
          // carry a "?" + both candidate names; confident markers are today's solid gold.
          const isUncertain = honestModeRef.current && m.confidence === 'low';
          const pulse = Math.sin(age * (isUncertain ? 0.006 : 0.008)) * (isUncertain ? 12 : 8);

          // HUE = element category (program/os/ui/content); ring STYLE = confidence.
          // The two axes are orthogonal: a marker's colour tells you WHAT kind of thing was
          // selected, while solid-vs-dashed + "?" tells you how SURE the resolution is.
          const tone = CATEGORY_COLORS[m.category || categoryOf(m.identifiedObject)];

          // Map 0-1000 back to current canvas pixels
          // We use canvas.width/height directly to avoid stale closures
          const mx = (m.x / 1000) * canvas.width;
          const my = (m.y / 1000) * canvas.height;

          if (isUncertain) {
            // Soft glow (dimmer than a confident hit — this is a hedge, not a lock-on)
            const grad = ctx.createRadialGradient(mx, my, 2, mx, my, 34 + pulse);
            grad.addColorStop(0, `rgba(${tone}, ${alpha * 0.35})`);
            grad.addColorStop(1, `rgba(${tone}, 0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(mx, my, 34 + pulse, 0, Math.PI * 2);
            ctx.fill();

            // Dashed, slowly rotating ring — reads as "searching / not sure", not "locked on"
            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate((age * 0.0006) % (Math.PI * 2));
            ctx.setLineDash([6, 6]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = `rgba(${tone}, ${alpha})`;
            ctx.beginPath();
            ctx.arc(0, 0, 18 + Math.sin(age * 0.006) * 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            ctx.setLineDash([]);

            // "?" badge at the center
            ctx.fillStyle = `rgba(${tone}, ${alpha})`;
            ctx.font = "bold 16px 'Roboto Mono', monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("?", mx, my);
          } else {
            // CONFIDENT: solid category-coloured glow + fireflies (the lock-on).
            const grad = ctx.createRadialGradient(mx, my, 2, mx, my, 35 + pulse);
            grad.addColorStop(0, `rgba(${tone}, ${alpha * 0.6})`);
            grad.addColorStop(1, `rgba(${tone}, 0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(mx, my, 35 + pulse, 0, Math.PI * 2);
            ctx.fill();

            // Fireflies, tinted to the category hue
            for(let i=0; i<8; i++) {
              const orbit = 12 + Math.sin(age * 0.003 + i) * 10;
              const px = mx + Math.cos(age * 0.004 + i) * orbit;
              const py = my + Math.sin(age * 0.004 + i * 1.2) * orbit;
              ctx.beginPath();
              ctx.arc(px, py, 1.2, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(${tone}, ${alpha})`;
              ctx.shadowBlur = 8;
              ctx.shadowColor = `rgba(${tone}, 1)`;
              ctx.fill();
            }
            ctx.shadowBlur = 0; // Reset shadow after fireflies
          }

          // Label. Confident: the single displayLabel, fades after 2s. Uncertain: BOTH candidate
          // names, each with a "?", and it persists while this is the active marker so it
          // survives the disambiguating question.
          const labelText = isUncertain
            ? ((m.candidates && m.candidates.length)
                ? m.candidates.map(c => `${c.toUpperCase()}?`).join('   ·   ')
                : `${m.displayLabel.toUpperCase()}?`)
            : m.displayLabel.toUpperCase();
          const labelVisible = isUncertain ? (mi === 0) : (age < 2000);
          if (labelVisible && m.displayLabel) {
            ctx.shadowBlur = 0;
            ctx.font = "bold 9px 'Roboto Mono', monospace";
            const textMetrics = ctx.measureText(labelText);
            const px = 6;
            const py = 3;
            const bw = textMetrics.width + px * 2;
            const bh = 9 + py * 2;
            const bx = mx - bw / 2;
            const by = my - 40;

            // Rounded Box: near-black backing; uncertain markers get a category-hued outline.
            ctx.fillStyle = `rgba(26, 26, 26, ${alpha})`;
            ctx.beginPath();
            const r = 4;
            ctx.roundRect(bx, by, bw, bh, r);
            ctx.fill();
            if (isUncertain) {
              ctx.lineWidth = 1;
              ctx.strokeStyle = `rgba(${tone}, ${alpha})`;
              ctx.stroke();
            }

            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(labelText, mx, by + bh / 2);
          }
        });

      // PRE-FOCUS: highlight the element the active scenario wants the user to point at,
      // so they know where to aim before they move the cursor. A soft pulsing ring in the
      // element's category hue + a "POINT HERE" tag on its bbox.
      if (focusTitleRef.current) {
        const target = entityByTitle(entitiesRef.current, focusTitleRef.current);
        const [tymin, txmin, tymax, txmax] = target?.bbox ?? [0, 0, 0, 0];
        if (target && (txmax - txmin) > 0 && (tymax - tymin) > 0) {
          const x = (txmin / 1000) * canvas.width;
          const y = (tymin / 1000) * canvas.height;
          const w = ((txmax - txmin) / 1000) * canvas.width;
          const h = ((tymax - tymin) / 1000) * canvas.height;
          const tone = CATEGORY_COLORS[categoryOf(target.id)];
          const pulse = (Math.sin(now * 0.004) + 1) / 2; // 0..1
          const pad = 4 + pulse * 3;

          ctx.save();
          // Soft glow
          ctx.shadowBlur = 12 + pulse * 10;
          ctx.shadowColor = `rgba(${tone}, ${0.5 + pulse * 0.4})`;
          ctx.strokeStyle = `rgba(${tone}, ${0.85})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.roundRect(x - pad, y - pad, w + pad * 2, h + pad * 2, 10);
          ctx.stroke();
          ctx.restore();

          // "POINT HERE" tag
          const tag = 'POINT HERE';
          ctx.font = "bold 10px 'Roboto Mono', monospace";
          const tw = ctx.measureText(tag).width;
          const tagX = x - pad;
          const tagY = y - pad - 18;
          ctx.fillStyle = `rgb(${tone})`;
          ctx.beginPath();
          ctx.roundRect(tagX, tagY, tw + 12, 16, 4);
          ctx.fill();
          ctx.fillStyle = 'white';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(tag, tagX + 6, tagY + 8);
        }
      }

      // Draw Interactive Object Markings if enabled
      // Keep markings visible during processing for context
      if (showMarkings) {
        // Read from the ref so freshly-swapped programs colour correctly without re-running
        // this animation effect. Each outline is hued by its element category.
        entitiesRef.current.forEach(obj => {
          const [ymin, xmin, ymax, xmax] = obj.bbox;
          const x = (xmin / 1000) * canvas.width;
          const y = (ymin / 1000) * canvas.height;
          const w = ((xmax - xmin) / 1000) * canvas.width;
          const h = ((ymax - ymin) / 1000) * canvas.height;

          const tone = CATEGORY_COLORS[categoryOf(obj.id)];
          ctx.strokeStyle = `rgba(${tone}, 0.85)`;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(x, y, w, h);
          ctx.setLineDash([]);

          // Label
          ctx.fillStyle = `rgba(${tone}, 0.85)`;
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          const labelWidth = ctx.measureText(obj.name).width;
          ctx.fillRect(x, y - 18, labelWidth + 8, 18);
          ctx.fillStyle = 'white';
          ctx.fillText(obj.name, x + 4, y - 14);
        });
      }

      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [showMarkings, isLive]); // Re-run when markings or live state changes

  const handlePointerMove = React.useCallback((e: React.PointerEvent | PointerEvent) => {
    const rect = mainContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // Normalize coordinates relative to the entire main container (photos + map)
    const x = Math.max(0, Math.min(1000, ((e.clientX - rect.left) / rect.width) * 1000));
    const y = Math.max(0, Math.min(1000, ((e.clientY - rect.top) / rect.height) * 1000));
    
    const now = Date.now();
    const coords = { x, y };
    cursorRef.current = coords;
    setTrailMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });

    // Update hovered object for visual feedback
    const hX = Math.round(x);
    const hY = Math.round(y);
    const found = entitiesRef.current.find(e => {
      const [ymin, xmin, ymax, xmax] = e.bbox;
      return hX >= xmin && hX <= xmax && hY >= ymin && hY <= ymax;
    });
    const hovered = found ? found.id : null;
    setHoveredId(hovered);
    hoveredIdRef.current = hovered;

    // G3: which OCR word (if any) is under the cursor — finer-grained referent + feedforward.
    const sub = hovered ? wordAt(hX, hY) : null;
    const wordName = sub?.word ?? null;
    if (wordName !== hoveredWordRef.current) {
      hoveredWordRef.current = wordName;
      setHoveredWord(wordName);
    }

    // PROACTIVE GROUNDING (Azure/OpenAI realtime): Gemini sees continuous video + streaming
    // partial transcripts, so it already knows what the cursor is over when the user speaks.
    // The other backends get sparse frames + end-of-turn transcripts, so the deixis hint can
    // land too late. Pre-inform them what's under the cursor the moment it changes (throttled,
    // silent, no response forced) — so "this/here" is grounded regardless of transcript timing.
    if (
      providerRef.current &&
      voiceBackendRef.current !== 'gemini' &&
      hovered &&
      hovered !== lastHoverHintRef.current &&
      now - lastHoverHintAtRef.current > HOVER_HINT_THROTTLE_MS
    ) {
      lastHoverHintRef.current = hovered;
      lastHoverHintAtRef.current = now;
      const hoveredResolved = displayName(found);
      providerRef.current.sendTextHint(`[CONTEXT: the cursor is currently over "${hoveredResolved}". If the user says "this", "here", or "that", they are pointing at ${hoveredResolved}. This is silent context — DO NOT RESPOND OR SPEAK.]`);
    }

    // Only add to history if distance is enough (MIN_DISTANCE) to reduce jitter
    const lastPoint = cursorHistoryRef.current[cursorHistoryRef.current.length - 1];
    if (lastPoint) {
      const dx = x - lastPoint.x;
      const dy = y - lastPoint.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MIN_DISTANCE) return;
    }

    cursorHistoryRef.current.push({ x, y, t: now, hovered });
    
    if (isPainting && hovered) {
      setPointerPath(prev => [...prev, { x, y, timestamp: now }]);
    }
    
    // Increase history to 5 seconds to handle transcription latency better
    while (cursorHistoryRef.current.length > 0 && now - cursorHistoryRef.current[0].t > 5000) {
      cursorHistoryRef.current.shift();
    }
  }, [isPainting, mainSize]);
  
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isLive) return;

    const rect = mainContainerRef.current?.getBoundingClientRect();

    if (rect) {
      const x = ((e.clientX - rect.left) / rect.width) * 1000;
      const y = ((e.clientY - rect.top) / rect.height) * 1000;
      const found = entitiesRef.current.find(e => {
        const [ymin, xmin, ymax, xmax] = e.bbox;
        return x >= xmin && x <= xmax && y >= ymin && y <= ymax;
      });

      // TOUCH DEIXIS: touch has no hover — a tap is the point. Register the target at the
      // down position (cursor + hovered + history) so saying "this" right after a tap resolves,
      // even if no pointermove fired. (Mouse users already get this via hover; harmless there.)
      cursorRef.current = { x, y };
      const hovered = found ? found.id : null;
      setHoveredId(hovered);
      hoveredIdRef.current = hovered;
      cursorHistoryRef.current.push({ x, y, t: Date.now(), hovered });
    }

    setIsPainting(true);
    if (rect) {
      setTrailMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  };

  const handlePointerUp = React.useCallback(() => {
    setIsPainting(false);

    // Check if we have a path and are hovering an element
    if (pointerPath.length > 5 && hoveredIdRef.current) {
      // Add to persistent paths so it stays visible while speaking
      setPersistentPaths(prev => [...prev, pointerPath.map(p => ({ x: p.x, y: p.y }))]);

      const hoveredId = hoveredIdRef.current;
      const found = entityById(entitiesRef.current, hoveredId);

      if (found) {
        // Calculate the center of the circled area from the path bounding box
        const xs = pointerPath.map(p => p.x);
        const ys = pointerPath.map(p => p.y);
        const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
        const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

        // Drop a silent marker at the center of the circled area
        addMarker("", centerX, centerY);

        // Send a circle-gesture hint to whichever backend is live (core context).
        if (providerRef.current) {
          const markerIndex = markersRef.current.length; // Approximate index
          providerRef.current.sendTextHint(`[SYSTEM: User circled an area on ${displayName(found)} and a marker M${markerIndex} has been placed at [${Math.round(centerX)}, ${Math.round(centerY)}].]`);
        }
      }
    }
    // Clear path after gesture
    setPointerPath([]);
  }, [pointerPath]);

  // Global cursor tracking to prevent "stuck" UI cursor
  useEffect(() => {
    const handleGlobalMove = (e: PointerEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      handlePointerMove(e);
    };
    const handleGlobalUp = () => {
      handlePointerUp();
    };
    window.addEventListener('pointermove', handleGlobalMove);
    window.addEventListener('pointerup', handleGlobalUp);
    
    // Global click listener to unlock AudioContext
    const unlockAudio = () => {
      if (audioContextRef.current) {
        audioContextRef.current.resume().then(() => {
          setAudioStatus(audioContextRef.current!.state as any);
        });
      }
    };
    window.addEventListener('click', unlockAudio);
    
    return () => {
      window.removeEventListener('pointermove', handleGlobalMove);
      window.removeEventListener('pointerup', handleGlobalUp);
      window.removeEventListener('click', unlockAudio);
    };
  }, [handlePointerMove, handlePointerUp]);


  // G3 OCR retired: this effect previously OCR-d img.url picsum stock photos and sent hints
  // like `[OCR: "Word Ribbon" contains the text: ...]` — asserting on-screen text from images
  // that no longer render anywhere. Retired with the picsum tiles (Task 9/10). A future pass
  // can OCR the live surface snapshot (surfaceSnapshotRef) instead and remain honest.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { /* retired — see comment above */ }, [ocrEnabled, isLive, activeProgram]);

  // Tile perception retired with the picsum tiles: the surfaces ARE self-describing DOM,
  // so registered titles are literally what's on screen. The PerceivedCache seam stays
  // (buildEntities accepts it) for a future surface-snapshot-based perception pass.

  // Vision pipeline
  useEffect(() => {
    if (!isLive) return;

    // AI Vision doesn't need full resolution. 400px scene is plenty; an 88px DOCUMENT strip
    // below shows the live mock-doc state so the model sees the result of its own edits (G2).
    const VISION_SIZE = 400;
    const DOC_STRIP = 88;
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = VISION_SIZE;
    offscreenCanvas.height = VISION_SIZE + DOC_STRIP;
    const ctx = offscreenCanvas.getContext('2d', { alpha: false });

    const interval = setInterval(() => {
      if (!ctx || !layoutBounds) return;
      
      // Clear and draw background (full canvas incl. the doc strip)
      ctx.fillStyle = '#f8f9fc';
      ctx.fillRect(0, 0, VISION_SIZE, VISION_SIZE + DOC_STRIP);

      // Draw Program Window
      const p = layoutBounds.window;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e5e5e5';
      ctx.lineWidth = 1;
      ctx.fillRect((p.xmin/1000)*VISION_SIZE, (p.ymin/1000)*VISION_SIZE, ((p.xmax-p.xmin)/1000)*VISION_SIZE, ((p.ymax-p.ymin)/1000)*VISION_SIZE);
      ctx.strokeRect((p.xmin/1000)*VISION_SIZE, (p.ymin/1000)*VISION_SIZE, ((p.xmax-p.xmin)/1000)*VISION_SIZE, ((p.ymax-p.ymin)/1000)*VISION_SIZE);

      // Draw the program surface — REAL pixels when the snapshot is fresh, else labeled
      // boxes per element (honest fallback: labels only, never stale imagery).
      const sCanvas = surfaceSnapshotRef.current;
      if (sCanvas) {
        const b = layoutBounds.surface ?? layoutBounds.window;
        const dx = (b.xmin / 1000) * VISION_SIZE, dy = (b.ymin / 1000) * VISION_SIZE;
        const dw = ((b.xmax - b.xmin) / 1000) * VISION_SIZE, dh = ((b.ymax - b.ymin) / 1000) * VISION_SIZE;
        try { ctx.drawImage(sCanvas, dx, dy, dw, dh); } catch { /* keep canvas clean */ }
        ctx.strokeStyle = '#e5e5e5';
        ctx.strokeRect(dx, dy, dw, dh);
      } else {
        layoutBounds.photoItems.forEach((item) => {
          const b = item.bbox;
          const dx = (b.xmin/1000)*VISION_SIZE, dy = (b.ymin/1000)*VISION_SIZE;
          const dw = ((b.xmax-b.xmin)/1000)*VISION_SIZE, dh = ((b.ymax-b.ymin)/1000)*VISION_SIZE;
          ctx.fillStyle = '#f1f5f9';
          ctx.fillRect(dx, dy, dw, dh);
          ctx.strokeStyle = '#e5e5e5';
          ctx.strokeRect(dx, dy, dw, dh);
          ctx.fillStyle = '#64748b';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          const title = program.images.find(im => im.id === item.id)?.title ?? '';
          ctx.fillText(title, dx + dw / 2, dy + dh / 2);
        });
      }

      // AI Crosshairs (mapped from 0-1000 back to vision canvas pixels)
      const last = cursorRef.current;
      const px = (last.x / 1000) * VISION_SIZE;
      const py = (last.y / 1000) * VISION_SIZE;

      ctx.strokeStyle = 'red';
      ctx.lineWidth = 3; 
      ctx.beginPath();
      ctx.moveTo(0, py); ctx.lineTo(VISION_SIZE, py);
      ctx.moveTo(px, 0); ctx.lineTo(px, VISION_SIZE);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.fill();

      ctx.fillStyle = 'red';
      ctx.font = 'bold 12px sans-serif';
      const coordText = `[${Math.round(last.x)}, ${Math.round(last.y)}]`;
      ctx.fillText(coordText, px + 10, py - 10);

      // Draw Markers on the vision canvas
      markersRef.current.forEach((m, i) => {
        const mx = (m.x / 1000) * VISION_SIZE;
        const my = (m.y / 1000) * VISION_SIZE;
        
        ctx.strokeStyle = '#FFD700'; // Gold
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mx, my, 10, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'black';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`M${i+1}`, mx, my - 15);
      });

      // DOCUMENT STRIP (G2): render the live mock-doc state so the model sees the result of its
      // own edits — closes the action→result loop for multi-step work.
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, VISION_SIZE, VISION_SIZE, DOC_STRIP);
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('DOCUMENT STATE', 6, VISION_SIZE + 14);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '9px monospace';
      // simple word-wrap into the strip
      const docText = (mockDocRef.current.kind === 'excel')
        ? 'Excel — see SPREADSHEET image + [SPREADSHEET DATA] hint'
        : serializeMockDoc(mockDocRef.current);
      const docWords = docText.split(' ');
      let line = '';
      let ly = VISION_SIZE + 30;
      for (const w of docWords) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > VISION_SIZE - 12 && line) {
          ctx.fillText(line, 6, ly);
          line = w;
          ly += 11;
          if (ly > VISION_SIZE + DOC_STRIP - 4) { line = ''; break; }
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, 6, ly);

      // Encode and send - use toBlob (async) to avoid blocking the main thread
      offscreenCanvas.toBlob((blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          providerRef.current?.sendVideoFrame(base64);
        };
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.6);
    }, sendFrequency);
    return () => clearInterval(interval);
  }, [isLive, sendFrequency, layoutBounds, activeProgram]);

  // Refresh the real-pixel surface snapshot (throttled, fail-soft) for the vision frame.
  useEffect(() => {
    // Clear immediately so a program swap never composites the previous program's pixels.
    surfaceSnapshotRef.current = null;
    if (!isLive) return;
    let cancelled = false;
    const gate = makeThrottle(500);
    const tick = async () => {
      if (cancelled || !gate(Date.now())) return;
      const node = surfaceRef.current;
      if (!node) { surfaceSnapshotRef.current = null; return; } // closed window — clear stale pixels
      const canvas = await snapshotNode(node);
      if (!cancelled && canvas) surfaceSnapshotRef.current = canvas;
    };
    const interval = setInterval(tick, 250);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isLive, activeProgram]);

  // Send the live structured spreadsheet data alongside the pixels (learnings §4: never labels-only).
  useEffect(() => {
    if (!isLive || activeProgram !== 'excel') return;
    const hint = formatSnapshotForModel(buildSpreadsheetSnapshot(mockDoc));
    providerRef.current?.sendTextHint(hint);
  }, [isLive, activeProgram, mockDoc]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (transcriptionTimeoutRef.current) clearTimeout(transcriptionTimeoutRef.current);
      void terminateOcr(); // free the OCR worker
    };
  }, []);

  // Swap the active program (Word/Excel/PowerPoint/Photo). Clears selection + task progress,
  // resets the mock document, and lets the layout effect recompute bboxes for the new images.
  // Because the program now drives the tools AND the prompt, reconnect if live so the model
  // gets the right verbs/instructions (mirrors the honest-mode reconnect).
  const handleProgramChange = (id: ProgramId) => {
    if (id === activeProgram) return;
    setActiveProgram(id);
    markersRef.current = [];
    setEntities([]);
    entitiesRef.current = [];
    setPendingAction(null);
    const fresh = initialMockDoc(id);
    setMockDoc(fresh);
    mockDocRef.current = fresh;
    setUndoStack([]);
    referents.clear();
    callDeduperRef.current.reset();
    ocrWordsRef.current = {};
    clearOcrCache();
    setHoveredWord(null);
    layoutVersionRef.current++; // G7: structural layout change → bump scene version
    addLog('info', `Program switched to ${getProgram(id).label}`);
    // The reconnect (if live) happens in the [activeProgram] effect below, so it runs after
    // re-render and captures the new program's tools + prompt.
  };

  // Undo the most recent committed document mutation (restore the memento).
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setMockDoc(last.doc);
    mockDocRef.current = last.doc;
    setUndoStack(undoStack.slice(0, -1));
    setPendingAction(null);
    telemetry.correction(); // undo = a correction signal for the testbed
    emitFeedback({ outcome: 'undo', label: `Undid ${last.label}` });
  };

  const handleReset = () => {
    setPersistentPaths([]);
    setPointerPath([]);
    const baseEntities = buildEntities(program, perceivedLabelsRef.current, null);
    setEntities(baseEntities);
    entitiesRef.current = baseEntities;
    setShareRequest(null);
    setPendingAction(null);
    const freshDoc = initialMockDoc(activeProgram);
    setMockDoc(freshDoc);
    mockDocRef.current = freshDoc;
    setUndoStack([]);
    referents.clear();
    addLog('info', 'Desktop reset to original state.');
  };

  if (!isWideEnough) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[var(--bg-color)] bg-dots text-[var(--text-primary)] p-6 text-center">
        <div className="mb-12">
          <LaptopSmileyIcon size={180} className="text-gray-300 dark:text-gray-700" />
        </div>
        <h2 className="text-3xl font-bold mb-4 text-[#0f172a] dark:text-white">We can’t quite fit everything on your screen.</h2>
        <p className="text-[#64748b] dark:text-slate-400 text-xl max-w-lg leading-relaxed mb-8">
          please make this window wider and make sure to use a laptop or desktop device.
        </p>
        <button
          onClick={() => setBypassDeviceGate(true)}
          className="px-5 py-3 rounded-full font-dm font-bold text-sm border border-[var(--card-border)] text-[var(--text-primary)] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:text-white transition-colors active:scale-95"
        >
          Continue anyway — testbed mode ↗
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-screen bg-[var(--bg-color)] bg-dots text-[var(--text-primary)] overflow-hidden font-sans selection:bg-indigo-500/30 ${isLive ? 'custom-cursor-active' : ''}`}>
      <div className="flex-1 overflow-hidden">
        <main
          ref={mainContainerRef}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{ touchAction: isLive ? 'none' : 'auto' }}
          className="h-full w-full relative bg-[var(--bg-color)]"
        >
          <div aria-hidden className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[radial-gradient(circle_at_1px_1px,currentColor_1px,transparent_0)] [background-size:24px_24px]" />
          <MenuBar isLive={isLive} isConnecting={isConnecting} isDarkMode={isDarkMode} onToggleTheme={() => setIsDarkMode(!isDarkMode)} onToggleDrawer={() => setDrawerOpen(o => !o)} />
          <Dock active={activeProgram} onSelect={handleProgramChange} onReopen={() => setWindowOpen(true)} />
          <CursorResources mode={isPainting ? 'painting' : 'off'} color="#3b82f6" />
          <CursorTrail isActive={isPainting} mousePos={trailMousePos} color="#3b82f6" />
          <PaintLayer paths={persistentPaths} activePath={pointerPath} containerSize={mainSize} />
          {/* Global Trace Canvas for visual feedback over everything */}
          <canvas
            ref={traceCanvasRef}
            width={mainSize.width}
            height={mainSize.height}
            className={`absolute inset-0 z-50 pointer-events-none ${isLive ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
          />
          <TeachingLayer entities={entities} program={program} demo={teachMode} dispatchRef={teachingDispatchRef} onStateChange={setTeachingSnapshot} />
          {/* G6 FEEDFORWARD: live "what I'll act on" preview as the cursor moves, so the user
              sees the interpretation forming BEFORE they speak (closes the gulf of execution). */}
          {isLive && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-sm">
              <span className={`w-2 h-2 rounded-full ${hoveredId ? 'bg-[var(--accent-color)] animate-pulse' : 'bg-[var(--text-secondary)] opacity-40'}`} />
              <span className="text-[11px] font-mono text-[var(--text-primary)]">
                {hoveredId
                  ? `Pointing at: ${hoveredWord ? `"${hoveredWord}" in ${displayName(entityById(entitiesRef.current, hoveredId))}` : displayName(entityById(entitiesRef.current, hoveredId))}`
                  : 'Point at an element…'}
              </span>
            </div>
          )}
          {/* Highlight category legend — explains the colour ↔ category mapping while debug markings are on */}
          {showMarkings && (
            <div className="absolute top-3 right-3 z-50 pointer-events-none rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur px-3 py-2 shadow-md">
              <div className="text-[9px] font-mono uppercase tracking-wide text-[var(--text-secondary)] mb-1">Highlights</div>
              <div className="flex flex-col gap-1">
                {(Object.keys(CATEGORY_LABELS) as ElementCategory[]).map(cat => (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: `rgb(${CATEGORY_COLORS[cat]})` }} />
                    <span className="text-[10px] font-mono text-[var(--text-primary)]">{CATEGORY_LABELS[cat]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Feedback toast — the always-on VISUAL channel (minimum-feedback floor). Shows on
              every action regardless of the Feedback dial, so "did it work?" is always answerable. */}
          {feedbackToast && (
            <div
              key={feedbackToast.at}
              onPointerDown={(e) => e.stopPropagation()}
              className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-[60] pointer-events-none [&>button]:pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full shadow-lg border backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-200 ${
                feedbackToast.outcome === 'error'
                  ? 'bg-red-500/10 border-red-500/40 text-red-600 dark:text-red-400'
                  : feedbackToast.outcome === 'needs-confirm'
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400'
                    : 'bg-[var(--card-bg)]/95 border-[var(--card-border)] text-[var(--text-primary)]'
              }`}
            >
              {feedbackToast.outcome === 'error'
                ? <X size={14} />
                : feedbackToast.outcome === 'needs-confirm'
                  ? <Shield size={14} />
                  : <CheckCircle size={14} className="text-green-500" />}
              <span className="text-[12px] font-mono">{feedbackToast.label}</span>
              {feedbackToast.outcome !== 'error' && undoStack.length > 0 && (
                <button onClick={handleUndo} className="pointer-events-auto ml-1 underline decoration-dotted text-[11px] font-mono">undo</button>
              )}
            </div>
          )}

          {windowOpen && (
            <ProgramWindow
              title={program.label}
              statusLabel={docStatusLabel(mockDoc)}
              rect={windowRect}
              onRectChange={setWindowRect}
              onClose={() => setWindowOpen(false)}
              planeRef={mainContainerRef}
            >
              <ProgramSurface ref={surfaceRef} program={program} doc={mockDoc} live={isLive} focusTitle={focusTitle}
                onAction={handleSurfaceAction} onElementClick={handleSurfaceElementClick} />
            </ProgramWindow>
          )}

          <Omnibox
            isLive={isLive} isConnecting={isConnecting}
            error={lastError} transcript={liveTranscription || null}
            suggestions={suggestions} firstRunHint={firstRunHint}
            restoredDraft={restoredDraft}
            onSubmit={(text) => { setFirstRunHint(false); setFocusTitle(undefined); sendTypedInput(text); }}
            onMicToggle={() => { setFirstRunHint(false); isLive ? providerRef.current?.close() : startLiveSession(); }}
            onChipTap={(s) => setFocusTitle(TASKS.find(t => t.key === s.key)?.targetElement)}
          />

          <RailPanel
            state={railState}
            teachingRail={teachingSnapshot ? projectTeaching(teachingSnapshot) : null}
            onEvent={railDispatch}
            onShowMe={(id) => { telemetry.guidance('show_me', { taskKey: railState.rail?.seq }); teachingDispatchRef.current?.({ type: 'teach.highlight', entityId: id as EntityId }); }}
          />

          {/* Witness cards — confirm/cancel by button or voice. */}
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 w-[min(560px,88vw)] flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()}>
            {shareRequest && (
              <section className={`shrink-0 bg-[var(--card-bg)] border rounded-2xl p-6 animate-in fade-in slide-in-from-top-2 duration-300 ${shareRequest.confirmed ? 'border-green-500/50' : 'border-amber-500/40'}`}>
                <div className="flex items-center gap-2 mb-3">
                  {shareRequest.confirmed
                    ? <CheckCircle size={16} className="text-green-500" />
                    : <Shield size={16} className="text-amber-500" />}
                  <span className={`text-[11px] font-mono font-bold uppercase tracking-widest ${shareRequest.confirmed ? 'text-green-500' : 'text-amber-500'}`}>
                    {shareRequest.confirmed ? 'Sent' : 'About to send — confirm'}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 mb-3">
                  <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <span className="text-[10px] font-mono uppercase text-[var(--text-secondary)] w-16 shrink-0">To</span>
                    <span className="font-semibold">{shareRequest.recipient}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <span className="text-[10px] font-mono uppercase text-[var(--text-secondary)] w-16 shrink-0">Payload</span>
                    <span>{shareRequest.payload ?? 'this'}</span>
                  </div>
                </div>
                {!shareRequest.confirmed && (
                  <div className="flex items-center gap-2">
                    <button onClick={confirmShare}
                      className="px-4 py-1.5 rounded-full text-[12px] font-bold bg-amber-500 text-white hover:bg-amber-600 active:scale-95 transition-all">
                      Confirm
                    </button>
                    <button onClick={cancelShare}
                      className="px-4 py-1.5 rounded-full text-[12px] font-mono border border-[var(--card-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 transition-all">
                      Cancel
                    </button>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)] ml-1">or say "yes"</span>
                  </div>
                )}
              </section>
            )}
            {pendingAction && (
              <section className={`shrink-0 bg-[var(--card-bg)] border rounded-2xl p-6 animate-in fade-in slide-in-from-top-2 duration-300 ${pendingAction.confirmed ? 'border-green-500/50' : 'border-amber-500/40'}`}>
                <div className="flex items-center gap-2 mb-3">
                  {pendingAction.confirmed
                    ? <CheckCircle size={16} className="text-green-500" />
                    : <Shield size={16} className="text-amber-500" />}
                  <span className={`text-[11px] font-mono font-bold uppercase tracking-widest ${pendingAction.confirmed ? 'text-green-500' : 'text-amber-500'}`}>
                    {pendingAction.confirmed ? 'Done' : 'About to act — confirm'}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 mb-3">
                  <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <span className="text-[10px] font-mono uppercase text-[var(--text-secondary)] w-16 shrink-0">Action</span>
                    <span className="font-semibold">{pendingAction.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <span className="text-[10px] font-mono uppercase text-[var(--text-secondary)] w-16 shrink-0">Target</span>
                    <span>{pendingAction.target}</span>
                  </div>
                  {pendingAction.detail && (
                    <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                      <span className="text-[10px] font-mono uppercase text-[var(--text-secondary)] w-16 shrink-0">Detail</span>
                      <span>{pendingAction.detail}</span>
                    </div>
                  )}
                </div>
                {pendingAction.note && (
                  <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400 mb-2">⚠ {pendingAction.note}</p>
                )}
                {!pendingAction.confirmed && (
                  <div className="flex items-center gap-2">
                    <button onClick={confirmPendingAction}
                      className="px-4 py-1.5 rounded-full text-[12px] font-bold bg-amber-500 text-white hover:bg-amber-600 active:scale-95 transition-all">
                      Confirm
                    </button>
                    <button onClick={cancelPendingAction}
                      className="px-4 py-1.5 rounded-full text-[12px] font-mono border border-[var(--card-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 transition-all">
                      Cancel
                    </button>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)] ml-1">or say "yes"</span>
                  </div>
                )}
              </section>
            )}
          </div>

        </main>

        <DebugDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          honestMode={honestMode}
          onHonestMode={setHonestMode}
          voiceBackend={voiceBackend}
          onVoiceBackend={setVoiceBackend}
          autonomy={autonomy}
          onAutonomy={setAutonomy}
          feedbackMode={feedbackMode}
          onFeedbackMode={setFeedbackMode}
          sendFrequency={sendFrequency}
          onSendFrequency={setSendFrequency}
          worldState={serializeMockDoc(mockDoc)}
          undoCount={undoStack.length}
          onUndo={handleUndo}
          onEndSession={() => providerRef.current?.close()}
          onReset={handleReset}
          isLive={isLive}
          logs={logs}
          isEmbedded={isEmbedded}
        />

      </div>

  {/* Custom Cursor */}
  {isLive && (
    <div
      className="fixed top-0 left-0 pointer-events-none z-[40000] hidden sm:block"
      style={{ 
        transform: `translate3d(${mousePos.x}px, ${mousePos.y}px, 0)`,
      }}
    >
      {/* Glow Overlay */}
      <div className="cursor-glow-layer" />

      <svg width="25" height="28" viewBox="0 0 25 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 4px #ADCCF9)' }} className="relative z-10">
        <path d="M3 3 L10 25 L13 18 L22 14 L3 3 Z" fill="white" stroke="#1A73E8" strokeWidth="1.5" shapeRendering="geometricPrecision" />
      </svg>
    </div>
  )}

  <AnimatePresence>
    {showMobileOverlay && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[30000] flex flex-col items-center justify-center p-8 text-center bg-[var(--bg-color)]"
        style={{
          backgroundImage: 'radial-gradient(var(--dot-color) 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      >
        <div className="flex flex-col items-center justify-center max-w-md">
          <img 
            src={isDarkMode ? "https://www.gstatic.com/aistudio/ai-pointer-find/not_mobile_2.png" : "https://www.gstatic.com/aistudio/ai-pointer-find/not_mobile.png"} 
            alt="Not mobile" 
            className="w-24 h-auto mb-10"
          />
          <h2 className="text-base font-dm font-bold text-[var(--text-primary)] leading-tight">
            This experience works best on a laptop or desktop
            <br />
            <span className="text-[var(--text-secondary)] font-normal mt-2 block">Please view on a different device</span>
          </h2>
          <button
            onClick={() => setBypassDeviceGate(true)}
            className="mt-6 px-4 py-2 rounded-full font-dm font-bold text-xs border border-[var(--card-border)] text-[var(--text-primary)] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:text-white transition-colors active:scale-95"
          >
            Continue anyway — testbed mode ↗
          </button>
        </div>
      </motion.div>
    )}
  </AnimatePresence>

  <AnimatePresence>
    {showRotateOverlay && !showMobileOverlay && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[20000] flex flex-col items-center justify-center p-8 text-center bg-[var(--bg-color)]"
        style={{
          backgroundImage: 'radial-gradient(var(--dot-color) 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      >
        <div className="flex flex-col items-center justify-center max-w-md">
          <img 
            src={isDarkMode ? "https://www.gstatic.com/aistudio/ai-pointer-find/turn_device_2.png" : "https://www.gstatic.com/aistudio/ai-pointer-find/turn_device.png"} 
            alt="Rotate device" 
            className="w-48 h-auto mb-10"
          />
          <h2 className="text-base font-dm font-bold text-[var(--text-primary)] leading-tight">
            We can’t quite fit everything on your screen.
            <br />
            <span className="text-[var(--text-secondary)] font-normal mt-2 block">Please rotate your device</span>
          </h2>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
</div>
);
}
