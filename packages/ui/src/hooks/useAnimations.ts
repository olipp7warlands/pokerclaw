import { useState, useCallback, useRef } from "react";

export type Speed = 1 | 2 | 5;

export interface AnimationItem {
  id: string;
  type: string;
  payload: unknown;
}

export function useAnimations() {
  const [speed, setSpeed] = useState<Speed>(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [queue, setQueue] = useState<AnimationItem[]>([]);
  const idCounter = useRef(0);

  const enqueue = useCallback((type: string, payload: unknown) => {
    const id = String(++idCounter.current);
    setQueue((q) => [...q, { id, type, payload }]);
  }, []);

  const dequeue = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  const clear = useCallback(() => {
    setQueue([]);
  }, []);

  const animDuration = useCallback(
    (baseMsecs: number) => baseMsecs / speed,
    [speed]
  );

  return {
    speed,
    setSpeed,
    isPlaying,
    setIsPlaying,
    queue,
    enqueue,
    dequeue,
    clear,
    animDuration,
  };
}
