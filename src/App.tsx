/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import confetti from 'canvas-confetti';
import { GoogleGenAI, Modality, Type, GenerateContentResponse } from '@google/genai';
import type { VoiceTool, VoiceProvider, ProviderKind } from './voice/types';
import { 
  Mic, 
  MicOff, 
  ChevronRight, 
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Lightbulb,
  Settings,
  X,
  CheckCircle,
  Plus,
  MoreVertical,
  Sun,
  Moon,
  Laptop,
  Shield,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
import { perceiveTileLabel, loadImageAsBase64 } from './perception/perceiveTile';
import type { PerceivedCache } from './perception/perceiveTile';
import { buildEntities, entityById, entityByTitle, displayName, MAP_ENTITY_ID, resolveEchoedTarget } from './entities/registry';
import type { SceneEntity, EntityId } from './entities/registry';
import { TeachingLayer } from './teaching/TeachingLayer';
import { MockPreview } from './components/MockPreview';
import { emitFeedbackAudio, FEEDBACK_OPTIONS } from './feedback';
import type { FeedbackMode, FeedbackEvent } from './feedback';
import { primeEarcons, playEarcon, EARCON_KINDS } from './feedback/earcons';
import { telemetry, detectDevice } from './telemetry';
import { referents } from './referents';
import { CallDeduper, argsKey, parseRepair } from './coherence';
import { assignTargetNumbers, parseTargetSelection } from './input_targets';
import { ocrImage, terminateOcr, clearOcrCache } from './ocr';
import type { OcrWord } from './ocr';
import { buildSpreadsheetSnapshot, formatSnapshotForModel } from './widgets/spreadsheetData';
import { ProgramSurface } from './widgets/ProgramSurface';
import type { TeachingEvent } from './teaching/types';
import { snapshotNode, makeThrottle } from './vision/snapshotNode';
import { parseTypedSubmit } from './input/typedInput';
import type { InputModality } from './telemetry';

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
const BASE_SIZE = 800;
const INITIAL_IMAGE = "https://picsum.photos/seed/london-map/800/800";
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
// This is NOT a perception-confidence model. It's a synthesized signal — a geometric
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
    if (o.category === 'map') return false;
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
    name: 'update_map',
    description: 'Update the map to show a specific location or search for nearby places. ONLY call this tool if the user EXPLICITLY asks you to update the map or search for something verbally.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'The location name or search query.' } }, required: ['query'] },
  },
  {
    name: 'show_directions',
    description: 'Show directions between two locations on the map. ONLY call this tool if the user EXPLICITLY asks you for directions or how to get somewhere verbally.',
    parameters: { type: 'object', properties: { origin: { type: 'string', description: 'The starting location.' }, destination: { type: 'string', description: 'The destination location.' } }, required: ['origin', 'destination'] },
  },
  {
    name: 'explain',
    description: 'Verbally name or describe what the user is pointing at (e.g. "what is this?", "what am I looking at?"). LOW-COMMITMENT: it does NOT change the map. Call it when the user asks to identify something rather than navigate.',
    parameters: { type: 'object', properties: { subject: { type: 'string', description: 'The landmark or thing being identified.' } }, required: ['subject'] },
  },
  {
    name: 'synthesize',
    description: 'Plan a multi-stop day itinerary from several landmarks (e.g. "plan a day from these"). Call WITHOUT confirm to PROPOSE the plan as a hypothesis first; call with confirm=true only after the user explicitly approves, to build the route.',
    parameters: { type: 'object', properties: { places: { type: 'array', items: { type: 'string' }, description: 'Ordered list of stops for the day.' }, plan: { type: 'string', description: 'A short human-readable description of the proposed day (e.g. duration, order).' }, confirm: { type: 'boolean', description: 'Set true ONLY after the user has explicitly confirmed they want it built. Omit/false to first propose.' } }, required: ['places'] },
  },
  {
    name: 'share',
    description: 'Share something (e.g. an itinerary) with another person (e.g. "share this with Lia"). OUTWARD, high-commitment action. Call WITHOUT confirm to witness-render the recipient and payload first; call with confirm=true only after the user explicitly approves sending.',
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
  // Derive the legacy constant shapes from the active program so the rest of App is unchanged.
  const PHOTOS = program.images;
  // The carousel is built from the shared task library, filtered + ordered for this program.
  const TASKS = React.useMemo(() => tasksForProgram(activeProgram), [activeProgram]);
  // Tools offered to the voice model = the original tourism verbs + the action verbs this
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
  // Scene source of truth: the entity registry (one entity per program image + the map).
  const [entities, setEntities] = useState<SceneEntity[]>([]);
  const entitiesRef = useRef<SceneEntity[]>([]);
  // id → category, read live by the canvas renderer (kept in a ref to avoid stale closures).
  const categoryMapRef = useRef<Record<string, ElementCategory>>({});
  React.useEffect(() => {
    const m: Record<string, ElementCategory> = {};
    for (const e of entitiesRef.current) if (e.category !== 'map') m[e.id] = e.category as ElementCategory;
    categoryMapRef.current = m;
  }, [entities]);
  const categoryOf = (id?: EntityId | null): ElementCategory =>
    (id && categoryMapRef.current[id]) || DEFAULT_CATEGORY;

  // The active scenario's target element name, read live by the canvas renderer (ref avoids
  // stale closures since the render loop's effect doesn't re-run on every task switch).
  const focusTitleRef = useRef<string | undefined>(undefined);

  const [showWelcome, setShowWelcome] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showRotateOverlay, setShowRotateOverlay] = useState(false);
  const [showMobileOverlay, setShowMobileOverlay] = useState(false);
  // Testbed: run on phone/tablet to evaluate the paradigm across form factors, bypassing the
  // desktop-only gate + the mobile/rotate overlays.
  const [bypassDeviceGate, setBypassDeviceGate] = useState(false);

  const handleDismissWelcome = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setShowWelcome(false);
    setShowOnboarding(true);
  };
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
  const [currentImage, setCurrentImage] = useState(INITIAL_IMAGE);
  const [history, setHistory] = useState<{ image: string; objects: SceneEntity[] }[]>([]);
  const [dims, setDims] = useState({ width: BASE_SIZE, height: BASE_SIZE });
  const [mainSize, setMainSize] = useState({ width: 0, height: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [liveTranscription, setLiveTranscription] = useState("");
  const [typedDraft, setTypedDraft] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const pendingTypedRef = useRef<string | null>(null);
  const lastInputModalityRef = useRef<InputModality>('voice');
  const [pendingEdit, setPendingEdit] = useState<{
    prompt: string; 
    bbox: BBox; 
    marker?: { x: number, y: number };
    destMarker?: { x: number, y: number };
    objectName?: string;
    id: string; 
    name: string;
    receivedAt: number;
  } | null>(null);
  const [pendingMapUpdate, setPendingMapUpdate] = useState<{
    type: 'search' | 'directions';
    query?: string;
    origin?: string;
    destination?: string;
    id: string;
    name: string;
    receivedAt: number;
  } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [currentCoords, setCurrentCoords] = useState({ x: 500, y: 500 });
  const [mousePos, setMousePos] = useState({ x: -100, y: -100 });
  const [isPainting, setIsPainting] = useState(false);
  const [trailMousePos, setTrailMousePos] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<EntityId | null>(null);
  const perceivedLabelsRef = useRef<PerceivedCache>({});
  const [perceivedVersion, setPerceivedVersion] = useState(0);
  const teachMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('teach');
  const hoveredIdRef = useRef<EntityId | null>(null);
  // Throttle state for proactive hover grounding (non-Gemini backends).
  const lastHoverHintRef = useRef<string | null>(null);
  const lastHoverHintAtRef = useRef(0);

  const showWelcomeRef = useRef(showWelcome);
  const showOnboardingRef = useRef(showOnboarding);
  const showRotateOverlayRef = useRef(showRotateOverlay);
  const showMobileOverlayRef = useRef(showMobileOverlay);

  useEffect(() => {
    showWelcomeRef.current = showWelcome;
    showOnboardingRef.current = showOnboarding;
    showRotateOverlayRef.current = showRotateOverlay;
    showMobileOverlayRef.current = showMobileOverlay;
  }, [showWelcome, showOnboarding, showRotateOverlay, showMobileOverlay]);

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
  const persistentCanvasRef = useRef<HTMLCanvasElement>(null);
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
  const resetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastExecutedPromptRef = useRef<string | null>(null);
  const isProcessingRef = useRef(false);
  const hasPendingEditRef = useRef(false);
  const lastProcessedTranscriptionRef = useRef<string>("");
  const spatialDescriptionRef = useRef<string | null>(null);
  // PHASE F (S6): distinct landmarks pointed at this session, + a one-shot guard so the proactive
  // trip-pattern offer fires at most once.
  const identifiedLandmarksRef = useRef<Set<string>>(new Set());
  const hasOfferedTripRef = useRef(false);

  const [sendFrequency, setSendFrequency] = useState(150); // Increased frequency for better AI responsiveness
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState(0); // -1 for left, 1 for right
  const [completedTaskIds, setCompletedTaskIds] = useState<number[]>([]);
  const [mapQuery, setMapQuery] = useState("London");
  const [mapType, setMapType] = useState<'search' | 'directions'>('search');
  const [directions, setDirections] = useState<{ origin: string; destination: string } | null>(null);
  // PHASE E: a synthesized itinerary proposed as a hypothesis, awaiting the user's confirm.
  const [proposedItinerary, setProposedItinerary] = useState<{ places: string[]; plan?: string } | null>(null);
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
      if (obj.category === 'map') continue;
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
  // Refresh tick so the live telemetry readout updates during a session.
  const [telemetryTick, setTelemetryTick] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setTelemetryTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  // Single entry point for action feedback: routes audio per DIAL B and always shows a toast.
  const emitFeedback = (ev: FeedbackEvent) => {
    emitFeedbackAudio(ev, feedbackModeRef.current);
    addLog(ev.outcome === 'error' ? 'info' : 'event', `Feedback: ${ev.outcome} — ${ev.label}`);
    setFeedbackToast({ outcome: ev.outcome, label: ev.label, at: Date.now() });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setFeedbackToast(null), 2600);
  };
  const [layoutBounds, setLayoutBounds] = useState<{
    photos: BBox;
    map: BBox;
    photoItems: { id: number; bbox: BBox }[];
    spreadsheet?: BBox;
  } | null>(null);
  const spreadsheetRef = useRef<HTMLDivElement>(null);
  const spreadsheetSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  const teachingDispatchRef = useRef<((e: TeachingEvent) => void) | null>(null);

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

  const captureImageArea = async (element: { type: string, content: string, x: number, y: number, width: number, height: number }, points: { x: number, y: number }[]) => {
    if (element.type !== 'image' || !element.content) return null;
    // 1. Calculate the bounding box of the painted path
    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));
    // 2. Calculate coordinates relative to the image element
    const localMinX = Math.max(0, minX - element.x);
    const localMinY = Math.max(0, minY - element.y);
    const localWidth = Math.min(element.width, maxX - minX);
    const localHeight = Math.min(element.height, maxY - minY);
    if (localWidth < 5 || localHeight < 5) return null;
    // 3. Setup canvas for extraction
    const canvas = document.createElement('canvas');
    const maxDim = 640; // Target resolution
    const scale = Math.min(1, maxDim / Math.max(localWidth, localHeight));
    canvas.width = localWidth * scale;
    canvas.height = localHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return new Promise<{ url: string, box: { x: number, y: number, width: number, height: number } }>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // Draw ONLY the selected portion of the image onto the canvas
        ctx.drawImage(
          img,
          (localMinX / element.width) * img.width, // Source X
          (localMinY / element.height) * img.height, // Source Y
          (localWidth / element.width) * img.width, // Source Width
          (localHeight / element.height) * img.height,// Source Height
          0, 0, canvas.width, canvas.height // Destination
        );
        resolve({
          url: canvas.toDataURL('image/jpeg', 0.8),
          box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
        });
      };
      img.src = element.content;
    });
  };

  useEffect(() => {
    const updateLayout = () => {
      const main = mainContainerRef.current;
      if (!main) return;
      const mainRect = main.getBoundingClientRect();
      
      const photosEl = main.querySelector('.photos-box');
      const mapEl = main.querySelector('.map-box');
      
      if (photosEl && mapEl) {
        const pRect = photosEl.getBoundingClientRect();
        const mRect = mapEl.getBoundingClientRect();
        
        setMainSize({ width: mainRect.width, height: mainRect.height });
        
        const toBBox = (r: DOMRect) => ({
          ymin: ((r.top - mainRect.top) / mainRect.height) * 1000,
          xmin: ((r.left - mainRect.left) / mainRect.width) * 1000,
          ymax: ((r.bottom - mainRect.top) / mainRect.height) * 1000,
          xmax: ((r.right - mainRect.left) / mainRect.width) * 1000,
        });
        
        // Generic element contract: anything with data-element-id is a measurable scene
        // element (tiles today, surface controls after the surface migration).
        const photoItems = Array.from(photosEl.querySelectorAll<HTMLElement>('[data-element-id]')).map((el: HTMLElement) => {
          const id = Number(el.dataset.elementId);
          return Number.isFinite(id) ? { id, bbox: toBBox(el.getBoundingClientRect()) } : null;
        }).filter(Boolean) as { id: number; bbox: BBox }[];
        
        const ssEl = main.querySelector('.spreadsheet-box');
        setLayoutBounds({
          photos: toBBox(pRect),
          map: toBBox(mRect),
          photoItems,
          spreadsheet: ssEl ? toBBox((ssEl as HTMLElement).getBoundingClientRect()) : undefined,
        });

        // Update the scene entities for Gemini (single source of truth).
        const es = buildEntities(program, perceivedLabelsRef.current, {
          items: photoItems.map(it => ({ id: it.id, bbox: it.bbox })),
          map: toBBox(mRect),
        });
        setEntities(es);
        entitiesRef.current = es;

        // Notify AI of the new layout if session is active (core context — both backends).
        if (providerRef.current) {
          const layoutInfo = es.map(e => `${displayName(e)}: [${e.bbox.map(Math.round).join(', ')}]`).join('\n');
          providerRef.current.sendTextHint(`[SYSTEM UPDATE: The gallery photos have been rearranged and now overlap the Google Maps box. Here are their new coordinates (ymin, xmin, ymax, xmax):\n${layoutInfo}\nIMPORTANT: The photos are ON TOP of the map. If the user points at or circles an area that contains both a photo and the map, they are referring to the PHOTO. Use these to identify what the user is pointing at when they say "this" or "here". DO NOT RESPOND TO THIS UPDATE. STAY SILENT UNTIL THE USER SPEAKS.]`);
        }
      }
    };
    
    const observer = new ResizeObserver(updateLayout);
    if (mainContainerRef.current) observer.observe(mainContainerRef.current);
    
    // Also observe the photos and map boxes specifically in case they move independently
    const photosBox = document.querySelector('.photos-box');
    const mapBox = document.querySelector('.map-box');
    if (photosBox) observer.observe(photosBox);
    if (mapBox) observer.observe(mapBox);

    updateLayout();
    window.addEventListener('resize', updateLayout);
    window.addEventListener('scroll', updateLayout, true); // Capture scroll events that might shift layout
    
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('scroll', updateLayout, true);
    };
  }, [isLive, activeProgram, perceivedVersion]); // Recalculate when live starts, layout changes, program swaps, or perception lands

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


  const mapUrl = mapType === 'search' 
    ? `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`
    : `https://www.google.com/maps?saddr=${encodeURIComponent(directions?.origin || '')}&daddr=${encodeURIComponent(directions?.destination || '')}&output=embed`;

  const allTasksCompleted = completedTaskIds.length === TASKS.length;
  const isCongratulationsPage = currentTaskIndex === TASKS.length;
  const isCurrentTaskDone = !isCongratulationsPage ? completedTaskIds.includes(TASKS[currentTaskIndex].id) : true;

  // The active scenario is the single source of truth for "what the user should do now".
  const activeTask = isCongratulationsPage ? null : TASKS[currentTaskIndex];
  // The element this scenario wants the user to point at — highlighted in the gallery
  // (DOM) and pre-focused on the trace canvas during a live session.
  const focusTitle = activeTask?.targetElement;
  useEffect(() => { focusTitleRef.current = focusTitle; }, [focusTitle]);

  // Robust scenario switching: any task change (or program swap) is a deliberate context
  // switch, so clear transient interaction state — markers, paint, and any pending action —
  // so the new scenario starts from a clean slate.
  useEffect(() => {
    markersRef.current = [];
    lastMarkerTimeRef.current = {};
    setPersistentPaths([]);
    setPendingAction(null);
  }, [currentTaskIndex, activeProgram]);

  // Bounds safety: if the program's task count shrinks below the current index, snap back.
  useEffect(() => {
    if (currentTaskIndex > TASKS.length) setCurrentTaskIndex(0);
  }, [TASKS.length, currentTaskIndex]);

  // Jump straight to a scenario (used by the scenario picker). Clamped + animated.
  const goToTask = (index: number) => {
    const maxIndex = allTasksCompleted ? TASKS.length : Math.max(0, TASKS.length - 1);
    const clamped = Math.max(0, Math.min(index, maxIndex));
    setSlideDirection(clamped >= currentTaskIndex ? 1 : -1);
    setCurrentTaskIndex(clamped);
  };

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = INITIAL_IMAGE + "?t=" + Date.now();
    img.onload = () => {
      // Force square dimensions
      const w = BASE_SIZE;
      const h = BASE_SIZE;
      setDims({ width: w, height: h });

      const pCanvas = persistentCanvasRef.current;
      if (!pCanvas) return;
      pCanvas.width = w;
      pCanvas.height = h;
      const ctx = pCanvas.getContext('2d');
      if (!ctx) return;
      
      // Draw the image to fill the square canvas by cropping to center
      const imgAspect = img.naturalWidth / img.naturalHeight;
      let sx, sy, sWidth, sHeight;
      if (imgAspect > 1) {
        // Landscape: crop sides
        sHeight = img.naturalHeight;
        sWidth = img.naturalHeight;
        sx = (img.naturalWidth - sWidth) / 2;
        sy = 0;
      } else {
        // Portrait: crop top/bottom
        sWidth = img.naturalWidth;
        sHeight = img.naturalWidth;
        sx = 0;
        sy = (img.naturalHeight - sHeight) / 2;
      }
      
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, w, h);
      setCurrentImage(pCanvas.toDataURL('image/png'));
    };
  }, []);

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

    // Don't let markers be placed on the Google Maps view
    // Use find() instead of some() to respect Z-order (photos are on top of map)
    const topObject = entitiesRef.current.find(e => {
      const [ymin, xmin, ymax, xmax] = e.bbox;
      return finalX >= xmin && finalX <= xmax && finalY >= ymin && finalY <= ymax;
    });

    const isOnMap = topObject?.category === 'map';
    
    if (isOnMap) {
      if (!isIdentification && providerRef.current) {
        providerRef.current.sendTextHint("[SYSTEM: The user tried to point at the map. Tell them: 'That's the map, try pointing at the camera roll instead'.]");
      }
      return;
    }

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

  const getClosestAspectRatio = () => {
    const ratio = dims.width / dims.height;
    const targets = [
      { label: "1:1", val: 1 },
      { label: "4:3", val: 4/3 },
      { label: "3:4", val: 3/4 },
      { label: "16:9", val: 16/9 },
      { label: "9:16", val: 9/16 }
    ];
    return targets.reduce((prev, curr) => 
      Math.abs(curr.val - ratio) < Math.abs(prev.val - ratio) ? curr : prev
    ).label;
  };

  const executeImageEdit = async (editPrompt: string, bbox: BBox, marker?: { x: number, y: number }, dest?: { x: number, y: number }, objectName?: string) => {
    setIsProcessing(true);
    isProcessingRef.current = true;

    setPendingEdit(null); // Clear immediately so we don't overwrite new commands that arrive during processing
    hasPendingEditRef.current = false;
    
    // Cleanup the prompt to remove any technical coordinates Gemini might have included
    const cleanEditPrompt = editPrompt
      .replace(/\[\d+\s*,\s*\d+\]/g, "")
      .replace(/\[\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    lastExecutedPromptRef.current = cleanEditPrompt;
    addLog('gemini', `Editing: ${cleanEditPrompt}`);
    
    // Notify the AI that we are starting the generation (provider-agnostic so Azure/OpenAI
    // get the same context Gemini does, not just the raw Gemini session).
    providerRef.current?.sendTextHint(`[SYSTEM: Starting image generation for "${cleanEditPrompt}". Please wait for the result before giving further instructions.]`);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const pCanvas = persistentCanvasRef.current;
      if (!pCanvas) return;
      
      const currentPixelsBase64 = pCanvas.toDataURL('image/png').split(',')[1];

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { data: currentPixelsBase64, mimeType: 'image/png' } },
            { text: `IMAGE EDITING TASK:
Modify the provided image according to this instruction: "${cleanEditPrompt}".
CRITICAL - NO NUMBERS OR TEXT IN IMAGE:
- DO NOT DRAW ANY NUMBERS.
- DO NOT DRAW ANY COORDINATES.
- DO NOT DRAW ANY TEXT, LABELS, OR CAPTIONS.
- DO NOT DRAW ANY BOUNDING BOXES OR UI ELEMENTS.
- The output MUST be a clean, natural image. Any technical annotations will result in a failure.

The target is located at: [${bbox.ymin}, ${bbox.xmin}, ${bbox.ymax}, ${bbox.xmax}].

CRITICAL - CLEAN SLATE:
- This is a NEW request. Ignore all previous instructions, previous object locations, or previous edits.
- The image provided is the CURRENT and ONLY source of truth.

${marker ? `TARGET LOCATION: The operation should be centered exactly at the location indicated by the spatial analysis.` : ''}
${spatialDescriptionRef.current ? `AGENT 1 SPATIAL ANALYSIS: ${spatialDescriptionRef.current}` : ''}

OPERATION TYPE:
- If the instruction is to "ADD" or "PUT" something new (e.g., "add a tree"), draw the new object at the TARGET LOCATION.
- If the instruction is to "CHANGE" or "MODIFY" an existing object (e.g., "make it blue"), modify the object already at the TARGET LOCATION.

${dest ? `MOVE OPERATION: You MUST move the object from the SOURCE to the DESTINATION.
- STEP 1: ERASE the object from the SOURCE LOCATION [${Math.round(marker!.x)}, ${Math.round(marker!.y)}] and fill the area with the natural background.
- STEP 2: DRAW the object at the DESTINATION LOCATION [${Math.round(dest.x)}, ${Math.round(dest.y)}]. The object's logical center MUST be placed exactly at these coordinates.
${(dest.x >= 584 && dest.y >= 866) ? '- NOTE: This destination is in the bottom right area of the image. Ensure the object is placed precisely at the provided coordinates.' : ''}
- RESULT: The object MUST NOT exist at the source location in the final image. It must appear at the destination and ONLY at the destination. No ghosts, no duplicates, no approximations.
- SURGICAL PRECISION: This is a relocation task. The background at the destination must be modified to accommodate the object, and the background at the source must be restored to its natural state.` : ''}

CRITICAL - NO VISUAL OVERLAYS:
- ABSOLUTELY NO NUMBERS: Do not draw any numbers (like [850, 250]) on the image.
- ABSOLUTELY NO BOXES: Do not draw any bounding boxes or outlines.
- ABSOLUTELY NO TEXT: Do not draw any labels, captions, or text.
- ABSOLUTELY NO UI: Do not draw any crosshairs, markers, or interface elements.
- The coordinates provided in this prompt are for your INTERNAL MATH ONLY. If they appear in the final pixels, you have FAILED.

CRITICAL - NO EXTRA OBJECTS:
- ONLY the requested change should occur.
- Do NOT add background items, extra characters, decorations, or any objects not explicitly mentioned in the instruction.
- If the instruction is "move the crab", ONLY the crab should move. Do not add a shell, a rock, or another crab.
- NO CLONING: Unless the user explicitly says "copy", "clone", or "duplicate", you MUST NOT create a second instance of an object. A "move" request is a relocation, not a duplication.
- Keep the background (sand, sky, water) 100% identical to the input.

CRITICAL CONSTRAINTS - ABSOLUTELY NO ZOOMING OR CROPPING:
1. ZERO ZOOM: The scale of the entire scene must remain 100% identical. Do not move the camera closer.
2. ZERO CROP: The output image must contain the exact same boundaries as the input.
3. PIXEL-PERFECT ALIGNMENT: If the input and output were overlaid, every pixel outside the modified area must align perfectly.
4. NO RE-CENTERING: Do not center the image on the modified object. Keep the original composition.
5. NO RE-SCALING: The output resolution and aspect ratio must be a 1:1 match to the input.
6. FIXED CAMERA: Imagine the camera is on a tripod and cannot move. Only the object at the specified locations changes.
7. SURGICAL EDIT: ONLY modify the specific object at the provided location. If there are other similar objects in the scene (e.g., other starfish), they MUST remain in their original colors and positions. Do not apply the change to the whole class of objects, only the individual instance pointed at.
8. IN-PLACE REPLACEMENT: You MUST replace the existing pixels of the object at the specified location. Do not add a new object nearby; instead, transform the existing one. The original object at those coordinates MUST be gone, replaced by the new version described in the prompt.
9. DELETION: If the user asks to remove something, you must fill the area with the background that would naturally be behind it. Do not leave artifacts or "ghosts" of the original object.
10. NO DUPLICATION: Never leave the original object in place while adding a new one. The edit must be a replacement, not an addition. If moving an object, it MUST be completely erased from the source location.
11. NO GHOSTING: Ensure the original object is completely removed from its original position. There should be no "ghost", faint outline, or artifact of the old object remaining. The source area must be seamlessly filled with background pixels.
12. NO OVERLAP: The new version of the object must occupy the same spatial volume as the old one. Do not place the new object next to the old one. It must be a direct pixel-for-pixel replacement where possible.
13. NO NEW OBJECTS: Do not add any objects that were not explicitly requested. If the instruction is to "move" or "change" something, only that specific instance should be affected. Do not add background elements, extra characters, or random items.
14. NO BACKGROUND DRIFT: The background textures, colors, and patterns must remain identical. Do not "re-imagine" the sand, sky, or water. Keep them exactly as they are in the input.
15. STARFISH ISOLATION: There are multiple starfish in the scene. You MUST ONLY change the one at the specified location.
16. ZERO TECHNICAL OVERLAYS: ABSOLUTELY NO numbers, bounding boxes, labels, text, or UI elements. The output must be a clean, natural-looking image. If you include any text or numbers from the prompt in the image, you have FAILED the task.
17. DESTINATION ACCURACY: When moving an object to [${dest ? `${Math.round(dest.x)}, ${Math.round(dest.y)}` : 'N/A'}], ensure the object is placed precisely at those coordinates. Do not approximate.
18. SOURCE CLEANUP: When moving an object, the source area [${marker ? `${Math.round(marker.x)}, ${Math.round(marker.y)}` : 'N/A'}] MUST be filled with background. No trace of the object should remain at the source.
19. PURE IMAGE OUTPUT: The final result must be a photographic/artistic image with NO annotations. Any coordinate numbers or boxes appearing in the image will result in a total failure of the task.
20. SINGLE INSTANCE RULE: You are moving the EXACT object identified at the source. Do not create a new version of it while leaving the old one. The object must disappear from point A and appear at point B. No exceptions. Any duplication is a failure.
21. NO HALLUCINATED ADDITIONS: Do not add any items that were not in the original image or explicitly requested. If you move a snowman, do not add a scarf if it didn't have one.
22. TOTAL ISOLATION: Imagine the object is in a vacuum. Only that object is affected. Every other object in the scene (the sun, the clouds, the other monsters, the snowman, etc.) must remain in their exact same pixels. If you move the crab, the snowman must not even shift by a single pixel. Any change to an unrequested object is a failure.
23. DEFAULT MOVE BEHAVIOR: Unless the user explicitly uses words like "copy", "clone", "duplicate", or "add another", any request to change an object's location MUST result in its removal from the original source coordinates. Relocation is the default; duplication is the exception.
24. OBJECT RELOCATION: When moving an object, ensure it is placed exactly at the specified destination coordinates. Do not approximate or move it to a different area than requested.` }
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: getClosestAspectRatio() as any
          },
          systemInstruction: "You are a surgical, non-destructive image editor. Your ONLY job is to apply a local modification while keeping the rest of the image 100% identical. You NEVER duplicate or clone objects unless explicitly asked to 'copy' or 'duplicate'. A 'move' command ALWAYS implies erasing the source and drawing at the destination. You NEVER add numbers, boxes, labels, text, or UI elements to the image. ABSOLUTELY NO COORDINATES OR NUMBERS SHOULD BE RENDERED IN THE OUTPUT. You NEVER add extra objects or decorations. You NEVER crop, NEVER zoom, and NEVER change the camera perspective. You always return the full, original scene with pixel-perfect consistency for all areas outside the target modification. Every unrequested object in the scene must remain in its exact original pixel state. Any text or numbers in the output image is a critical failure."
        }
      });

      const newImgPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      const newImgData = newImgPart?.inlineData?.data;

      if (newImgData) {
        const img = new Image();
        img.onload = () => {
          const ctx = pCanvas.getContext('2d');
          if (ctx) {
            // Save current state to history before updating
            const currentImgData = pCanvas.toDataURL('image/png');
            setHistory(prev => [...prev, { image: currentImgData, objects: [...entities] }]);

            ctx.clearRect(0, 0, dims.width, dims.height);
            ctx.drawImage(img, 0, 0, dims.width, dims.height);
            setCurrentImage(pCanvas.toDataURL('image/png'));
            addLog('gemini', 'Canvas evolved.');
            
            // UPDATE MARKING COORDINATES IF MOVED OR REMOVED
            if (marker && objectName) {
              const lowerPrompt = editPrompt.toLowerCase();
              const isRemoval = lowerPrompt.includes("remove") || lowerPrompt.includes("delete") || lowerPrompt.includes("erase");
              
              if (isRemoval) {
                setEntities(prev => prev.filter(e => e.title !== objectName));
                addLog('info', `Removed "${objectName}" from spatial map.`);
              } else if (dest) {
                setEntities(prev => prev.map(e => {
                  if (e.title === objectName) {
                    const dx = dest.x - marker.x;
                    const dy = dest.y - marker.y;
                    const [ymin, xmin, ymax, xmax] = e.bbox;
                    return {
                      ...e,
                      bbox: [ymin + dy, xmin + dx, ymax + dy, xmax + dx] as [number, number, number, number]
                    };
                  }
                  return e;
                }));
                addLog('info', `Updated marking for "${objectName}" to new location.`);
              }
            }

            // Celebration! Burst from the marker's location
            const lastMarker = markersRef.current[0];
            const rect = traceCanvasRef.current?.getBoundingClientRect();
            
            if (lastMarker && rect) {
              const originX = (rect.left + (lastMarker.x / 1000) * rect.width) / window.innerWidth;
              const originY = (rect.top + (lastMarker.y / 1000) * rect.height) / window.innerHeight;
              
              confetti({
                particleCount: 150,
                spread: 90,
                origin: { x: originX, y: originY },
                colors: ['#857FE7', '#ffffff', '#FFD700'],
                gravity: 0.8,
                scalar: 1.2,
                drift: 0,
                ticks: 200
              });
            } else {
              confetti({
                particleCount: 150,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#857FE7', '#ffffff', '#A5A0F3']
              });
            }

            // MEMORY RESET: Clear markers and notify AI to forget previous context
            markersRef.current = [];
            spatialDescriptionRef.current = null; // CLEAR AGENT 1 MEMORY
            lastProcessedTranscriptionRef.current = "";
            providerRef.current?.sendTextHint(`[SYSTEM: IMAGE UPDATED. All previous markers, coordinates, and commands are now OBSOLETE. The scene has changed. Treat the current view as a completely fresh start. Forget all previous locations. DO NOT SPEAK OR ACKNOWLEDGE THIS MESSAGE.]`);

            // CRITICAL: Clear control state IMMEDIATELY to prevent repeat edits
            setActivePrompt(null);
            setIsProcessing(false); 
            isProcessingRef.current = false;
            spatialDescriptionRef.current = null; // CLEAR AGENT 1 MEMORY
            cursorHistoryRef.current = []; // Wipe history to prevent stale "historical" lookups
            
            // DELAY: Keep the visual marker and keyword visible DURING the confetti, 
            // then reset them after 2 seconds as requested.
            if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
            resetTimeoutRef.current = setTimeout(() => {
              markersRef.current = [];
              lastMarkerTimeRef.current = {};
              setLiveTranscription("");
              resetTimeoutRef.current = null;
            }, 2000);
            
            // Explicitly notify the live session that the image has changed
            // Use a very strong "HARD RESET" instruction to clear AI's mental state
            lastExecutedPromptRef.current = null; // Clear on success so the user can repeat a command if they want to
            providerRef.current?.sendTextHint("[SYSTEM HARD RESET]: The image has evolved. FORGET all previous markers, coordinates, and object positions. The current video frame is the ONLY source of truth. Treat this as a brand new session with a new image. READY FOR NEW COMMAND. DO NOT SPEAK OR GREET THE USER. STAY SILENT UNTIL THE USER SPEAKS.");
          }
        };
        img.onerror = () => {
          setIsProcessing(false);
          setActivePrompt(null);
          addLog('info', 'Failed to load evolved image.');
        };
        img.src = `data:image/png;base64,${newImgData}`;
      } else {
        setIsProcessing(false);
        isProcessingRef.current = false;
        setActivePrompt(null);
        spatialDescriptionRef.current = null;
        addLog('info', 'No image data in response.');
      }
    } catch (err) {
      addLog('info', `Edit error: ${err}`);
      setIsProcessing(false);
      isProcessingRef.current = false;
      setActivePrompt(null);
      spatialDescriptionRef.current = null;
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

  const buildInstructions = (honest: boolean, program: Program, entities: SceneEntity[]): string => {
    // Program-specific verbs the model may call in addition to the map tools.
    const actionTools = buildActionTools(program.id);
    const ACTIONS_SECTION = actionTools.length ? `

${program.label.toUpperCase()} ACTIONS (in addition to the map tools above):
${actionTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}
- Every action verb takes (target, detail, confirm). These are HIGH-COMMITMENT — they change the document. ${honest
  ? 'WITNESS-RENDER your interpretation first: state WHAT you will do and WHERE (e.g. "Make the document body bold?") and WAIT for an explicit "yes". Only then call again with confirm=true. Never mutate the document on a low-confidence or unconfirmed guess.'
  : 'Call the verb with confirm=true and do it immediately.'}
- GROUNDING CHECK: if a tool response comes back with "grounding_mismatch": true, your read of the element disagreed with where the user is actually pointing (app_referent). Do NOT proceed — ask which one they mean, e.g. "You're pointing at the {app_referent}, but I thought you meant the {model_target} — which should I use?", then act on their answer.
- The result appears in the on-screen preview panel.` : '';

    // The confident baseline: the hint is treated as ground truth (preserved unchanged).
    const POINTING_TRUTH_CONFIDENT = `- The hints are the ABSOLUTE SOURCE OF TRUTH. If it says "London Eye", the user IS pointing at the London Eye.`;
    // The honest variant (Diffs 2 + 3). Honesty scales with the situation along two axes:
    // CONFIDENCE (how sure the hint is) and COMMITMENT (how consequential the verb is).
    const POINTING_TRUTH_HONEST = `- The hints now carry a CONFIDENCE, e.g. "(confidence: high)" or "(confidence: low — could also be King's Cross)". Treat confidence as a first-class signal, NOT as absolute truth.
- HIGH CONFIDENCE + a low-stakes "locate" request ("show me this", "where is this", "hotels near here"): act EXACTLY as you would normally — call update_map immediately with one short confirmation ("Here's the London Eye"). Do NOT ask, do NOT hedge. Being sure means staying fluid; asking when you already know is annoying.
- LOW CONFIDENCE, or a hint that lists multiple candidates: do NOT call any tool yet. Ask ONE short disambiguating question in your tour-guide voice — e.g. "I think that's St Pancras — or did you mean King's Cross next door?" — then act on the user's answer. Never silently pick one of two plausible candidates.
- HONEST UNCERTAINTY is a valid, first-class answer. You MAY say "I'm not certain which photo you mean" or "I think this is X, but I'm not sure." If the hint says "Nothing (Empty Space)" or you genuinely cannot tell what is being pointed at, give a brief honest shrug — "I'm not sure what you're pointing at — could you point again?" — and do NOT invent a landmark.
- GRICEAN QUALITY (do not assert what you are unsure of): when confidence is low, HEDGE — say "I think that's St Pancras" rather than the flat assertion "Here's St Pancras."
- COMMITMENT scales the friction, not just confidence. "show_directions" is HIGH-COMMITMENT — it sends the user walking — so before you call it, WITNESS-RENDER your interpretation: state BOTH resolved endpoints and get a quick confirm ("From Westminster to Hyde Park?") even when you are reasonably confident. If either endpoint is low-confidence, fold the disambiguation into that same question. Low-commitment "locate" requests do NOT get this gate — gating them would be nagging.`;

    // Deeper-inference + proactivity rules, per mode.
    const CONFIDENT_VERB_RULES = `DEEPER REQUESTS:
- If the user sweeps across photos and asks to "plan a day" or "plan a trip from these", call synthesize(places, confirm=true) and build the itinerary right away.
- If the user asks to "share this with <name>", call share(recipient, payload, confirm=true) and send it.`;
    const HONEST_VERB_RULES = `DEEPER REQUESTS (honest — inference scales the verification loop UPSTREAM):
- "Plan a day from these": call synthesize(places) WITHOUT confirm to PROPOSE an ordered itinerary as a hypothesis. Speak it briefly — e.g. "Rough order: Westminster, then the London Eye, then Hyde Park — about 5 hours. Want me to build it?" — then STOP. The proposal IS the answer. Only after the user explicitly says yes, call synthesize(places, confirm=true) to build. A synthesized plan is unverifiable until built, so confirm the PLAN before spending the work, because the inference is the part most likely to be wrong.
- NEVER build or commit a plan unprompted.
- PROACTIVE OFFERS: you normally stay silent until spoken to. The ONE exception: if you receive a [SYSTEM: TRIP PATTERN ...] message, you MAY make a single transparent offer that states your reasoning — e.g. "Looks like you're planning a London trip — want me to pull these into an itinerary?" — then STOP and wait. Notice → hypothesize transparently → ASK. Never act on an inferred intention without an explicit yes. Make this offer at most once.
- OUTWARD ACTIONS are the highest commitment of all — they act on another person and can't be taken back. For "share this with <name>", call share(recipient, payload) WITHOUT confirm first to witness-render exactly WHO and WHAT goes out — "Send the London day plan to Lia?" — and wait. Only after an explicit yes, call share(recipient, payload, confirm=true). Never send to a person without showing the recipient and payload first.`;

    return `You are a point-and-speak assistant. The user is working in ${program.label}; you help them operate it by pointing and speaking, and you can also pull up a London map when they ask. Act on what they point at and explicitly ask for.
CRITICAL: You MUST remain completely silent unless the user has explicitly spoken to you with a clear command or question. Do not initiate conversation, do not greet the user, and do not speak if there is only background noise or silence.
Wait for the user to finish their instructions before responding. 
CRITICAL: Do NOT repeat yourself or say the same sentence twice in a row. If you just said something, do not say it again immediately.
Only speak after being asked to do something. Do not provide intros or ask if there's anything else you can help with.

CRITICAL - CONFIRMATION POLICY (read first):
- DO NOT verbally confirm or narrate successful actions. The APP signals success to the user (a sound + an on-screen cue) — your voice is NOT the confirmation channel.
- After you call a tool and it succeeds, STAY SILENT. Do not say "Here's...", "Done", "Okay", or describe what you did.
- Speak ONLY to: (a) ask a clarifying/disambiguating question, (b) honestly hedge when you are genuinely unsure, or (c) report a problem/error. In those cases, one short sentence.
- This means most successful turns produce a tool call and NO speech. That is correct and intended.

CRITICAL - RESPONSE STYLE:
- ALWAYS respond in the same language the user uses. If the user speaks in English, you MUST respond in English.
- Keep any verbal responses (questions, hedges, errors) extremely short and direct.
- Avoid filler words like "Perfect", "Sure", "Okay", or "I'm showing you".
- Be concise. One short sentence is the maximum.

CRITICAL - ACTION LOGIC:
- NEVER perform any actions (like updating the map or showing directions) based on just pointing or hovering.
- You MUST wait for an explicit verbal command (e.g., "show me this", "how do I get here", "what is this?", "search for hotels near here") before calling any tools.
- If the user just says a landmark name (e.g., "London Eye") without a command, STAY SILENT. Do not confirm, do not update the map.
- Pointing is ONLY context for when the user speaks.
- If the user is just moving their cursor without speaking, stay silent.
- Once you understand the command, call the tool immediately.
- NEVER proactively update the map or suggest locations. ONLY update the map when the user EXPLICITLY asks you to.
- CRITICAL: Whenever you act, you MUST call the corresponding tool ('update_map'/'show_directions'/an action verb). Never just say you are doing something without the tool call — and per the CONFIRMATION POLICY, do not narrate the success at all; just call the tool.

The user is looking at a gallery of ${program.label} screenshots on the left and a Google Map on the right.

MARKERS (Visual Anchors):
- When the user circles an item, a marker labeled M1, M2, etc., is placed at that location.
- These markers are visible in your video feed as gold circles with labels.
- Use these markers to identify specific locations the user is referring to (e.g., "from M1 to M2").
- Markers are persistent until the map is updated or the AI responds.
- CRITICAL: When a new request starts, ignore all previous markers and landmarks. ALWAYS use the most recent visual information and pointing hints.

ON-SCREEN ELEMENTS (the user points at these — use these names exactly):
${entities.length
  ? entities.filter(e => e.category !== 'map').map(e => `- ${displayName(e)}`).join('\n')
  : program.images.map(img => `- ${img.title}`).join('\n')}

USER CAPABILITIES:
1. Point at a photo and ask "show me this on a map". You MUST identify which photo they are pointing at and call update_map(location_name).
2. Point at two photos (e.g., "from here to there") and ask for directions. You MUST track the sequence of pointing and call show_directions(origin, destination).
3. Point at a location (photo or map) and ask for nearby places (e.g., "hotels near here"). You MUST call update_map(query) with a query like "hotels near [Location Name]" or "hotels near [Current Map View]".
4. Point at a photo and ask "what is this?" / "what am I looking at?". This is an IDENTIFICATION request — call explain(subject) and answer verbally by naming the landmark. Do NOT change the map for this.
5. Sweep across several photos and ask to "plan a day" / "plan a trip from these". This is a SYNTHESIS request — call synthesize(places). See DEEPER REQUESTS below for how to handle it.
6. Ask to "share this with <name>". This is an OUTWARD request — call share(recipient, payload). See DEEPER REQUESTS below for how to handle it.

CRITICAL - POINTING LOGIC:
- You will receive hints in the format: [USER JUST SAID "THIS" WHILE POINTING AT: Landmark Name].
- When the user says "this", "here", "that", or "there", they are ALWAYS referring to the landmark mentioned in the [USER JUST SAID ...] message that arrived MOST RECENTLY BEFORE or DURING that specific word.
- If the user is pointing at the map, they are referring to the area currently shown on the map (e.g., "hotels near here" means hotels near the current map view).
${honest ? POINTING_TRUTH_HONEST : POINTING_TRUTH_CONFIDENT}
- CRITICAL: For directions "from here to there", "here" is the landmark from the hint preceding "here", and "there" is the landmark from the hint preceding "there".
- ALWAYS ignore landmarks from previous requests. Each time the user speaks a new command, start fresh with the pointing hints. Do NOT reuse locations from previous direction requests unless the user explicitly asks to "go back" or "use the same start".
- If the hint says "Nothing (Empty Space)", ask the user to point at a photo.
- Listen carefully to the user's full request and ensure you understand their complete intent before calling any tools. For example, if they are describing a trip, wait until they specify a location they want to see on the map.
- Once the intent is clear, call the tools to act. Do not just talk about it — and per the CONFIRMATION POLICY, do not narrate it either; just call the tool and stay silent on success.
- Always perform the action by CALLING THE TOOL; never merely say you are doing something without the tool call.
- CRITICAL: After you receive a tool response (success: true), do NOT speak. The app has already confirmed it to the user.
- If the user asks for directions, ensure you have both an origin and a destination.
- DO NOT REPEAT YOURSELF.

${honest ? HONEST_VERB_RULES : CONFIDENT_VERB_RULES}
${ACTIONS_SECTION}

COORDINATE SYSTEM:
- The entire view is 1000x1000.
- Photos are on the left side.
- The map is on the right side.
- You will receive spatial information about the photos in the interactive objects list.

When the user points and speaks a command, call the appropriate tool — a map tool to show a place, or a ${program.label} action verb to act on the document — and STAY SILENT on success (the app confirms). Speak only to ask, hedge, or report an error.`;
  };

  const handleVoiceToolCall = (call: { id: string; name: string; args: any }) => {
    const fc = { id: call.id, name: call.name, args: call.args };
    // G9 IDEMPOTENCY: drop a duplicate tool call the model re-emitted within the window (a
    // known agent failure mode — e.g. replaying a chain). Ack it so the model doesn't hang.
    if (callDeduperRef.current.seen(fc.name, argsKey(fc.args), Date.now())) {
      addLog('info', `Duplicate tool call skipped: ${fc.name}`);
      providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, deduped: true });
      return;
    }
    if (fc.name === 'update_map') {
      const args = fc.args as any;
      let query = args.query;
      // Append London to known locations for better search accuracy
      const knownLocations = ["London Eye", "Hyde Park", "Westminster Abbey", "St Pancras Station"];
      if (knownLocations.some(loc => query.toLowerCase().includes(loc.toLowerCase()))) {
        if (!query.toLowerCase().includes("london")) {
          query += ", London";
        }
      }

      addLog('tool', `Tool Call: update_map(${query}) - Queued for silence`);

      setPendingMapUpdate({
        type: 'search',
        query,
        id: fc.id,
        name: fc.name,
        receivedAt: Date.now()
      });
    } else if (fc.name === 'show_directions') {
      const args = fc.args as any;
      let origin = args.origin;
      let destination = args.destination;
      const knownLocations = ["London Eye", "Hyde Park", "Westminster Abbey", "St Pancras Station"];

      if (knownLocations.some(loc => origin.toLowerCase().includes(loc.toLowerCase())) && !origin.toLowerCase().includes("london")) {
        origin += ", London";
      }
      if (knownLocations.some(loc => destination.toLowerCase().includes(loc.toLowerCase())) && !destination.toLowerCase().includes("london")) {
        destination += ", London";
      }

      addLog('tool', `Tool Call: show_directions(${origin} to ${destination}) - Queued for silence`);

      setPendingMapUpdate({
        type: 'directions',
        origin,
        destination,
        id: fc.id,
        name: fc.name,
        receivedAt: Date.now()
      });
    } else if (fc.name === 'explain') {
      // PHASE D: low-commitment, verbal-only. No map mutation. Ack immediately so the
      // model keeps speaking; the honest hedging lives in the prompt + the spoken answer.
      const args = fc.args as any;
      addLog('tool', `Tool Call: explain(${args.subject ?? ''}) - verbal only, no map change`);
      providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true });
    } else if (fc.name === 'synthesize') {
      // PHASE E: propose -> confirm -> build. Without confirm, render the itinerary as a
      // hypothesis and DO NOT route. With confirm (after explicit user yes), build it.
      const args = fc.args as any;
      const places: string[] = Array.isArray(args.places) ? args.places.filter((p: any) => typeof p === 'string') : [];
      const plan: string | undefined = typeof args.plan === 'string' ? args.plan : undefined;
      const confirmed = args.confirm === true;

      if (!confirmed) {
        addLog('tool', `Tool Call: synthesize(propose) - ${places.join(' → ')}`);
        setProposedItinerary({ places, plan });
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, proposed: true });
      } else {
        addLog('tool', `Tool Call: synthesize(build) - ${places.join(' → ')}`);
        const knownLocations = ["London Eye", "Hyde Park", "Westminster Abbey", "St Pancras Station"];
        const withCity = (p: string) =>
          knownLocations.some(loc => p.toLowerCase().includes(loc.toLowerCase())) && !p.toLowerCase().includes("london")
            ? `${p}, London` : p;
        if (places.length >= 2) {
          // Classic maps daddr supports a "to:" waypoint chain for the middle stops.
          const origin = withCity(places[0]);
          const destination = places.slice(1).map(withCity).join(' to: ');
          setMapType('directions');
          setDirections({ origin, destination });
        } else if (places.length === 1) {
          setMapType('search');
          setMapQuery(withCity(places[0]));
        }
        setProposedItinerary(null);
        markersRef.current = [];
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, built: true });
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
        if (entry.hovered && entry.hovered !== MAP_ENTITY_ID) {
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
      if (!foundObject && index === totalKws - 1 && hoveredIdRef.current && hoveredIdRef.current !== MAP_ENTITY_ID) {
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

      // RESET SPATIAL DESCRIPTION IF NEW INTERACTION STARTS
      if (!isDestination) {
        spatialDescriptionRef.current = null;
      }

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
        if (foundObject.category !== 'map') referents.note(displayName(foundObject), 'pointed', foundObject.id);

        // PHASE F (S6): accumulate distinct real landmarks. In honest mode, once enough
        // have been pointed at with no plan yet, authorize the model to make ONE
        // transparent itinerary offer (notice → hypothesize → ask, never build).
        if (foundObject.category !== 'map') {
          identifiedLandmarksRef.current.add(displayName(foundObject));
        }
        if (
          honestModeRef.current &&
          !hasOfferedTripRef.current &&
          !proposedItinerary &&
          identifiedLandmarksRef.current.size >= 3 &&
          providerRef.current
        ) {
          hasOfferedTripRef.current = true;
          const tripPlaces = Array.from(identifiedLandmarksRef.current);
          addLog('event', `Trip pattern noticed: ${tripPlaces.join(', ')} — offering once`);
          providerRef.current?.sendTextHint(`[SYSTEM: TRIP PATTERN — the user has now pointed at ${tripPlaces.join(', ')} without asking for a plan. You MAY make ONE short, transparent offer that states your reasoning, e.g. "Looks like you're planning a London trip — want me to pull these into an itinerary?", then STOP and wait. Do NOT build anything yet.]`);
        }

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
          providerRef.current?.sendTextHint(`[USER JUST SAID "${kw.toUpperCase()}" WHILE POINTING AT: Nothing (Empty Space). Ask them to point at a photo or the map.]`);
        }
      }

      // AGENT 1: SPATIAL ANALYST REMOVED
      // (This was for image editing which is not used in this map/gallery app)
      if (isDestination) {
        spatialDescriptionRef.current = null;
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
      setTypedDraft("");
    } else {
      pendingTypedRef.current = text;
      setTypedDraft("");
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
    if (pendingTypedRef.current) {
      setTypedDraft(pendingTypedRef.current);
      pendingTypedRef.current = null;
    }
  };

  const startLiveSession = async () => {
    if (isLive) return; // Prevent multiple sessions
    lastTranscriptionTimeRef.current = 0;
    // PHASE F: fresh session → reset the trip-pattern tracking.
    identifiedLandmarksRef.current = new Set();
    hasOfferedTripRef.current = false;

    const apiKey = process.env.GEMINI_API_KEY;
    if (voiceBackendRef.current === 'gemini' && !apiKey) {
        abortPendingTyped();
        addLog('info', 'Missing GEMINI_API_KEY');
        console.error('Missing GEMINI_API_KEY');
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
            if (pendingTypedRef.current) { setTypedDraft(pendingTypedRef.current); pendingTypedRef.current = null; }
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
            if (showOnboardingRef.current || showWelcomeRef.current || showRotateOverlayRef.current || showMobileOverlayRef.current) return;
            if (lastTranscriptionTimeRef.current === 0) { addLog('info', 'Ignoring tool call before first transcription'); return; }
            handleVoiceToolCall(call);
          },
          onResponseStart: () => {
            if (showOnboardingRef.current || showWelcomeRef.current || showRotateOverlayRef.current || showMobileOverlayRef.current) return;
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

  // Auto-execute logic: Wait for silence after a command is detected
  useEffect(() => {
    if ((!pendingEdit && !pendingMapUpdate) || isProcessing) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const timeSinceTranscription = now - lastTranscriptionTimeRef.current;

      // Handle Image Edits (Evolving)
      if (pendingEdit) {
        const timeSinceReceived = now - pendingEdit.receivedAt;
        // Wait for 1.5s of silence for image edits (reduced from 2.5s)
        if (lastTranscriptionTimeRef.current > 0 && timeSinceTranscription > 1500 && timeSinceReceived > 1000) {
          setActivePrompt(pendingEdit.prompt);
          executeImageEdit(pendingEdit.prompt, pendingEdit.bbox, pendingEdit.marker, pendingEdit.destMarker, pendingEdit.objectName);
          providerRef.current?.sendToolResponse(pendingEdit.id, pendingEdit.name, { result: "ok" });
          setPendingEdit(null);
        }
      }

      // Handle Map Updates
      if (pendingMapUpdate) {
        const timeSinceReceived = now - pendingMapUpdate.receivedAt;
        // Snappier for maps: 600ms silence is enough to confirm command end
        if (lastTranscriptionTimeRef.current > 0 && timeSinceTranscription > 600 && timeSinceReceived > 300) {
          telemetry.map(pendingMapUpdate.query ?? `${pendingMapUpdate.origin}→${pendingMapUpdate.destination}`);
          if (pendingMapUpdate.type === 'search') {
            setMapType('search');
            setMapQuery(pendingMapUpdate.query!);
            emitFeedback({ outcome: 'committed', verbClass: 'control', label: `Showing ${pendingMapUpdate.query}` });
          } else {
            setMapType('directions');
            setDirections({ origin: pendingMapUpdate.origin!, destination: pendingMapUpdate.destination! });
            emitFeedback({ outcome: 'committed', verbClass: 'control', label: `Directions to ${pendingMapUpdate.destination}` });
          }

          // Clear markers and paint so the next "this" is fresh
          markersRef.current = [];
          lastMarkerTimeRef.current = {};
          setPersistentPaths([]);

          providerRef.current?.sendToolResponse(
            pendingMapUpdate.id,
            pendingMapUpdate.name,
            {
                success: true,
                query: pendingMapUpdate.query,
                origin: pendingMapUpdate.origin,
                destination: pendingMapUpdate.destination
              }
          );
          setPendingMapUpdate(null);
        }
      }
    }, 100);

    return () => clearInterval(timer);
  }, [pendingEdit, pendingMapUpdate, isProcessing]);

  // Keyboard Fallback
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!isLive) return;
      if (e.key === 't') addMarker("this");
      if (e.key === 'i') addMarker("it");
      if (e.key === 'h') addMarker("here");
      // G8: number keys 1–9 select a numbered target (pointer-free deixis).
      if (e.key >= '1' && e.key <= '9') selectTargetByNumber(Number(e.key));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isLive, activeProgram]);

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
  }, [dims, showMarkings, isLive]); // Re-run when dimensions, markings, or live state changes

  const handlePointerMove = React.useCallback((e: React.PointerEvent | PointerEvent) => {
    const rect = mainContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // Normalize coordinates relative to the entire main container (photos + map)
    const x = Math.max(0, Math.min(1000, ((e.clientX - rect.left) / rect.width) * 1000));
    const y = Math.max(0, Math.min(1000, ((e.clientY - rect.top) / rect.height) * 1000));
    
    const now = Date.now();
    const coords = { x, y };
    cursorRef.current = coords;
    setCurrentCoords(coords);
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
    const sub = hovered && hovered !== MAP_ENTITY_ID ? wordAt(hX, hY) : null;
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
      hovered && hovered !== MAP_ENTITY_ID &&
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
    
    if (isPainting && hovered !== MAP_ENTITY_ID) {
      setPointerPath(prev => [...prev, { x, y, timestamp: now }]);
    }
    
    // Increase history to 5 seconds to handle transcription latency better
    while (cursorHistoryRef.current.length > 0 && now - cursorHistoryRef.current[0].t > 5000) {
      cursorHistoryRef.current.shift();
    }
  }, [isPainting, mainSize]);
  
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isLive) return;
    
    // Re-verify what is being clicked to handle overlaps correctly
    const rect = mainContainerRef.current?.getBoundingClientRect();
    let isActuallyOnMap = hoveredIdRef.current === MAP_ENTITY_ID;

    if (rect) {
      const x = ((e.clientX - rect.left) / rect.width) * 1000;
      const y = ((e.clientY - rect.top) / rect.height) * 1000;
      const found = entitiesRef.current.find(e => {
        const [ymin, xmin, ymax, xmax] = e.bbox;
        return x >= xmin && x <= xmax && y >= ymin && y <= ymax;
      });
      isActuallyOnMap = found?.category === 'map';

      // TOUCH DEIXIS: touch has no hover — a tap is the point. Register the target at the
      // down position (cursor + hovered + history) so saying "this" right after a tap resolves,
      // even if no pointermove fired. (Mouse users already get this via hover; harmless there.)
      cursorRef.current = { x, y };
      const hovered = found ? found.id : null;
      setHoveredId(hovered);
      hoveredIdRef.current = hovered;
      cursorHistoryRef.current.push({ x, y, t: Date.now(), hovered });
    }

    if (isActuallyOnMap) {
      if (providerRef.current) {
        providerRef.current.sendTextHint("[SYSTEM: The user tried to interact with the map directly. Tell them: 'That's the map, try pointing at the camera roll instead'.]");
      }
      return;
    }
    setIsPainting(true);
    if (rect) {
      setTrailMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  };

  const handlePointerUp = React.useCallback(async () => {
    setIsPainting(false);

    // 1. Check if we have a path and are hovering an image
    if (pointerPath.length > 5 && hoveredIdRef.current) {
      // Add to persistent paths so it stays visible while speaking
      setPersistentPaths(prev => [...prev, pointerPath.map(p => ({ x: p.x, y: p.y }))]);

      const hoveredId = hoveredIdRef.current;
      const found = entityById(entitiesRef.current, hoveredId);

      if (found) {
        let content = currentImage;
        if (found.category !== 'map' && found.url) {
          content = found.url;
        }

        const element = {
          type: 'image',
          content,
          x: found.bbox[1],
          y: found.bbox[0],
          width: found.bbox[3] - found.bbox[1],
          height: found.bbox[2] - found.bbox[0]
        };

        // 2. Capture the area
        const result = await captureImageArea(element, pointerPath);
        
        if (result) {
          const { url: croppedUrl, box } = result;
          
          // Add a silent marker at the center of the circled area
          const centerX = box.x + box.width / 2;
          const centerY = box.y + box.height / 2;
          addMarker("", centerX, centerY);
          
          // Send a circle-gesture hint to whichever backend is live (core context).
          if (providerRef.current) {
            const markerIndex = markersRef.current.length; // Approximate index
            providerRef.current.sendTextHint(`[SYSTEM: User circled an area on ${displayName(found)} and a marker M${markerIndex} has been placed at [${Math.round(centerX)}, ${Math.round(centerY)}].]`);
          }

          // 3. Send the cropped circled region as an image turn. Gemini-only: this uses
          // sendClientContent (no provider-interface equivalent); OpenAI relies on the
          // sparse vision frames instead.
          if (sessionRef.current) {
            const [mime, data] = croppedUrl.split(',');
            const mimeType = mime.split(':')[1].split(';')[0];

            addLog('gemini', `Sending circled region of ${displayName(found)} to Gemini`);

            // Send the image as a "turn" in the conversation
            sessionRef.current.sendClientContent({
              turns: [{
                role: "user",
                parts: [
                  { text: `[SYSTEM] The user just circled this region on ${displayName(found)}. Focus on it.` },
                  { inlineData: { mimeType, data } }
                ]
              }],
              turnComplete: false // Do NOT trigger immediate response, wait for user to finish speaking
            });
          }
        }
      }
    }
    // Clear path after capture
    setPointerPath([]);
  }, [pointerPath, currentImage]);

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

  // CORS-loaded image cache for the vision frame (G1: real pixels, not a labeled schematic).
  // Only successfully CORS-clean images are drawn — anything that won't load clean stays a
  // labeled box, so the offscreen canvas never taints and toBlob keeps encoding.
  const visionImgCacheRef = useRef<Record<string, HTMLImageElement | 'failed' | 'loading'>>({});
  useEffect(() => {
    if (!isLive) return;
    for (const img of program.images) {
      if (visionImgCacheRef.current[img.url]) continue;
      visionImgCacheRef.current[img.url] = 'loading';
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => { visionImgCacheRef.current[img.url] = el; };
      el.onerror = () => { visionImgCacheRef.current[img.url] = 'failed'; };
      el.src = img.url;
    }
  }, [isLive, activeProgram]);

  // G3 OCR: when enabled during a live session, recognize words in each gallery screenshot
  // and tell the model the text content. Failures (offline / blocked model assets) are
  // logged and ignored — the app falls back to whole-tile pointing.
  useEffect(() => {
    if (!ocrEnabled || !isLive) return;
    let cancelled = false;
    addLog('info', 'OCR enabled — recognizing screenshot text…');
    for (const img of program.images) {
      ocrImage(img.url)
        .then(words => {
          if (cancelled) return;
          ocrWordsRef.current[img.title] = words;
          addLog('info', `OCR: ${img.title} — ${words.length} words`);
          if (words.length && providerRef.current) {
            const txt = words.map(w => w.text).slice(0, 40).join(' ');
            providerRef.current.sendTextHint(`[OCR: "${img.title}" contains the text: ${txt}. The user may point at individual words. DO NOT acknowledge this message.]`);
          }
        })
        .catch(err => { if (!cancelled) addLog('info', `OCR unavailable for ${img.title}: ${err?.message ?? err}`); });
    }
    return () => { cancelled = true; };
  }, [ocrEnabled, isLive, activeProgram]);

  // Real-perception: name each tile from its actual pixels once, cached by URL. Fail-soft —
  // any failure leaves the tile without a perceived label, so resolveTileName falls back to title.
  useEffect(() => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;
    const genai = new GoogleGenAI({ apiKey });
    let cancelled = false;
    (async () => {
      for (const photo of PHOTOS) {
        if (perceivedLabelsRef.current[photo.url]) continue; // perceive once per URL
        perceivedLabelsRef.current[photo.url] = { status: 'pending' };
        try {
          const { base64, mimeType } = await loadImageAsBase64(photo.url);
          if (cancelled) return;
          const label = await perceiveTileLabel(genai, base64, mimeType);
          if (cancelled) return;
          perceivedLabelsRef.current[photo.url] = label ? { status: 'done', label } : { status: 'failed' };
          if (label) addLog('info', `perceived "${label}" vs registered "${photo.title}"`);
        } catch (e: any) {
          if (cancelled) return;
          perceivedLabelsRef.current[photo.url] = { status: 'failed' };
          addLog('info', `perception failed for ${photo.title}: ${e?.message ?? e}`);
        }
        setPerceivedVersion((v) => v + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [PHOTOS]);

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

      // Draw Photos Box
      const p = layoutBounds.photos;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e5e5e5';
      ctx.lineWidth = 1;
      ctx.fillRect((p.xmin/1000)*VISION_SIZE, (p.ymin/1000)*VISION_SIZE, ((p.xmax-p.xmin)/1000)*VISION_SIZE, ((p.ymax-p.ymin)/1000)*VISION_SIZE);
      ctx.strokeRect((p.xmin/1000)*VISION_SIZE, (p.ymin/1000)*VISION_SIZE, ((p.xmax-p.xmin)/1000)*VISION_SIZE, ((p.ymax-p.ymin)/1000)*VISION_SIZE);

      // Draw Photo Items — REAL pixels when the CORS-clean image is loaded, else a labeled box.
      // On a transient snapshot failure, last-good canvas is retained intentionally; [SPREADSHEET DATA] text hint stays authoritative.
      const ssCanvas = spreadsheetSnapshotRef.current;
      if (activeProgram === 'excel' && ssCanvas) {
        const b = layoutBounds.spreadsheet ?? layoutBounds.photos;
        const dx = (b.xmin / 1000) * VISION_SIZE, dy = (b.ymin / 1000) * VISION_SIZE;
        const dw = ((b.xmax - b.xmin) / 1000) * VISION_SIZE, dh = ((b.ymax - b.ymin) / 1000) * VISION_SIZE;
        try { ctx.drawImage(ssCanvas, dx, dy, dw, dh); } catch { /* keep canvas clean */ }
        ctx.strokeStyle = '#e5e5e5';
        ctx.strokeRect(dx, dy, dw, dh);
      } else {
        layoutBounds.photoItems.forEach((item, i) => {
          const b = item.bbox;
          const dx = (b.xmin/1000)*VISION_SIZE, dy = (b.ymin/1000)*VISION_SIZE;
          const dw = ((b.xmax-b.xmin)/1000)*VISION_SIZE, dh = ((b.ymax-b.ymin)/1000)*VISION_SIZE;
          const cached = visionImgCacheRef.current[PHOTOS[i]?.url ?? ''];
          if (cached && cached !== 'failed' && cached !== 'loading') {
            try { ctx.drawImage(cached, dx, dy, dw, dh); } catch { /* keep canvas clean */ }
            ctx.strokeStyle = '#e5e5e5';
            ctx.strokeRect(dx, dy, dw, dh);
          } else {
            ctx.fillStyle = '#f1f5f9';
            ctx.fillRect(dx, dy, dw, dh);
            ctx.strokeRect(dx, dy, dw, dh);
            ctx.fillStyle = '#64748b';
            ctx.font = 'bold 8px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(PHOTOS[i].title, dx + dw / 2, dy + dh / 2);
          }
        });
      }

      // Draw Map Box
      const m = layoutBounds.map;
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect((m.xmin/1000)*VISION_SIZE, (m.ymin/1000)*VISION_SIZE, ((m.xmax-m.xmin)/1000)*VISION_SIZE, ((m.ymax-m.ymin)/1000)*VISION_SIZE);
      ctx.strokeRect((m.xmin/1000)*VISION_SIZE, (m.ymin/1000)*VISION_SIZE, ((m.xmax-m.xmin)/1000)*VISION_SIZE, ((m.ymax-m.ymin)/1000)*VISION_SIZE);
      
      ctx.fillStyle = '#475569';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GOOGLE MAPS', ((m.xmin+m.xmax)/2000)*VISION_SIZE, ((m.ymin+m.ymax)/2000)*VISION_SIZE);

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
  }, [isLive, sendFrequency, dims, layoutBounds, activeProgram]);

  // Refresh the real-pixel spreadsheet snapshot (throttled, fail-soft) for the vision frame.
  useEffect(() => {
    if (!isLive || activeProgram !== 'excel') {
      spreadsheetSnapshotRef.current = null;
      return;
    }
    let cancelled = false;
    const gate = makeThrottle(500);
    const tick = async () => {
      if (cancelled || !gate(Date.now())) return;
      const node = spreadsheetRef.current;
      if (!node) return;
      const canvas = await snapshotNode(node);
      if (!cancelled && canvas) spreadsheetSnapshotRef.current = canvas;
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
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
      void terminateOcr(); // free the OCR worker
    };
  }, []);
  const resetCanvas = () => {
    const ctx = persistentCanvasRef.current?.getContext('2d');
    if(ctx) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = INITIAL_IMAGE;
      img.onload = () => {
        // Use the same cropping logic as initial load
        const imgAspect = img.naturalWidth / img.naturalHeight;
        let sx, sy, sWidth, sHeight;
        if (imgAspect > 1) {
          sHeight = img.naturalHeight;
          sWidth = img.naturalHeight;
          sx = (img.naturalWidth - sWidth) / 2;
          sy = 0;
        } else {
          sWidth = img.naturalWidth;
          sHeight = img.naturalWidth;
          sx = 0;
          sy = (img.naturalHeight - sHeight) / 2;
        }
        
        ctx.clearRect(0, 0, dims.width, dims.height);
        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, dims.width, dims.height);
        setCurrentImage(persistentCanvasRef.current!.toDataURL('image/png'));
        const baseEntities = buildEntities(program, perceivedLabelsRef.current, null);
        setEntities(baseEntities);
        entitiesRef.current = baseEntities;
        setHistory([]); // Clear history on full reset
        addLog('info', 'Canvas Reset.');
        // Clear markers on reset
        markersRef.current = [];
        lastMarkerTimeRef.current = {};
      }
    }
  };

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
    setCurrentTaskIndex(0);
    setCompletedTaskIds([]);
    identifiedLandmarksRef.current = new Set();
    hasOfferedTripRef.current = false;
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
    setHistory([]);
    setPersistentPaths([]);
    setPointerPath([]);
    const baseEntities = buildEntities(program, perceivedLabelsRef.current, null);
    setEntities(baseEntities);
    entitiesRef.current = baseEntities;
    setMapQuery("London");
    setMapType('search');
    setDirections(null);
    setProposedItinerary(null);
    setShareRequest(null);
    setPendingAction(null);
    const freshDoc = initialMockDoc(activeProgram);
    setMockDoc(freshDoc);
    mockDocRef.current = freshDoc;
    setUndoStack([]);
    referents.clear();

    const pCanvas = persistentCanvasRef.current;
    if (pCanvas) {
      const ctx = pCanvas.getContext('2d');
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = INITIAL_IMAGE + "?t=" + Date.now();
      img.onload = () => {
        const w = dims.width;
        const h = dims.height;
        const imgAspect = img.naturalWidth / img.naturalHeight;
        let sx, sy, sWidth, sHeight;
        if (imgAspect > 1) {
          sHeight = img.naturalHeight;
          sWidth = img.naturalHeight;
          sx = (img.naturalWidth - sWidth) / 2;
          sy = 0;
        } else {
          sWidth = img.naturalWidth;
          sHeight = img.naturalWidth;
          sx = 0;
          sy = (img.naturalHeight - sHeight) / 2;
        }
        ctx?.clearRect(0, 0, w, h);
        ctx?.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, w, h);
        setCurrentImage(pCanvas.toDataURL('image/png'));
      };
    }
    
    addLog('info', 'Map reset to original state.');
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
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden custom-scrollbar">
        <main
          ref={mainContainerRef}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{ touchAction: isLive ? 'none' : 'auto' }}
          className="flex-1 flex flex-row items-center lg:justify-start justify-center p-2 sm:p-4 lg:p-8 lg:pl-24 relative gap-2 lg:gap-0 min-h-[60vh] lg:min-h-0"
        >
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
          {teachMode && <TeachingLayer entities={entities} demo dispatchRef={teachingDispatchRef} />}
          {/* G6 FEEDFORWARD: live "what I'll act on" preview as the cursor moves, so the user
              sees the interpretation forming BEFORE they speak (closes the gulf of execution). */}
          {isLive && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-sm">
              <span className={`w-2 h-2 rounded-full ${hoveredId && hoveredId !== MAP_ENTITY_ID ? 'bg-[var(--accent-color)] animate-pulse' : 'bg-[var(--text-secondary)] opacity-40'}`} />
              <span className="text-[11px] font-mono text-[var(--text-primary)]">
                {hoveredId && hoveredId !== MAP_ENTITY_ID
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
              className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-[60] pointer-events-none flex items-center gap-2 px-4 py-2 rounded-full shadow-lg border backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-200 ${
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
            </div>
          )}

          {/* Photos Box */}
          <div className="photos-box flex flex-col flex-1 min-w-0 lg:max-w-[700px] aspect-[2/3] relative z-10">
            <div className="flex flex-col bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-2 sm:p-4 overflow-hidden w-full h-full">
              <div className="flex items-center justify-between mb-4 sm:mb-8">
                <div className="flex flex-col">
                  <h3 className="text-xs sm:text-sm font-semibold text-[var(--text-primary)]">{program.label}</h3>
                </div>
                <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <Plus size={20} className="opacity-50" />
                  <MoreVertical size={20} className="opacity-50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 overflow-y-auto pr-2 custom-scrollbar flex-1">
                {activeProgram === 'word' || activeProgram === 'powerpoint' ? (
                  <div className="col-span-2 h-full">
                    <ProgramSurface program={program} doc={mockDoc} live={isLive} focusTitle={focusTitle}
                      onAction={handleSurfaceAction} onElementClick={handleSurfaceElementClick} />
                  </div>
                ) : activeProgram === 'excel' ? (
                  <div className="col-span-2 h-full">
                    <ProgramSurface program={program} doc={mockDoc} live={isLive} focusTitle={focusTitle}
                      onAction={handleSurfaceAction} onElementClick={handleSurfaceElementClick}
                      spreadsheetRef={spreadsheetRef} />
                  </div>
                ) : (
                PHOTOS.map((photo, i) => {
                  // Highlight the element the active scenario wants the user to point at.
                  const isFocus = !!focusTitle && photo.title === focusTitle;
                  const tone = CATEGORY_COLORS[photo.category];
                  return (
                    <div
                      key={photo.id}
                      data-element-id={photo.id}
                      onClick={() => handleSurfaceElementClick(photo.id)}
                      className={`photo-item relative aspect-[3/4] rounded-lg overflow-hidden border bg-[var(--card-bg)] transition-all duration-300 cursor-pointer shadow-sm ${isFocus ? 'border-transparent' : 'border-[var(--card-border)]'}`}
                      style={isFocus ? { boxShadow: `0 0 0 3px rgb(${tone}), 0 0 16px 2px rgba(${tone}, 0.45)` } : undefined}
                    >
                      <img src={photo.url} alt={photo.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" draggable="false" />
                      {/* G8: numbered target — say "number N", press N, or tap. */}
                      {isLive && (
                        <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-mono font-bold flex items-center justify-center">
                          {i + 1}
                        </span>
                      )}
                      {isFocus && (
                        <span
                          className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wide text-white"
                          style={{ backgroundColor: `rgb(${tone})` }}
                        >
                          Point here
                        </span>
                      )}
                    </div>
                  );
                }))}
              </div>
            </div>
          </div>
          {/* Theme Toggle Button */}
          <div className="absolute top-3 left-4 lg:top-6 sm:left-8 z-50">
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg hover:opacity-80 transition-all text-[var(--text-primary)] shadow-sm"
              title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDarkMode ? <Sun size={18} fill="white" fillOpacity={0.5} /> : <Moon size={18} fill="white" fillOpacity={0.5} />}
            </button>
          </div>

          <div className="map-box relative lg:-ml-[110px] flex-1 min-w-0 lg:max-w-[700px] aspect-[2/2.43]">
            <div 
              className={`relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden w-full h-full transition-all duration-300 ${hoveredId === MAP_ENTITY_ID ? 'ring-4 ring-[var(--accent-color)]/10 dark:ring-[var(--accent-color)]/20' : ''}`}
            >
              <div className="absolute inset-0 w-full h-full">
                <iframe
                  key={mapUrl}
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  style={{ border: 0, pointerEvents: isLive ? 'none' : 'auto' }}
                  src={mapUrl}
                  allowFullScreen
                ></iframe>
              </div>
              <canvas ref={persistentCanvasRef} className="hidden" />
            </div>
          </div>
        </main>

        {/* Responsive Sidebar */}
        <aside id="sidebar-section" className="w-full lg:w-[400px] p-3 lg:p-6 flex flex-col gap-4 shrink-0 h-auto lg:h-full overflow-visible lg:overflow-y-auto custom-scrollbar">
          {/* Task Box - Always Visible */}
          <section id="task-section" className={`shrink-0 relative ${showOnboarding ? 'z-[10001]' : ''}`}>
            <AnimatePresence mode="popLayout" custom={slideDirection}>
              <motion.div
                key={currentTaskIndex}
                custom={slideDirection}
                initial={{ opacity: 0, x: slideDirection * 100 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -slideDirection * 100 }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 text-[var(--text-primary)] relative overflow-hidden"
              >
                {/* Decorative background element */}
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-[var(--accent-color)]/5 rounded-full blur-2xl" />
                
                <div className="flex items-center justify-between mb-5 relative z-10">
                  <div className="flex items-center gap-2">
                    <div className="px-3 py-1 rounded-full bg-[var(--inverse-bg)] text-[var(--inverse-text)] text-[10px] font-mono font-bold uppercase tracking-widest">
                      {isCongratulationsPage ? "COMPLETE" : `Task ${currentTaskIndex + 1}/${TASKS.length}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Jump directly to any scenario — robust switching, not just step-through. */}
                    <select
                      value={isCongratulationsPage ? '' : currentTaskIndex}
                      onChange={(e) => { if (e.target.value !== '') goToTask(Number(e.target.value)); }}
                      title="Jump to scenario"
                      className="mr-1 max-w-[150px] text-[11px] font-mono bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1 text-[var(--text-primary)]"
                    >
                      {isCongratulationsPage && <option value="">Complete</option>}
                      {TASKS.map((t, i) => (
                        <option key={t.key} value={i}>{`${i + 1}. ${t.title}`}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        setSlideDirection(-1);
                        const total = allTasksCompleted ? TASKS.length + 1 : TASKS.length;
                        setCurrentTaskIndex(prev => (prev - 1 + total) % total);
                      }}
                      className="p-1.5 rounded-full hover:bg-[var(--bg-color)] text-[var(--text-secondary)] transition-colors"
                      title="Previous task"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      onClick={() => {
                        setSlideDirection(1);
                        const total = allTasksCompleted ? TASKS.length + 1 : TASKS.length;
                        setCurrentTaskIndex(prev => (prev + 1) % total);
                      }}
                      className="p-1.5 rounded-full hover:bg-[var(--bg-color)] text-[var(--text-secondary)] transition-colors"
                      title="Next task"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>

                {isCongratulationsPage ? (
                  <div className="flex flex-col items-center text-center py-4 relative z-10">
                    <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                      <CheckCircle size={40} className="text-green-600 dark:text-green-400" />
                    </div>
                    <h4 className="text-xl font-dm font-bold mb-2 text-[var(--text-primary)]">
                      Congratulations!
                    </h4>
                    <p className="text-sm font-dm text-slate-500 mb-8 max-w-[240px]">
                      You've completed all {TASKS.length} tasks.<br />
                      Great job!
                    </p>
                    {/* 
                    <button
                      onClick={() => {
                        setCompletedTaskIds([]);
                        setCurrentTaskIndex(0);
                        setSlideDirection(-1);
                      }}
                      className="relative w-full h-[60px] rounded-full font-dm font-bold text-[15px] tracking-[-0.025em] leading-[28px] transition-all flex items-center justify-center active:scale-95 border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-primary)] hover:bg-[#E9F0FE] dark:hover:bg-[#304359] hover:border-[#1A74E8] hover:text-[#1A74E8] dark:hover:text-white group"
                    >
                      Try another prototype
                    </button>
                    */}
                  </div>
                ) : (
                  <>
                    <div className="flex gap-4 items-start mb-5 relative z-10">
                      <div className="w-20 h-20 rounded-xl overflow-hidden shrink-0 border border-[var(--card-border)] shadow-sm bg-[var(--bg-color)]">
                        <img 
                          src={TASKS[currentTaskIndex].image} 
                          alt={TASKS[currentTaskIndex].title}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            // Fallback if the ImgBB direct link guess fails
                            (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${TASKS[currentTaskIndex].id}/200/200`;
                          }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        {(() => {
                          const meta = ACTION_CATEGORIES[TASKS[currentTaskIndex].action];
                          return (
                            <span
                              className="inline-block mb-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wide"
                              style={{ backgroundColor: `rgba(${meta.color}, 0.15)`, color: `rgb(${meta.color})` }}
                            >
                              {meta.label}
                            </span>
                          );
                        })()}
                        <h4 className="text-base font-dm font-bold mb-1.5 leading-tight text-[var(--text-primary)]">
                          {TASKS[currentTaskIndex].title}
                        </h4>
                        <p className="text-[13px] font-dm text-[var(--text-secondary)] leading-snug">
                          {TASKS[currentTaskIndex].description}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 relative z-10">
                      <div className="flex items-center gap-3 bg-[var(--inner-box-bg)] px-6 py-4 rounded-xl">
                        <Lightbulb size={16} className="text-[var(--text-primary)]" />
                        <div className="text-xs text-[var(--text-primary)] leading-snug font-dm">
                          <p className="opacity-50 mb-0.5">You can say:</p>
                          <p className="font-bold italic text-sm">
                            {TASKS[currentTaskIndex].hint.match(/"(.*?)"/)?.[0] || ""}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          if (isCurrentTaskDone) {
                            setCompletedTaskIds(prev => prev.filter(id => id !== TASKS[currentTaskIndex].id));
                            return;
                          }
                          const newCompletedIds = [...completedTaskIds, TASKS[currentTaskIndex].id];
                          setCompletedTaskIds(newCompletedIds);
                          confetti({
                            particleCount: 100,
                            spread: 70,
                            origin: { y: 0.6 }
                          });
                          
                          setTimeout(() => {
                            setSlideDirection(1);
                            setTimeout(() => {
                              if (newCompletedIds.length === TASKS.length) {
                                setCurrentTaskIndex(TASKS.length);
                              } else {
                                setCurrentTaskIndex(prev => (prev + 1) % TASKS.length);
                              }
                            }, 100);
                          }, 800);
                        }}
                        className={`relative w-full h-[60px] rounded-full font-dm font-bold text-[15px] tracking-[-0.025em] leading-[28px] transition-all flex items-center justify-center active:scale-95 border bg-[var(--card-bg)] border-[var(--card-border)] dark:border-[#495564] text-[var(--text-primary)] hover:bg-[#E7F0FF] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:bg-[#344256] dark:hover:border-[#0076F0] dark:hover:text-white group`}
                      >
                        <CheckCircle size={18} className={`absolute left-6 ${isCurrentTaskDone ? "text-[var(--accent-color)]" : "text-[var(--text-secondary)] opacity-30 group-hover:text-[#0077F0] dark:group-hover:text-[var(--accent-color)] group-hover:opacity-100"}`} />
                        {isCurrentTaskDone ? 'Done' : 'Mark as complete'}
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Session Controls Box - Buttons */}
          <section className="shrink-0 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6">
            {/* Honest Mode toggle — the A/B switch (confident Google baseline vs honest) */}
            <button
              onClick={() => setHonestMode(h => !h)}
              title={honestMode
                ? "Honest mode ON — carries confidence, asks when a photo is ambiguous"
                : "Confident baseline — treats every hint as absolute truth (Google default)"}
              className={`w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border transition-all ${
                honestMode
                  ? 'bg-green-500/10 border-green-500/40'
                  : 'bg-[var(--inner-box-bg)] border-[var(--card-border)] hover:border-[var(--accent-color)]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {honestMode
                  ? <ShieldCheck size={18} className="text-green-500 shrink-0" />
                  : <Shield size={18} className="text-[var(--text-secondary)] shrink-0" />}
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-[12px] font-bold text-[var(--text-primary)] leading-tight">Honest mode</span>
                  <span className="text-[10px] font-mono text-[var(--text-secondary)] leading-tight truncate">
                    {honestMode ? 'Asks when unsure' : 'Confident (Google baseline)'}
                  </span>
                </div>
              </div>
              <div className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${honestMode ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${honestMode ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </button>
            <div className="w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
              <span className="text-[12px] font-bold text-[var(--text-primary)]">Program</span>
              <select
                value={activeProgram}
                onChange={(e) => handleProgramChange(e.target.value as ProgramId)}
                className="text-[12px] font-mono bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1 text-[var(--text-primary)]"
              >
                {PROGRAMS.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
              <span className="text-[12px] font-bold text-[var(--text-primary)]">Voice backend</span>
              <select
                value={voiceBackend}
                onChange={(e) => setVoiceBackend(e.target.value as ProviderKind)}
                className="text-[12px] font-mono bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1 text-[var(--text-primary)]"
              >
                <option value="gemini">Gemini</option>
                <option value="azure">RTV2 (Azure Realtime)</option>
              </select>
            </div>
            {/* DIAL A — autonomy/friction: how readily verbs commit vs. witness-render first. */}
            <div className="w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
              <span className="text-[12px] font-bold text-[var(--text-primary)]" title="How readily actions commit vs. ask you to confirm first">Autonomy</span>
              <select
                value={autonomy}
                onChange={(e) => setAutonomy(e.target.value as Autonomy)}
                className="text-[12px] font-mono bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1 text-[var(--text-primary)]"
              >
                {AUTONOMY_OPTIONS.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            {/* DIAL B — feedback modality: how the app confirms (the model never self-confirms). */}
            <div className="w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
              <span className="text-[12px] font-bold text-[var(--text-primary)]" title="How the app confirms actions — the assistant stays silent on success">Feedback</span>
              <select
                value={feedbackMode}
                onChange={(e) => setFeedbackMode(e.target.value as FeedbackMode)}
                className="text-[12px] font-mono bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1 text-[var(--text-primary)]"
              >
                {FEEDBACK_OPTIONS.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            {/* Audition the earcon set without a live session (clicking unlocks the audio ctx). */}
            <div className="w-full mb-4 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
              <span className="text-[11px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Audition earcons</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EARCON_KINDS.map(kind => (
                  <button
                    key={kind}
                    onClick={() => playEarcon(kind)}
                    className="px-2 py-1 rounded-md text-[10px] font-mono border bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-primary)] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:text-white transition-colors active:scale-95"
                    title={`Play "${kind}" earcon`}
                  >
                    {kind.replace('commit-', '')}
                  </button>
                ))}
              </div>
            </div>
            {/* G3 OCR sub-elements toggle — read words in the screenshots so you can point at one. */}
            <div className="w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
              <div className="flex flex-col">
                <span className="text-[12px] font-bold text-[var(--text-primary)]">OCR sub-elements</span>
                <span className="text-[10px] font-mono text-[var(--text-secondary)]">{ocrEnabled ? 'point at individual words' : 'whole-tile pointing'}</span>
              </div>
              <button
                onClick={() => { setOcrEnabled(v => { const nv = !v; if (!nv) { ocrWordsRef.current = {}; setHoveredWord(null); } return nv; }); }}
                className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${ocrEnabled ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                title="Recognize text in the screenshots (downloads an OCR model the first time; needs network)"
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${ocrEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            {/* Testbed telemetry — live metrics for the active config + a JSON export. */}
            {(() => {
              void telemetryTick; // re-read on tick
              const device = detectDevice();
              const tm = telemetry.metrics();
              const cal = tm.deixis.calibration;
              return (
                <div className="w-full mb-4 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Testbed</span>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">{device.formFactor} · {device.width}×{device.height} · {device.pointer}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-[var(--text-primary)]">
                    <span className="text-[var(--text-secondary)]">Deixis acc</span>
                    <span>{tm.deixis.accuracy === null ? '—' : `${Math.round(tm.deixis.accuracy * 100)}% (${tm.deixis.correct}/${tm.deixis.graded})`}</span>
                    <span className="text-[var(--text-secondary)]">Calibration</span>
                    <span>hi {cal.high.correct}/{cal.high.n} · lo {cal.low.correct}/{cal.low.n}</span>
                    <span className="text-[var(--text-secondary)]">Actions</span>
                    <span>{tm.actions.total} ({tm.actions.commits}✓ {tm.actions.witnesses}?)</span>
                    <span className="text-[var(--text-secondary)]">Grounding</span>
                    <span>{tm.grounding.agreementRate === null ? '—' : `${Math.round(tm.grounding.agreementRate * 100)}% (${tm.grounding.agree}/${tm.grounding.total})`}</span>
                    <span className="text-[var(--text-secondary)]">Corrections</span>
                    <span>{tm.corrections} ({Math.round(tm.correctionRate * 100)}%)</span>
                    <span className="text-[var(--text-secondary)]">Errors</span>
                    <span>{tm.errors}</span>
                  </div>
                  <button
                    onClick={() => telemetry.exportJSON()}
                    className="mt-2 w-full px-2 py-1 rounded-md text-[11px] font-mono border bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-primary)] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:text-white transition-colors active:scale-95"
                  >
                    Export session JSON
                  </button>
                </div>
              );
            })()}
            {isEmbedded && !isLive && (
              <div className="w-full mb-3 px-4 py-3 rounded-2xl border border-amber-500/40 bg-amber-500/5">
                <p className="text-[11px] font-mono text-[var(--text-secondary)] leading-relaxed mb-2">
                  Running in an embedded preview — the microphone is usually blocked here. Open in a full tab to grant mic access.
                </p>
                <button
                  onClick={() => window.open(window.location.href, '_blank', 'noopener')}
                  className="w-full h-[40px] rounded-full font-dm font-bold text-[12px] flex items-center justify-center gap-2 border border-amber-500/60 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
                >
                  Open in a new tab ↗
                </button>
              </div>
            )}
            {!isLive ? (
              <button
                onClick={startLiveSession}
                className="w-full h-[60px] rounded-full font-dm font-bold text-[15px] tracking-[-0.025em] leading-[28px] transition-all shadow-lg bg-[var(--inverse-bg)] text-[var(--inverse-text)] hover:opacity-90 hover:scale-[1.02] active:scale-98 flex items-center justify-center gap-3"
              >
                <Mic size={20} /> Start Point and Speak
              </button>
            ) : (
              <div className="flex gap-2">
                <button 
                  onClick={() => providerRef.current?.close()}
                  className="flex-1 h-[60px] rounded-full font-dm font-bold text-[15px] tracking-[-0.025em] leading-[28px] transition-all shadow-lg bg-[var(--inverse-bg)] text-[var(--inverse-text)] hover:opacity-90 hover:scale-[1.02] active:scale-98 flex items-center justify-center gap-3"
                >
                  End Session
                </button>
                <button 
                  onClick={handleReset}
                  className="flex-1 h-[60px] rounded-full font-dm font-bold text-[15px] tracking-[-0.025em] leading-[28px] transition-all flex items-center justify-center active:scale-95 border bg-[var(--card-bg)] border-[var(--card-border)] dark:border-[#495564] text-[var(--text-primary)] hover:bg-[#E7F0FF] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:bg-[#344256] dark:hover:border-[#0076F0] dark:hover:text-white"
                >
                  <RotateCcw size={18} className="mr-2" /> Reset
                </button>
              </div>
            )}
          </section>

          {/* Listening Box - Separate Section */}
          <section className="shrink-0 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className={`${(pendingEdit || pendingMapUpdate || isProcessing || liveTranscription || isLive) ? 'bg-[var(--inner-box-bg)] border-[var(--accent-color)]' : 'bg-[var(--inner-box-bg)] border-[var(--card-border)]'} border p-5 rounded-2xl flex flex-col gap-4 shadow-sm transition-colors duration-300`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${(pendingEdit || pendingMapUpdate || isProcessing || liveTranscription || isLive) ? 'bg-[var(--accent-color)]' : 'bg-[var(--text-secondary)] opacity-30'} ${isProcessing ? 'animate-spin' : (isLive || pendingEdit || pendingMapUpdate || liveTranscription) ? 'animate-pulse-strong' : ''}`} />
                  <span className={`text-[11px] font-mono font-normal tracking-tight ${(pendingEdit || pendingMapUpdate || isProcessing || liveTranscription || isLive) ? 'text-[var(--accent-color)] uppercase' : 'text-[var(--text-secondary)] uppercase'}`}>
                    {isProcessing ? 'Evolving...' : (liveTranscription || pendingEdit || pendingMapUpdate ? 'Listening...' : (isLive ? 'Listening...' : 'System Idle'))}
                  </span>
                </div>
                <span className={`text-[8px] font-mono uppercase opacity-50 ${(pendingEdit || pendingMapUpdate || isProcessing || liveTranscription || isLive) ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                  {isProcessing ? 'GPU ACTIVE' : (liveTranscription || pendingEdit || pendingMapUpdate ? 'VOICE' : (isLive ? 'LISTENING' : 'OFFLINE'))}
                </span>
              </div>
              
              <p className={`text-[11px] font-mono leading-relaxed ${(pendingEdit || pendingMapUpdate || isProcessing || liveTranscription || lastError) ? 'text-[var(--text-primary)] font-normal italic' : 'text-[var(--text-secondary)] font-normal'}`}>
                {lastError ? (
                  <span className="text-red-500">Error: {lastError}</span>
                ) : (
                  (isProcessing ? activePrompt : (liveTranscription || pendingEdit?.prompt)) || (isLive ? "..." : "Start point and speak to begin.")
                )}
              </p>
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => { e.preventDefault(); sendTypedInput(typedDraft); }}
              >
                <input
                  value={typedDraft}
                  onChange={(e) => setTypedDraft(e.target.value)}
                  placeholder="type a command — point while you type"
                  disabled={isConnecting}
                  className="flex-1 bg-transparent border border-[var(--card-border)] rounded-lg px-3 py-1.5 text-[11px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] placeholder:opacity-50 focus:outline-none focus:border-[var(--accent-color)] disabled:opacity-40"
                />
                <button
                  type="submit"
                  disabled={isConnecting || !typedDraft.trim()}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wide bg-[var(--accent-color)]/10 text-[var(--accent-color)] border border-[var(--accent-color)]/30 hover:bg-[var(--accent-color)]/20 disabled:opacity-30 transition-colors"
                >
                  {isConnecting ? '…' : 'Send'}
                </button>
              </form>
            </div>
          </section>

          {/* PHASE E: Proposed itinerary — a hypothesis rendered as a visible artifact, awaiting
              an explicit verbal confirm ("build it"). The output is the question, not the answer. */}
          {proposedItinerary && (
            <section className="shrink-0 bg-[var(--card-bg)] border border-amber-500/40 rounded-2xl p-6 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={16} className="text-amber-500" />
                <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-amber-500">Proposed plan — not built yet</span>
              </div>
              <ol className="flex flex-col gap-2 mb-3">
                {proposedItinerary.places.map((place, i) => (
                  <li key={`${place}-${i}`} className="flex items-center gap-3 text-[var(--text-primary)]">
                    <span className="w-5 h-5 shrink-0 rounded-full bg-amber-500/15 text-amber-500 text-[10px] font-mono font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="text-sm">{place}</span>
                  </li>
                ))}
              </ol>
              {proposedItinerary.plan && (
                <p className="text-[11px] font-mono text-[var(--text-secondary)] mb-3 italic">{proposedItinerary.plan}</p>
              )}
              <p className="text-[11px] font-mono text-[var(--text-secondary)]">Say <span className="text-amber-500 font-bold">"build it"</span> to confirm, or keep talking to change it.</p>
            </section>
          )}

          {/* PHASE G: Outward share — witness recipient + payload before sending (or a sent receipt). */}
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
                <p className="text-[11px] font-mono text-[var(--text-secondary)]">Say <span className="text-amber-500 font-bold">"yes, send it"</span> to confirm.</p>
              )}
            </section>
          )}

          {/* Action verb — witness-render the interpretation before committing (honest mode),
              or a "done" receipt after it commits. Same grammar as the share card above. */}
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
                <p className="text-[11px] font-mono text-[var(--text-secondary)]">Say <span className="text-amber-500 font-bold">"yes, do it"</span> to confirm.</p>
              )}
            </section>
          )}

          {/* Mock document preview — the action verbs visibly mutate this. */}
          {isLive && (
            <section className="shrink-0 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6">
              <div className="flex items-center justify-end mb-2 -mt-2">
                <button
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
                    undoStack.length === 0
                      ? 'opacity-40 cursor-not-allowed border-[var(--card-border)] text-[var(--text-secondary)]'
                      : 'border-[var(--card-border)] text-[var(--text-primary)] hover:border-[#0077F0] hover:text-[#0077F0] dark:hover:text-white active:scale-95'
                  }`}
                  title="Undo the last document change"
                >
                  <RotateCcw size={13} /> Undo{undoStack.length ? ` (${undoStack.length})` : ''}
                </button>
              </div>
              <MockPreview doc={mockDoc} />
            </section>
          )}

          {/* Control Center Box - Minimizable (Hidden for now) */}
            <div className={`hidden flex-col bg-[var(--card-bg)] border border-[var(--card-border)] shadow-lg rounded-2xl overflow-hidden transition-all duration-500 ease-in-out ${isDebugOpen ? 'flex-1' : 'h-[72px] shrink-0'}`}>
            {/* Header with Toggle */}
            <div 
              className="p-6 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-color)] transition-colors shrink-0"
              onClick={() => setIsDebugOpen(!isDebugOpen)}
            >
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`} />
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--text-secondary)]">Control Center</span>
              </div>
              <div className="p-2 rounded-xl bg-[var(--bg-color)] text-[var(--text-secondary)]">
                {isDebugOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>
            </div>

            {isDebugOpen && (
              <div className="px-6 pb-6 flex flex-col h-full space-y-6 overflow-y-auto custom-scrollbar">
                <section className="flex items-center gap-4 bg-[var(--bg-color)] p-4 rounded-2xl border border-[var(--card-border)]">
              <div className="flex-1 min-w-0">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">AI Vision State</label>
                <p className="text-[9px] text-slate-400 italic leading-tight mb-2">Magnified view of your target.</p>
                {markersRef.current[0]?.identifiedObject && !["BOTTOM RIGHT AREA", "MONSTER ISLAND", "MIDDLE ISLAND", "LEFT ISLAND", "MONSTER ISLAND (TOP RIGHT)", "MIDDLE ISLAND (CENTER)", "LEFT ISLAND (LEFT SIDE)"].includes(markersRef.current[0].identifiedObject) && (
                  <div className="inline-flex items-center gap-1.5 bg-green-500/10 text-green-600 text-[8px] font-black px-2 py-1 rounded-lg uppercase tracking-widest border border-green-500/20 animate-in fade-in slide-in-from-left-2">
                    <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                    {markersRef.current[0].identifiedObject}
                  </div>
                )}
              </div>
              <div 
                className="w-20 h-20 shrink-0 bg-slate-100 rounded-xl border border-black/5 overflow-hidden shadow-inner relative"
                style={{
                  backgroundImage: `url(${currentImage})`,
                  backgroundSize: '300%',
                  backgroundPosition: `${((currentCoords.x / 1000) * 3 - 0.5) / 2 * 100}% ${((currentCoords.y / 1000) * 3 - 0.5) / 2 * 100}%`,
                  backgroundRepeat: 'no-repeat',
                }}
              >
                {/* Smooth Crosshair Overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-full h-[1px] bg-red-500/30" />
                  <div className="h-full w-[1px] bg-red-500/30 absolute" />
                  <div className="w-4 h-4 border border-red-500/40 rounded-full bg-red-500/5" />
                </div>
                {!isLive && <div className="absolute inset-0 bg-[var(--card-bg)] opacity-80 flex items-center justify-center text-[8px] text-[var(--text-secondary)] uppercase font-black">Offline</div>}
              </div>
            </section>

            <section className="flex-1 min-h-[200px] bg-[var(--bg-color)] rounded-2xl p-6 border border-[var(--card-border)] flex flex-col overflow-hidden">
              <span className="text-[9px] font-black uppercase text-slate-400 mb-4 tracking-widest">Operation Stream</span>
              <div className="flex-1 font-mono text-[9px] space-y-3 overflow-y-auto custom-scrollbar pr-2">
                {logs.map((l, i) => (
                  <div key={i} className="flex flex-col gap-1 border-b border-black/5 pb-2">
                    <div className="flex justify-between items-center opacity-40">
                      <span>{l.time}</span>
                      <span className="uppercase text-[7px]">{l.type}</span>
                    </div>
                    <span className={l.type === 'gemini' ? 'text-[var(--accent-color)]' : 'text-[var(--text-secondary)]'}>{l.message}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex items-center gap-4 pt-2">
              <div className="flex-1 space-y-2">
                <div className="flex justify-between text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                  <span>Refresh Rate</span>
                  <span>{sendFrequency}ms</span>
                </div>
                <input 
                  type="range" 
                  min="300" 
                  max="2000" 
                  step="100" 
                  value={sendFrequency} 
                  onChange={e => setSendFrequency(Number(e.target.value))} 
                  className="w-full h-1 bg-black/5 rounded-full accent-[var(--accent-color)] appearance-none cursor-pointer" 
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </aside>
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

  {/* Welcome Modal */}
  <AnimatePresence>
    {showWelcome && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 dark:bg-white/20 backdrop-blur-sm"
        onClick={handleDismissWelcome}
      >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-[32px] shadow-2xl w-[90vw] max-w-2xl relative overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="flex flex-col items-stretch">
              <div className="p-[6vh] sm:p-[8vh] pb-0">
                <h2 className="text-[clamp(1.5rem,6vh,3rem)] font-inter font-bold text-[var(--text-primary)] mb-[2vh] tracking-[-0.04em] leading-[1.1]">
                  Point and Speak
                  <br />
                  <span className="text-[var(--accent-color)]">with the AI-Pointer</span>
                </h2>
                <div className="text-[var(--text-secondary)] font-inter font-normal leading-tight text-[clamp(0.875rem,2.2vh,1rem)]">
                  <p>
                    Experience the power of an AI-enabled pointer.
                    <br />
                    Just point and speak to get directions and find things.
                  </p>
                </div>
              </div>

              <div className="px-[6vh] sm:px-[8vh] mt-[2vh] flex-grow flex items-center justify-center min-h-0">
                <img 
                  src="https://www.gstatic.com/aistudio/ai-pointer-find/flow-graphic.png" 
                  alt="gPointer Preview" 
                  className="w-full h-auto max-h-[35vh] object-contain block"
                />
              </div>
              
              <div className="p-[6vh] sm:p-[8vh] pt-0 mt-[2vh]">
                <button
                  onClick={handleDismissWelcome}
                  className="w-full h-[clamp(48px,8vh,64px)] bg-[var(--inverse-bg)] text-[var(--inverse-text)] rounded-full font-dm font-bold text-[clamp(0.9rem,2.5vh,1.125rem)] hover:opacity-90 transition-all active:scale-[0.98] shadow-lg shrink-0 flex items-center justify-center gap-2"
                >
                  <Mic className="w-5 h-5" />
                  Start Point and Speak
                </button>
              </div>
            </div>
          </motion.div>
      </motion.div>
    )}
  </AnimatePresence>

  <AnimatePresence>
    {showOnboarding && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10000] pointer-events-none"
      >
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[4px] pointer-events-auto" onClick={() => setShowOnboarding(false)} />
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute top-[10%] right-[320px] sm:right-[370px] lg:right-[420px] z-[10002] pointer-events-auto"
        >
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text-primary)] p-6 rounded-2xl shadow-2xl max-w-[240px] relative">
            {/* Arrow */}
            <div className="absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-4 bg-[var(--card-bg)] border-r border-t border-[var(--card-border)] rotate-45" />
            
            <p className="font-dm font-bold text-lg leading-tight mb-2 relative z-10">Try to complete these tasks</p>
            <p className="text-sm font-dm text-[var(--text-secondary)] mb-5 relative z-10">Follow the instructions in the task cards to explore the app's features.</p>
            <button 
              onClick={() => {
                setShowOnboarding(false);
                startLiveSession();
              }}
              className="w-full h-[48px] bg-[var(--inverse-bg)] text-[var(--inverse-text)] rounded-full font-dm font-bold text-sm hover:opacity-90 transition-all active:scale-[0.98] shadow-md flex items-center justify-center relative z-10 gap-2"
            >
              <Mic className="w-4 h-4" />
              Start
            </button>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>

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
