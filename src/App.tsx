/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import confetti from 'canvas-confetti';
import { GoogleGenAI, Modality, Type, GenerateContentResponse } from '@google/genai';
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
  Laptop
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CursorTrail, CursorResources } from './components/CursorEffects';

// --- Types ---
interface Marker {
  x: number;
  y: number;
  timestamp: number;
  displayLabel: string;
  identifiedObject?: string;
  isConsumed?: boolean;
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

const TASKS = [
  {
    id: 1,
    title: "Pinpointing",
    description: "Find a location by pointing at an image and asking where it is.",
    hint: 'Say "Where\'s this?"',
    image: "https://www.gstatic.com/aistudio/ai-pointer-find/map_task_1.png"
  },
  {
    id: 2,
    title: "Discover what's nearby",
    description: "Point at an image and ask to find locations nearby.",
    hint: 'Say "Show me restaurants near here"',
    image: "https://www.gstatic.com/aistudio/ai-pointer-find/map_task_3.png"
  },
  {
    id: 3,
    title: "Point A to Point B",
    description: "Pick two images. Point or circle them as you speak to get directions between them.",
    hint: 'Say "How do I go from here, to there?"',
    image: "https://www.gstatic.com/aistudio/ai-pointer-find/circle-item.png"
  }
];

const PHOTOS = [
  { id: 1, url: "https://www.gstatic.com/aistudio/ai-pointer-find/the_london_eye.png", title: "London Eye" },
  { id: 2, url: "https://www.gstatic.com/aistudio/ai-pointer-find/hyde_park.png", title: "Hyde Park" },
  { id: 3, url: "https://www.gstatic.com/aistudio/ai-pointer-find/westminster-abbey.png", title: "Westminster Abbey" },
  { id: 4, url: "https://www.gstatic.com/aistudio/ai-pointer-find/st_pancras_station.png", title: "St Pancras Station" },
];

const INTERACTIVE_OBJECTS = [
  { name: "London Eye", bbox: [0, 0, 0, 0] },
  { name: "Hyde Park", bbox: [0, 0, 0, 0] },
  { name: "Westminster Abbey", bbox: [0, 0, 0, 0] },
  { name: "St Pancras Station", bbox: [0, 0, 0, 0] },
  { name: "Google Maps", bbox: [0, 0, 0, 0] }
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
  const [interactiveObjects, setInteractiveObjects] = useState(INTERACTIVE_OBJECTS);
  const interactiveObjectsRef = useRef(INTERACTIVE_OBJECTS);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showRotateOverlay, setShowRotateOverlay] = useState(false);
  const [showMobileOverlay, setShowMobileOverlay] = useState(false);

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
  const [enableVoiceFeedback, setEnableVoiceFeedback] = useState(true);
  const [voiceVolume, setVoiceVolume] = useState(1.0);
  const [audioStatus, setAudioStatus] = useState<'suspended' | 'running' | 'closed'>('suspended');
  const [isLive, setIsLive] = useState(false);
  const [currentImage, setCurrentImage] = useState(INITIAL_IMAGE);
  const [history, setHistory] = useState<{ image: string; objects: typeof INTERACTIVE_OBJECTS }[]>([]);
  const [dims, setDims] = useState({ width: BASE_SIZE, height: BASE_SIZE });
  const [mainSize, setMainSize] = useState({ width: 0, height: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [liveTranscription, setLiveTranscription] = useState("");
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
  const [hoveredObject, setHoveredObject] = useState<string | null>(null);
  const hoveredObjectRef = useRef<string | null>(null);

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

  // Refs for logic
  const persistentCanvasRef = useRef<HTMLCanvasElement>(null);
  const traceCanvasRef = useRef<HTMLCanvasElement>(null);
  const mainContainerRef = useRef<HTMLElement>(null);
  const cursorRef = useRef<{x: number, y: number}>({x: 500, y: 500}); // Normalized 0-1000
  const cursorHistoryRef = useRef<{x: number, y: number, t: number, hovered: string | null}[]>([]);
  const markersRef = useRef<Marker[]>([]);
  const sessionRef = useRef<any>(null);
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

  const [sendFrequency, setSendFrequency] = useState(150); // Increased frequency for better AI responsiveness
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState(0); // -1 for left, 1 for right
  const [completedTaskIds, setCompletedTaskIds] = useState<number[]>([]);
  const [mapQuery, setMapQuery] = useState("London");
  const [mapType, setMapType] = useState<'search' | 'directions'>('search');
  const [directions, setDirections] = useState<{ origin: string; destination: string } | null>(null);
  const [layoutBounds, setLayoutBounds] = useState<{
    photos: BBox;
    map: BBox;
    photoItems: { id: number; bbox: BBox }[];
  } | null>(null);

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
        
        const photoItems = Array.from(photosEl.querySelectorAll('.photo-item')).map((el, i) => {
          if (i >= PHOTOS.length) return null;
          return {
            id: PHOTOS[i].id,
            bbox: toBBox((el as HTMLElement).getBoundingClientRect())
          };
        }).filter(Boolean) as { id: number; bbox: BBox }[];
        
        setLayoutBounds({
          photos: toBBox(pRect),
          map: toBBox(mRect),
          photoItems
        });

        // Update interactive objects for Gemini
        const mapBBox = toBBox(mRect);
        const newInteractiveObjects = [
          ...photoItems.map((item) => ({
            name: PHOTOS.find(p => p.id === item.id)?.title || "Photo",
            bbox: [item.bbox.ymin, item.bbox.xmin, item.bbox.ymax, item.bbox.xmax] as [number, number, number, number]
          })),
          {
            name: "Google Maps",
            bbox: [mapBBox.ymin, mapBBox.xmin, mapBBox.ymax, mapBBox.xmax] as [number, number, number, number]
          }
        ];
        setInteractiveObjects(newInteractiveObjects);
        interactiveObjectsRef.current = newInteractiveObjects;

        // Notify AI of the new layout if session is active
        if (sessionRef.current) {
          const layoutInfo = newInteractiveObjects.map(obj => `${obj.name}: [${obj.bbox.map(Math.round).join(', ')}]`).join('\n');
          sessionRef.current.sendRealtimeInput({
            text: `[SYSTEM UPDATE: The gallery photos have been rearranged and now overlap the Google Maps box. Here are their new coordinates (ymin, xmin, ymax, xmax):\n${layoutInfo}\nIMPORTANT: The photos are ON TOP of the map. If the user points at or circles an area that contains both a photo and the map, they are referring to the PHOTO. Use these to identify what the user is pointing at when they say "this" or "here". DO NOT RESPOND TO THIS UPDATE. STAY SILENT UNTIL THE USER SPEAKS.]`
          });
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
  }, [isLive]); // Recalculate when live starts or layout changes

  useEffect(() => {
    const checkDevice = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const minDimension = Math.min(width, height);
      const isPortrait = window.matchMedia('(orientation: portrait)').matches;
      
      // Mobile: smallest dimension < 600px (covers phones in both orientations)
      setShowMobileOverlay(minDimension < 600);
      
      // Tablet range: smallest dimension >= 600px and width <= 1024px
      const isTabletWidth = width >= 600 && width <= 1024;
      setShowRotateOverlay(isPortrait && isTabletWidth);
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  useEffect(() => {
    if (isLive && sessionRef.current) {
      // Focus updates removed to prevent proactive map updates
    }
  }, [hoveredObject, isLive]);

  const mapUrl = mapType === 'search' 
    ? `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`
    : `https://www.google.com/maps?saddr=${encodeURIComponent(directions?.origin || '')}&daddr=${encodeURIComponent(directions?.destination || '')}&output=embed`;

  const allTasksCompleted = completedTaskIds.length === TASKS.length;
  const isCongratulationsPage = currentTaskIndex === TASKS.length;
  const isCurrentTaskDone = !isCongratulationsPage ? completedTaskIds.includes(TASKS[currentTaskIndex].id) : true;

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
    const topObject = interactiveObjectsRef.current.find(obj => {
      const [ymin, xmin, ymax, xmax] = obj.bbox;
      return finalX >= xmin && finalX <= xmax && finalY >= ymin && finalY <= ymax;
    });
    
    const isOnMap = topObject?.name === 'Google Maps';
    
    if (isOnMap) {
      if (!isIdentification && sessionRef.current) {
        sessionRef.current.sendRealtimeInput({
          text: "[SYSTEM: The user tried to point at the map. Tell them: 'That's the map, try pointing at the camera roll instead'.]"
        });
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
        lastMarker.identifiedObject = text;
        // We do NOT update lastMarker.x/y here to keep the user's precise point
        addLog('event', `AI Identified: "${text}" at user's point`);
      } else {
        // Fallback: If no recent user marker, use the AI's suggested coordinates
        const newMarker: Marker = { 
          x: finalX, 
          y: finalY, 
          displayLabel: "THIS", 
          identifiedObject: text, 
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
    
    // Notify the AI that we are starting the generation
    sessionRef.current?.sendRealtimeInput({
      text: `[SYSTEM: Starting image generation for "${cleanEditPrompt}". Please wait for the result before giving further instructions.]`
    });

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
            setHistory(prev => [...prev, { image: currentImgData, objects: [...interactiveObjects] }]);

            ctx.clearRect(0, 0, dims.width, dims.height);
            ctx.drawImage(img, 0, 0, dims.width, dims.height);
            setCurrentImage(pCanvas.toDataURL('image/png'));
            addLog('gemini', 'Canvas evolved.');
            
            // UPDATE MARKING COORDINATES IF MOVED OR REMOVED
            if (marker && objectName) {
              const lowerPrompt = editPrompt.toLowerCase();
              const isRemoval = lowerPrompt.includes("remove") || lowerPrompt.includes("delete") || lowerPrompt.includes("erase");
              
              if (isRemoval) {
                setInteractiveObjects(prev => prev.filter(obj => obj.name !== objectName));
                addLog('info', `Removed "${objectName}" from spatial map.`);
              } else if (dest) {
                setInteractiveObjects(prev => prev.map(obj => {
                  if (obj.name === objectName) {
                    const dx = dest.x - marker.x;
                    const dy = dest.y - marker.y;
                    const [ymin, xmin, ymax, xmax] = obj.bbox;
                    return {
                      ...obj,
                      bbox: [ymin + dy, xmin + dx, ymax + dy, xmax + dx] as [number, number, number, number]
                    };
                  }
                  return obj;
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
            sessionRef.current?.sendRealtimeInput({
              text: `[SYSTEM: IMAGE UPDATED. All previous markers, coordinates, and commands are now OBSOLETE. The scene has changed. Treat the current view as a completely fresh start. Forget all previous locations. DO NOT SPEAK OR ACKNOWLEDGE THIS MESSAGE.]`
            });

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
            sessionRef.current?.sendRealtimeInput({
              text: "[SYSTEM HARD RESET]: The image has evolved. FORGET all previous markers, coordinates, and object positions. The current video frame is the ONLY source of truth. Treat this as a brand new session with a new image. READY FOR NEW COMMAND. DO NOT SPEAK OR GREET THE USER. STAY SILENT UNTIL THE USER SPEAKS."
            });
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
      // Threshold for "laptop/desktop" experience - usually 1024px
      setIsWideEnough(window.innerWidth >= 1024);
    };
    
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  const startLiveSession = async () => {
    if (isLive) return; // Prevent multiple sessions
    lastTranscriptionTimeRef.current = 0;
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        addLog('info', 'Missing GEMINI_API_KEY');
        console.error('Missing GEMINI_API_KEY');
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const msg = "Your browser does not support microphone access or is blocking it. Please use a modern browser like Chrome or Edge over HTTPS.";
        setLastError(msg);
        addLog('info', msg);
        return;
    }

    addLog('info', 'Starting Live Session...');
    try {
      const ai = new GoogleGenAI({ apiKey });
      
      addLog('info', 'Initializing AudioContext...');
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await audioContextRef.current.resume();
      
      addLog('info', 'Requesting Microphone Access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      addLog('info', 'Microphone Access Granted');

      const modelName = 'gemini-2.5-flash-native-audio-preview-12-2025';
      addLog('info', `Connecting to model: ${modelName}`);

      const sessionPromise = ai.live.connect({
        model: modelName,
        callbacks: {
          onopen: () => {
            setIsLive(true);
            addLog('info', 'Live Link Established');
            
            // Set sessionRef.current when connection is open
            sessionPromise.then(session => {
              sessionRef.current = session;
            });

            const inputCtx = new AudioContext({ sampleRate: 16000 });
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            const silentGain = inputCtx.createGain();
            silentGain.gain.value = 0;
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const binary = String.fromCharCode(...new Uint8Array(int16.buffer));
              sessionPromise.then(s => s.sendRealtimeInput({
                audio: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' }
              }));
            };
            source.connect(processor);
            processor.connect(silentGain);
            silentGain.connect(inputCtx.destination);
          },
          onmessage: async (msg) => {
            // Ignore AI responses while overlays are active to prevent background noise from triggering actions
            if (showOnboardingRef.current || showWelcomeRef.current || showRotateOverlayRef.current || showMobileOverlayRef.current) {
              if (msg.toolCall || msg.serverContent?.modelTurn) {
                return;
              }
            }

            // Handle tool calls first to ensure state is ready for model turn
            if (msg.toolCall) {
              if (lastTranscriptionTimeRef.current === 0) {
                addLog('info', 'Ignoring tool call before first transcription');
                return;
              }
              for (const fc of msg.toolCall.functionCalls) {
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
                }
              }
            }

            // Handle model turn (start of response)
            if (msg.serverContent?.modelTurn) {
              if (lastTranscriptionTimeRef.current === 0) {
                addLog('info', 'Ignoring model turn before first transcription');
                return;
              }
              setPersistentPaths([]); // Clear paint when AI starts responding
              setLiveTranscription(""); // Clear transcription when AI starts responding
              lastProcessedTranscriptionRef.current = "";
              const audioData = msg.serverContent.modelTurn.parts?.find(p => p.inlineData)?.inlineData?.data;
              if (audioData) {
                handleLiveAudio(audioData);
              }
            }

            // Handle interruption
            if (msg.serverContent?.interrupted) {
              activeSourcesRef.current.forEach(s => {
                try { s.stop(); } catch(e) {}
              });
              activeSourcesRef.current = [];
              audioQueueRef.current = [];
              nextStartTimeRef.current = 0;
              lastAudioTimeRef.current = 0; // Ensure next audio is treated as a new turn
              setLiveTranscription("");
              lastProcessedTranscriptionRef.current = "";
              addLog('event', 'Model interrupted');
            }

            // Drop marker if user says keyword (Manual fallback with slight lookback)
            if (msg.serverContent?.inputTranscription) {
              const text = msg.serverContent.inputTranscription.text;
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
                  if (entry.hovered && entry.hovered !== 'Google Maps') {
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
                
                let foundObject = mostFrequentHovered 
                  ? interactiveObjectsRef.current.find(obj => obj.name === mostFrequentHovered) || null
                  : null;

                if (foundObject) {
                  addLog('info', `Using historical "Purple Text": ${foundObject.name}`);
                }

                // 2. DIRECT PURPLE TEXT CHECK (Only for the very latest keyword if history is sparse)
                if (!foundObject && index === totalKws - 1 && hoveredObjectRef.current && hoveredObjectRef.current !== 'Google Maps') {
                  foundObject = interactiveObjectsRef.current.find(obj => obj.name === hoveredObjectRef.current) || null;
                  if (foundObject) {
                    addLog('info', `Using current "Purple Text" for latest keyword: ${foundObject.name}`);
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
                  foundObject = interactiveObjectsRef.current.find(obj => {
                    const [ymin, xmin, ymax, xmax] = obj.bbox;
                    const padding = 5; // Reduced from 15 for stricter, non-guessy detection
                    return hX >= (xmin - padding) && hX <= (xmax + padding) && hY >= (ymin - padding) && hY <= (ymax + padding);
                  });
                }

                if (foundObject) {
                  // Attach the object name to the marker
                  const lastM = markersRef.current[0];
                  if (lastM && (Date.now() - lastM.timestamp < 1000)) {
                    lastM.identifiedObject = foundObject.name;
                    addLog('info', `Identified: ${foundObject.name}`);
                  }

                  // SEND HINT TO GEMINI (CRITICAL: This was missing!)
                  if (sessionRef.current) {
                    const commandWords = ["show", "go", "directions", "where", "what", "search", "find", "how", "get", "near"];
                    const isCommand = commandWords.some(w => lowerText.includes(w));
                    const hintText = `[USER JUST SAID "${kw.toUpperCase()}" WHILE POINTING AT: ${foundObject.name}. ${isCommand ? "NOTE: This is part of an explicit command." : "NOTE: This is just a mention, stay silent unless they give a command."}]`;
                    sessionRef.current.sendRealtimeInput({ text: hintText });
                  }
                } else {
                  // SEND "NOTHING" HINT TO PREVENT GUESSING
                  if (sessionRef.current) {
                    sessionRef.current.sendRealtimeInput({
                      text: `[USER JUST SAID "${kw.toUpperCase()}" WHILE POINTING AT: Nothing (Empty Space). Ask them to point at a photo or the map.]`
                    });
                  }
                }

                // AGENT 1: SPATIAL ANALYST REMOVED
                // (This was for image editing which is not used in this map/gallery app)
                if (isDestination) {
                  spatialDescriptionRef.current = null;
                }
              });
            }

            // Audio playback removed as per user request
          },
          onclose: () => {
              setIsLive(false);
              sessionRef.current = null;
              addLog('info', 'Live Link Closed');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          tools: [{
            functionDeclarations: [
              {
                name: 'update_map',
                description: 'Update the map to show a specific location or search for nearby places. ONLY call this tool if the user EXPLICITLY asks you to update the map or search for something verbally.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    query: { type: Type.STRING, description: 'The location name or search query.' }
                  },
                  required: ['query']
                }
              },
              {
                name: 'show_directions',
                description: 'Show directions between two locations on the map. ONLY call this tool if the user EXPLICITLY asks you for directions or how to get somewhere verbally.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    origin: { type: Type.STRING, description: 'The starting location.' },
                    destination: { type: Type.STRING, description: 'The destination location.' }
                  },
                  required: ['origin', 'destination']
                }
              }
            ]
          }],
          systemInstruction: `You are a helpful London tour guide.
CRITICAL: You MUST remain completely silent unless the user has explicitly spoken to you with a clear command or question. Do not initiate conversation, do not greet the user, and do not speak if there is only background noise or silence.
Wait for the user to finish their instructions before responding. 
CRITICAL: Do NOT repeat yourself or say the same sentence twice in a row. If you just said something, do not say it again immediately.
Only speak after being asked to do something. Do not provide intros or ask if there's anything else you can help with.

CRITICAL - RESPONSE STYLE:
- ALWAYS respond in the same language the user uses. If the user speaks in English, you MUST respond in English.
- Keep your verbal responses extremely short and direct.
- Use phrases like "Here's Hyde Park" or "Here's the London Eye" instead of long explanations.
- Avoid filler words like "Perfect", "Sure", "Okay", or "I'm showing you".
- Be concise. One short sentence is usually enough.

CRITICAL - ACTION LOGIC:
- NEVER perform any actions (like updating the map or showing directions) based on just pointing or hovering.
- You MUST wait for an explicit verbal command (e.g., "show me this", "how do I get here", "what is this?", "search for hotels near here") before calling any tools.
- If the user just says a landmark name (e.g., "London Eye") without a command, STAY SILENT. Do not confirm, do not update the map.
- Pointing is ONLY context for when the user speaks.
- If the user is just moving their cursor without speaking, stay silent.
- Once you understand the command, call the tool immediately.
- NEVER proactively update the map or suggest locations. ONLY update the map when the user EXPLICITLY asks you to.
- CRITICAL: When you respond verbally (e.g., "Here's the London Eye"), you MUST double-check that you have also called the 'update_map' or 'show_directions' tool in the same turn. Never just say you are showing something without actually calling the tool.

The user is looking at a gallery of London photos on the left and a Google Map on the right.

MARKERS (Visual Anchors):
- When the user circles an item, a marker labeled M1, M2, etc., is placed at that location.
- These markers are visible in your video feed as gold circles with labels.
- Use these markers to identify specific locations the user is referring to (e.g., "from M1 to M2").
- Markers are persistent until the map is updated or the AI responds.
- CRITICAL: When a new request starts, ignore all previous markers and landmarks. ALWAYS use the most recent visual information and pointing hints.

GALLERY LOCATIONS (Use these names exactly):
- London Eye
- Hyde Park
- Westminster Abbey
- St Pancras Station

USER CAPABILITIES:
1. Point at a photo and ask "show me this on a map". You MUST identify which photo they are pointing at and call update_map(location_name).
2. Point at two photos (e.g., "from here to there") and ask for directions. You MUST track the sequence of pointing and call show_directions(origin, destination).
3. Point at a location (photo or map) and ask for nearby places (e.g., "hotels near here"). You MUST call update_map(query) with a query like "hotels near [Location Name]" or "hotels near [Current Map View]".

CRITICAL - POINTING LOGIC:
- You will receive hints in the format: [USER JUST SAID "THIS" WHILE POINTING AT: Landmark Name].
- When the user says "this", "here", "that", or "there", they are ALWAYS referring to the landmark mentioned in the [USER JUST SAID ...] message that arrived MOST RECENTLY BEFORE or DURING that specific word.
- If the user is pointing at "Google Maps", they are referring to the area currently shown on the map (e.g., "hotels near here" means hotels near the current map view).
- The hints are the ABSOLUTE SOURCE OF TRUTH. If it says "London Eye", the user IS pointing at the London Eye.
- CRITICAL: For directions "from here to there", "here" is the landmark from the hint preceding "here", and "there" is the landmark from the hint preceding "there".
- ALWAYS ignore landmarks from previous requests. Each time the user speaks a new command, start fresh with the pointing hints. Do NOT reuse locations from previous direction requests unless the user explicitly asks to "go back" or "use the same start".
- If the hint says "Nothing (Empty Space)", ask the user to point at a photo.
- Listen carefully to the user's full request and ensure you understand their complete intent before calling any tools. For example, if they are describing a trip, wait until they specify a location they want to see on the map.
- Once the intent is clear, call the tools to update the map. Do not just talk about it.
- ALWAYS provide a verbal response (audio) confirming what you are doing in the SAME turn as the tool call.
- CRITICAL: When you respond verbally (e.g., "Here's the London Eye"), you MUST double-check that you have also called the 'update_map' or 'show_directions' tool in the same turn. Never just say you are showing something without actually calling the tool.
- CRITICAL: After you receive a tool response (success: true), do NOT speak again to confirm that you've done it. One verbal confirmation per action is enough.
- If the user asks for directions, ensure you have both an origin and a destination.
- DO NOT REPEAT YOURSELF. If you just confirmed an action, do not confirm it again.

COORDINATE SYSTEM:
- The entire view is 1000x1000.
- Photos are on the left side.
- The map is on the right side.
- You will receive spatial information about the photos in the interactive objects list.

When the user points and speaks a command, respond cheerfully like a tour guide and use the tools to update the map.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) { 
      let errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Permission denied') || errMsg.includes('NotAllowedError')) {
        errMsg = "Microphone access denied. Please check your browser settings and ensure this site has permission to use your microphone.";
      }
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
          sessionRef.current?.sendToolResponse({
            functionResponses: [{ id: pendingEdit.id, name: pendingEdit.name, response: { result: "ok" } }]
          });
          setPendingEdit(null);
        }
      }

      // Handle Map Updates
      if (pendingMapUpdate) {
        const timeSinceReceived = now - pendingMapUpdate.receivedAt;
        // Snappier for maps: 600ms silence is enough to confirm command end
        if (lastTranscriptionTimeRef.current > 0 && timeSinceTranscription > 600 && timeSinceReceived > 300) {
          if (pendingMapUpdate.type === 'search') {
            setMapType('search');
            setMapQuery(pendingMapUpdate.query!);
          } else {
            setMapType('directions');
            setDirections({ origin: pendingMapUpdate.origin!, destination: pendingMapUpdate.destination! });
          }
          
          // Clear markers and paint so the next "this" is fresh
          markersRef.current = [];
          lastMarkerTimeRef.current = {};
          setPersistentPaths([]);

          sessionRef.current?.sendToolResponse({
            functionResponses: [{ 
              id: pendingMapUpdate.id, 
              name: pendingMapUpdate.name, 
              response: { 
                success: true, 
                query: pendingMapUpdate.query,
                origin: pendingMapUpdate.origin,
                destination: pendingMapUpdate.destination
              } 
            }]
          });
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
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isLive]);

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
      markersRef.current.forEach(m => {
          if (!m.displayLabel) return; // Hide markers without labels (e.g. from painting)
          
          const age = now - m.timestamp;
          // Instant appearance as requested
          const alpha = 1;
          const pulse = Math.sin(age * 0.008) * 8;
          
          // Map 0-1000 back to current canvas pixels
          // We use canvas.width/height directly to avoid stale closures
          const mx = (m.x / 1000) * canvas.width;
          const my = (m.y / 1000) * canvas.height;

          // Glow field (#857FE7 - matching cursor trail)
          const grad = ctx.createRadialGradient(mx, my, 2, mx, my, 35 + pulse);
          grad.addColorStop(0, `rgba(255, 230, 0, ${alpha * 0.6})`);
          grad.addColorStop(1, `rgba(255, 230, 0, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(mx, my, 35 + pulse, 0, Math.PI * 2);
          ctx.fill();

          // Fireflies
          for(let i=0; i<8; i++) {
            const orbit = 12 + Math.sin(age * 0.003 + i) * 10;
            const px = mx + Math.cos(age * 0.004 + i) * orbit;
            const py = my + Math.sin(age * 0.004 + i * 1.2) * orbit;
            ctx.beginPath();
            ctx.arc(px, py, 1.2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 200, ${alpha})`;
            ctx.shadowBlur = 8;
            ctx.shadowColor = "yellow";
            ctx.fill();
          }
          ctx.shadowBlur = 0; // Reset shadow after fireflies

          // Label - disappears after 2 seconds
          if (age < 2000 && m.displayLabel) {
            ctx.shadowBlur = 0;
            const label = m.displayLabel.toUpperCase();
            ctx.font = "bold 9px 'Roboto Mono', monospace";
            const textMetrics = ctx.measureText(label);
            const px = 6;
            const py = 3;
            const bw = textMetrics.width + px * 2;
            const bh = 9 + py * 2;
            const bx = mx - bw / 2;
            const by = my - 40;

            // Rounded Box (#1a1a1a)
            ctx.fillStyle = `rgba(26, 26, 26, ${alpha})`; 
            ctx.beginPath();
            const r = 4;
            ctx.roundRect(bx, by, bw, bh, r);
            ctx.fill();

            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, mx, by + bh / 2);
          }
        });

      // Draw Interactive Object Markings if enabled
      // Keep markings visible during processing for context
      if (showMarkings) {
        interactiveObjects.forEach(obj => {
          const [ymin, xmin, ymax, xmax] = obj.bbox;
          const x = (xmin / 1000) * canvas.width;
          const y = (ymin / 1000) * canvas.height;
          const w = ((xmax - xmin) / 1000) * canvas.width;
          const h = ((ymax - ymin) / 1000) * canvas.height;

          ctx.strokeStyle = 'rgba(133, 127, 231, 0.8)';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(x, y, w, h);
          ctx.setLineDash([]);

          // Label
          ctx.fillStyle = 'rgba(133, 127, 231, 0.8)';
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
    const found = interactiveObjectsRef.current.find(obj => {
      const [ymin, xmin, ymax, xmax] = obj.bbox;
      return hX >= xmin && hX <= xmax && hY >= ymin && hY <= ymax;
    });
    const hovered = found ? found.name : null;
    setHoveredObject(hovered);
    hoveredObjectRef.current = hovered;

    // Only add to history if distance is enough (MIN_DISTANCE) to reduce jitter
    const lastPoint = cursorHistoryRef.current[cursorHistoryRef.current.length - 1];
    if (lastPoint) {
      const dx = x - lastPoint.x;
      const dy = y - lastPoint.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MIN_DISTANCE) return;
    }

    cursorHistoryRef.current.push({ x, y, t: now, hovered });
    
    if (isPainting && hovered !== 'Google Maps') {
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
    let isActuallyOnMap = hoveredObjectRef.current === 'Google Maps';
    
    if (rect) {
      const x = ((e.clientX - rect.left) / rect.width) * 1000;
      const y = ((e.clientY - rect.top) / rect.height) * 1000;
      const found = interactiveObjectsRef.current.find(obj => {
        const [ymin, xmin, ymax, xmax] = obj.bbox;
        return x >= xmin && x <= xmax && y >= ymin && y <= ymax;
      });
      isActuallyOnMap = found?.name === 'Google Maps';
    }

    if (isActuallyOnMap) {
      if (sessionRef.current) {
        sessionRef.current.sendRealtimeInput({
          text: "[SYSTEM: The user tried to interact with the map directly. Tell them: 'That's the map, try pointing at the camera roll instead'.]"
        });
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
    if (pointerPath.length > 5 && hoveredObjectRef.current) {
      // Add to persistent paths so it stays visible while speaking
      setPersistentPaths(prev => [...prev, pointerPath.map(p => ({ x: p.x, y: p.y }))]);

      const hoveredName = hoveredObjectRef.current;
      const found = interactiveObjectsRef.current.find(obj => obj.name === hoveredName);
      
      if (found) {
        let content = currentImage;
        if (found.name !== "Google Maps") {
          const photo = PHOTOS.find(p => p.title === found.name);
          if (photo) content = photo.url;
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
          
          // Send a hint to Gemini about the marker
          if (sessionRef.current) {
            const markerIndex = markersRef.current.length; // Approximate index
            sessionRef.current.sendRealtimeInput({
              text: `[SYSTEM: User circled an area on ${hoveredName} and a marker M${markerIndex} has been placed at [${Math.round(centerX)}, ${Math.round(centerY)}].]`
            });
          }

          // 3. Send to Gemini Live Session
          if (sessionRef.current) {
            const [mime, data] = croppedUrl.split(',');
            const mimeType = mime.split(':')[1].split(';')[0];

            addLog('gemini', `Sending circled region of ${hoveredName} to Gemini`);

            // Send the image as a "turn" in the conversation
            sessionRef.current.sendClientContent({
              turns: [{
                role: "user",
                parts: [
                  { text: `[SYSTEM] The user just circled this region on ${hoveredName}. Focus on it.` },
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

  // Vision pipeline
  useEffect(() => {
    if (!isLive) return;
    
    // AI Vision doesn't need full resolution. 400x400 is plenty and much faster to encode.
    const VISION_SIZE = 400;
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = VISION_SIZE; 
    offscreenCanvas.height = VISION_SIZE;
    const ctx = offscreenCanvas.getContext('2d', { alpha: false });

    const interval = setInterval(() => {
      if (!ctx || !layoutBounds) return;
      
      // Clear and draw background
      ctx.fillStyle = '#f8f9fc';
      ctx.fillRect(0, 0, VISION_SIZE, VISION_SIZE);

      // Draw Photos Box
      const p = layoutBounds.photos;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e5e5e5';
      ctx.lineWidth = 1;
      ctx.fillRect((p.xmin/1000)*VISION_SIZE, (p.ymin/1000)*VISION_SIZE, ((p.xmax-p.xmin)/1000)*VISION_SIZE, ((p.ymax-p.ymin)/1000)*VISION_SIZE);
      ctx.strokeRect((p.xmin/1000)*VISION_SIZE, (p.ymin/1000)*VISION_SIZE, ((p.xmax-p.xmin)/1000)*VISION_SIZE, ((p.ymax-p.ymin)/1000)*VISION_SIZE);

      // Draw Photo Items
      layoutBounds.photoItems.forEach((item, i) => {
        const b = item.bbox;
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect((b.xmin/1000)*VISION_SIZE, (b.ymin/1000)*VISION_SIZE, ((b.xmax-b.xmin)/1000)*VISION_SIZE, ((b.ymax-b.ymin)/1000)*VISION_SIZE);
        ctx.strokeRect((b.xmin/1000)*VISION_SIZE, (b.ymin/1000)*VISION_SIZE, ((b.xmax-b.xmin)/1000)*VISION_SIZE, ((b.ymax-b.ymin)/1000)*VISION_SIZE);
        
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(PHOTOS[i].title, ((b.xmin+b.xmax)/2000)*VISION_SIZE, ((b.ymin+b.ymax)/2000)*VISION_SIZE);
      });

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

      // Encode and send - use toBlob (async) to avoid blocking the main thread
      offscreenCanvas.toBlob((blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          sessionRef.current?.sendRealtimeInput({ video: { data: base64, mimeType: 'image/jpeg' } });
        };
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.6);
    }, sendFrequency);
    return () => clearInterval(interval);
  }, [isLive, sendFrequency, dims, layoutBounds]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (transcriptionTimeoutRef.current) clearTimeout(transcriptionTimeoutRef.current);
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
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
        setInteractiveObjects(INTERACTIVE_OBJECTS);
        setHistory([]); // Clear history on full reset
        addLog('info', 'Canvas Reset.');
        // Clear markers on reset
        markersRef.current = [];
        lastMarkerTimeRef.current = {};
      }
    }
  };

  const handleReset = () => {
    setHistory([]);
    setPersistentPaths([]);
    setPointerPath([]);
    setInteractiveObjects(INTERACTIVE_OBJECTS);
    setMapQuery("London");
    setMapType('search');
    setDirections(null);
    
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
        <p className="text-[#64748b] dark:text-slate-400 text-xl max-w-lg leading-relaxed">
          please make this window wider and make sure to use a laptop or desktop device.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-screen bg-[var(--bg-color)] bg-dots text-[var(--text-primary)] overflow-hidden font-sans selection:bg-indigo-500/30 ${isLive ? 'custom-cursor-active' : ''}`}>
      <div className="flex-1 flex flex-row overflow-hidden custom-scrollbar">
        <main 
          ref={mainContainerRef} 
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="flex-1 flex flex-row items-center lg:justify-start justify-center p-2 sm:p-4 lg:p-8 lg:pl-24 relative gap-2 lg:gap-0"
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
          {/* Photos Box */}
          <div className="photos-box flex flex-col flex-1 min-w-0 lg:max-w-[700px] aspect-[2/3] relative z-10">
            <div className="flex flex-col bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-2 sm:p-4 overflow-hidden w-full h-full">
              <div className="flex items-center justify-between mb-4 sm:mb-8">
                <div className="flex flex-col">
                  <h3 className="text-xs sm:text-sm font-semibold text-[var(--text-primary)]">Camera roll</h3>
                </div>
                <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <Plus size={20} className="opacity-50" />
                  <MoreVertical size={20} className="opacity-50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 overflow-y-auto pr-2 custom-scrollbar flex-1">
                {PHOTOS.map(photo => (
                  <div key={photo.id} className="photo-item aspect-[3/4] rounded-lg overflow-hidden border border-[var(--card-border)] bg-[var(--card-bg)] transition-all duration-300 cursor-pointer shadow-sm">
                    <img src={photo.url} alt={photo.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" draggable="false" />
                  </div>
                ))}
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
              className={`relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden w-full h-full transition-all duration-300 ${hoveredObject === 'Google Maps' ? 'ring-4 ring-[var(--accent-color)]/10 dark:ring-[var(--accent-color)]/20' : ''}`}
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
        <aside id="sidebar-section" className="w-[300px] sm:w-[350px] lg:w-[400px] p-3 lg:p-6 flex flex-col gap-4 shrink-0 h-full overflow-hidden">
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
                  <div className="flex gap-1">
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
                      You've completed all 3 tasks.<br />
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
                  onClick={() => sessionRef.current?.close()}
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
            </div>
          </section>

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
