import { useRef } from 'react';

// The phone's legs: a fixed virtual stick in the lower-left corner. It only
// writes into `inputRef` — the world reads that ref every frame, so no state
// and no re-renders happen at touch rate.
export default function Joystick({ inputRef }) {
  const pad = useRef(null);
  const knob = useRef(null);
  const active = useRef(null);

  const put = (dx, dy) => {
    if (knob.current) knob.current.style.transform = `translate(${dx * 36}px, ${dy * 36}px)`;
  };

  const read = (e) => {
    const r = pad.current.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    inputRef.current = { x: dx, y: -dy };
    put(dx, dy);
  };

  const down = (e) => {
    e.preventDefault();
    active.current = e.pointerId;
    // synthetic pointers (tests) and already-lifted fingers have no capture
    try { pad.current.setPointerCapture(e.pointerId); } catch { /* fine */ }
    read(e);
  };
  const move = (e) => {
    if (active.current !== e.pointerId) return;
    read(e);
  };
  const up = (e) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    inputRef.current = { x: 0, y: 0 };
    put(0, 0);
  };

  return (
    <div
      ref={pad}
      className="stick"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div ref={knob} className="stick-knob" />
    </div>
  );
}
