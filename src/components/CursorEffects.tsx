import React, { useEffect, useState, useRef, useMemo } from 'react';

// --- TYPES ---
export interface Position { x: number; y: number; }
export interface TrailPoint extends Position { id: number; timestamp: number; }

// --- CURSOR RESOURCES (Gradients) ---
export const CursorResources: React.FC<{ mode: 'off' | 'painting'; color?: string }> = ({ mode, color }) => (
    <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
        <defs>
            <radialGradient id="trail-gradient" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor="white" stopOpacity="1" />
                <stop offset="60%" stopColor="white" stopOpacity={mode === 'painting' ? 1.0 : 0.6} />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="gradient-trail" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={color || "#1A73E8"} stopOpacity="0.2" />
                <stop offset="50%" stopColor={color ? `${color}80` : "#8AB4F8"} stopOpacity="0.8" />
                <stop offset="100%" stopColor={color || "#1A73E8"} stopOpacity="1.0" />
            </linearGradient>
        </defs>
    </svg>
);

// --- CURSOR TRAIL ---
const MIN_DISTANCE = 4;      // px - Higher = smoother, less jitter
const MAX_POINTS = 300;      // Hard limit for performance
const BASE_LIFETIME = 2500;  // ms - How long the paint stays visible

export const CursorTrail: React.FC<{ isActive: boolean; mousePos: Position; color?: string }> = ({ isActive, mousePos, color }) => {
    const [trail, setTrail] = useState<TrailPoint[]>([]);
    const positionRef = useRef<Position>(mousePos);
    const trailRef = useRef<TrailPoint[]>([]);
    const requestRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    const maskCircleRef = useRef<SVGCircleElement>(null);

    useEffect(() => { positionRef.current = mousePos; }, [mousePos]);

    useEffect(() => {
        const animate = () => {
            const now = Date.now();
            lastTimeRef.current = now;

            if (!isActive) {
                if (trailRef.current.length > 0) {
                    setTrail([]);
                    trailRef.current = [];
                }
                requestRef.current = requestAnimationFrame(animate);
                return;
            }

            const currentPos = positionRef.current;
            const lastPoint = trailRef.current[trailRef.current.length - 1];
            const dist = lastPoint ? Math.hypot(currentPos.x - lastPoint.x, currentPos.y - lastPoint.y) : 10;

            // Update Mask Position (for the fading "glow" at the tip)
            if (maskCircleRef.current) {
                maskCircleRef.current.setAttribute('cx', currentPos.x.toString());
                maskCircleRef.current.setAttribute('cy', currentPos.y.toString());
            }

            // Add points if moved enough
            if (!lastPoint || dist > MIN_DISTANCE) {
                trailRef.current.push({ ...currentPos, id: now, timestamp: now });
            }

            // Prune old points
            const finalTrail = trailRef.current
                .filter(p => now - p.timestamp < BASE_LIFETIME)
                .slice(-MAX_POINTS);

            if (finalTrail.length !== trailRef.current.length || finalTrail.length > 0) {
                trailRef.current = finalTrail;
                setTrail([...finalTrail]);
            }

            requestRef.current = requestAnimationFrame(animate);
        };

        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current);
    }, [isActive]);

    // Generate Smooth Path (Quadratic Bezier Spline)
    const pathData = useMemo(() => {
        const points = [...trail, positionRef.current];
        if (points.length < 2) return '';
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            d += ` Q ${p1.x} ${p1.y} ${midX} ${midY}`;
        }
        d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
        return d;
    }, [trail]);

    if (!isActive) return null;

    return (
        <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none z-[9900]">
            <defs>
                <mask id="cursor-mask" maskUnits="userSpaceOnUse">
                    <circle ref={maskCircleRef} cx="0" cy="0" r="80" fill="url(#trail-gradient)" />
                </mask>
            </defs>
            <path
                d={pathData}
                fill="none"
                stroke="url(#gradient-trail)"
                strokeWidth="16"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: 'blur(4px)' }}
            />
        </svg>
    );
};
