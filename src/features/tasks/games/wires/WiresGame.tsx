import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Copy } from '../../../../i18n';
import { useFlash } from '../../../../lib/useFlash';
import TaskFrame from '../TaskFrame';
import type { TaskGameProps } from '../types';
import games from '../games.module.css';
import styles from './wires.module.css';

type Point = { x: number; y: number };
type Drag = { left: number; start: Point; at: Point; moved: boolean; over: number | null };
// A gentle horizontal S-curve, like a cable hanging between two plugs.
const cable = (from: Point, to: Point) => {
  const bend = Math.max(40, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
};

// Drag a wire onto the socket of the same colour. Tapping (or keyboard: Enter on
// a wire, then on a socket) does the same, so dragging is never required.
export default function WiresGame({ puzzle, t, disabled, onSubmit }: TaskGameProps<'wires'>) {
  const board = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [pairs, setPairs] = useState<Record<number, number>>({});
  const [wrong, flashWrong, clearWrong] = useFlash<number>(700);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [anchors, setAnchors] = useState<{ left: Point[]; right: Point[] }>({ left: [], right: [] });
  const colour = (name: string) => t[`colour_${name}` as keyof Copy];
  const complete = Object.keys(pairs).length === puzzle.left.length;

  // Measure plug and socket centres so cables follow the layout at any width or text size.
  useLayoutEffect(() => {
    const element = board.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const centres = (selector: string) => [...element.querySelectorAll(selector)].map(node => {
        const rect = node.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - box.left, y: rect.top + rect.height / 2 - box.top };
      });
      setAnchors({ left: centres('[data-plug]'), right: centres('[data-socket-dot]') });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (complete) onSubmit(puzzle.left.map((_, index) => pairs[index]));
  }, [complete]);

  function connect(left: number, right: number) {
    setSelected(null);
    if (left in pairs || Object.values(pairs).includes(right)) return;
    if (puzzle.right[right] !== puzzle.left[left]) { flashWrong(right); return; }
    clearWrong();
    setPairs({ ...pairs, [left]: right });
  }
  const point = (event: React.PointerEvent): Point => {
    const box = board.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const socketAt = (event: React.PointerEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-socket]');
    return target ? Number(target.dataset.socket) : null;
  };

  function startDrag(event: React.PointerEvent, left: number) {
    if (disabled || left in pairs || event.button !== 0) return;
    board.current!.setPointerCapture(event.pointerId);
    const at = point(event);
    setDrag({ left, start: at, at, moved: false, over: null });
  }
  function moveDrag(event: React.PointerEvent) {
    if (!drag) return;
    const at = point(event);
    const moved = drag.moved || Math.hypot(at.x - drag.start.x, at.y - drag.start.y) > 8;
    setDrag({ ...drag, at, moved, over: moved ? socketAt(event) : null });
  }
  function endDrag(event: React.PointerEvent) {
    if (!drag) return;
    setDrag(null);
    if (!drag.moved) { setSelected(drag.left); return; }
    const right = socketAt(event);
    if (right !== null) connect(drag.left, right);
  }

  const linkedRight = new Set(Object.values(pairs));
  const status = wrong !== null ? t.wiresWrong
    : selected !== null ? `${colour(puzzle.left[selected])} · ${t.wiresPickSocket}`
    : `${Object.keys(pairs).length} / ${puzzle.left.length}`;
  return <TaskFrame instructions={t.wiresInstructions} error={wrong !== null} status={status}>
    <div ref={board} className={`${games.board} ${styles.wireBoard}`} data-complete={complete || undefined}
      onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
      <svg className={styles.wireLayer} aria-hidden="true">
        {Object.entries(pairs).map(([left, right]) => anchors.left[+left] && anchors.right[right] &&
          <path key={left} d={cable(anchors.left[+left], anchors.right[right])} style={{ stroke: `var(--color-wire-${puzzle.left[+left]})` }}/>)}
        {drag?.moved && anchors.left[drag.left] &&
          <path data-live d={cable(anchors.left[drag.left], drag.at)} style={{ stroke: `var(--color-wire-${puzzle.left[drag.left]})` }}/>}
      </svg>
      <div role="group" aria-label={t.wiresLeft} className={styles.wireColumn}>
        {puzzle.left.map((name, index) => <button key={name} type="button" className={styles.wireEnd} data-wire={name}
          aria-pressed={selected === index} data-connected={index in pairs || undefined} data-dragging={drag?.left === index || undefined}
          aria-label={index in pairs ? `${colour(name)}, ${t.wireConnected}` : colour(name)}
          disabled={disabled || index in pairs}
          onPointerDown={event => startDrag(event, index)}
          onClick={event => { if (event.detail === 0) setSelected(selected === index ? null : index); }}>
          <span>{colour(name)}</span><i data-plug aria-hidden="true"/>
        </button>)}
      </div>
      <div role="group" aria-label={t.wiresRight} className={styles.wireColumn}>
        {puzzle.right.map((name, index) => <button key={name} type="button" className={styles.wireSocket} data-wire={name} data-socket={index}
          data-connected={linkedRight.has(index) || undefined} data-wrong={wrong === index || undefined}
          data-over={drag?.over === index || undefined}
          aria-label={linkedRight.has(index) ? `${colour(name)}, ${t.wireConnected}` : colour(name)}
          disabled={disabled || linkedRight.has(index)}
          onClick={() => { if (selected !== null) connect(selected, index); }}>
          <i data-socket-dot aria-hidden="true"/><span>{colour(name)}</span>
        </button>)}
      </div>
    </div>
  </TaskFrame>;
}
