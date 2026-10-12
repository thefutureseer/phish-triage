import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from '@/components/video/VideoTemplate';
import { useSceneControls } from '@/components/video/useSceneControls';
import { SCENE_DETAILS } from '@/components/video/sceneMeta';
const PROGRESS_TICK_MS = 60;

function formatPlaybackTime(durationMs: number) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function PlaybackStatus({
  sceneKeys, activeIndex, activeDuration, activeStartTime, totalDuration, tick, paused, onJumpTo,
}: {
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  activeStartTime: number;
  totalDuration: number;
  tick: number;
  paused: boolean;
  onJumpTo: (index: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const elapsedBaseRef = useRef(0);
  useEffect(() => {
    setElapsed(0);
    elapsedBaseRef.current = 0;
  }, [tick]);
  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(elapsedBaseRef.current + performance.now() - start), PROGRESS_TICK_MS);
    return () => {
      window.clearInterval(id);
      elapsedBaseRef.current += performance.now() - start;
    };
  }, [tick, paused]);
  const progress = activeDuration ? Math.min(1, elapsed / activeDuration) : 0;
  const totalElapsed = Math.min(totalDuration, activeStartTime + Math.min(elapsed, activeDuration));
  return (
    <>
      <div className="control-segments">
        {sceneKeys.map((key, index) => (
          <button key={key} className="control-segment" onClick={() => onJumpTo(index)} aria-label={`Jump to scene ${index + 1}`} aria-current={index === activeIndex ? 'true' : undefined}>
            <span style={{ width: `${index === activeIndex ? progress * 100 : index < activeIndex ? 100 : 0}%` }} />
          </button>
        ))}
      </div>
      <span className="control-counter">{activeIndex + 1}/{sceneKeys.length}</span>
      <span className="control-time" role="timer">{formatPlaybackTime(totalElapsed)} / {formatPlaybackTime(totalDuration)}</span>
    </>
  );
}

function announceSceneSelection(index: number, sceneKeys: string[]) {
  const details = SCENE_DETAILS[sceneKeys[index] as keyof typeof SCENE_DETAILS];
  if (!details?.filePath) return;
  window.parent.postMessage({
    type: 'REPLIT_VIDEO_SCENE_SELECTED',
    payload: { sceneIndex: index, sceneCount: sceneKeys.length, sceneTitle: details.title, filePath: details.filePath, lineNumber: 1 },
  }, '*');
}

function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  const [muted, setMuted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const sensorRef = useRef<HTMLDivElement | null>(null);
  const control = useSceneControls(SCENE_DURATIONS);
  const handleToggleCollapsed = useCallback(() => {
    setCollapsed((value) => !value);
    setHovering(false);
    setTapPinned(false);
  }, []);
  const handleJumpTo = useCallback((index: number) => {
    control.jumpTo(index);
    announceSceneSelection(index, control.sceneKeys);
  }, [control.jumpTo, control.sceneKeys]);
  useEffect(() => {
    if (!control.paused) return;
    const frozen = document.getAnimations().filter((animation) => animation.playState === 'running');
    frozen.forEach((animation) => animation.pause());
    return () => frozen.forEach((animation) => animation.play());
  }, [control.paused]);
  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const onDocPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      if (sensorRef.current && !sensorRef.current.contains(event.target as Node)) setTapPinned(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [collapsed, tapPinned]);

  if (!isIframed) return <VideoTemplate />;
  const barVisible = !collapsed || hovering || tapPinned;
  return (
    <div className="video-frame">
      <VideoTemplate key={control.mountKey} durations={control.durations} paused={control.paused} muted={muted} onSceneChange={control.onSceneChange} />
      <div
        ref={sensorRef}
        className="controls-sensor"
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovering(true); }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHovering(false); }}
        onPointerDown={(event) => { if (event.pointerType !== 'mouse' && collapsed) setTapPinned(true); }}
      >
        <div className="controls-sensor-filler" aria-hidden="true" />
        <div className={`player-controls ${barVisible ? 'controls-visible' : 'controls-hidden'}`} aria-hidden={!barVisible}>
        <button className="control-icon" onClick={control.togglePause} aria-label={control.paused ? 'Play' : 'Pause'} title={control.paused ? 'Play' : 'Pause'}>{control.paused ? <Play /> : <Pause />}</button>
        <button className={`control-icon ${control.locked ? 'is-active' : ''}`} onClick={control.toggleLock} aria-label={control.locked ? 'Loop current scene: on' : 'Loop current scene: off'} aria-pressed={control.locked} title="Loop current scene"><Repeat /></button>
        <button className="control-icon" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute audio' : 'Mute audio'} title={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX /> : <Volume2 />}</button>
        <i className="control-divider" />
        <PlaybackStatus
          sceneKeys={control.sceneKeys}
          activeIndex={control.activeIndex}
          activeDuration={control.activeDuration}
          activeStartTime={control.activeStartTime}
          totalDuration={control.totalDuration}
          tick={control.tick}
          paused={control.paused}
          onJumpTo={handleJumpTo}
        />
        <button className="control-icon control-chevron" onClick={handleToggleCollapsed} aria-label={collapsed ? 'Show controls' : 'Hide controls'} aria-expanded={!collapsed} title={collapsed ? 'Show controls' : 'Hide controls'}>{collapsed ? <ChevronUp /> : <ChevronDown />}</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <VideoWithControls />;
}
