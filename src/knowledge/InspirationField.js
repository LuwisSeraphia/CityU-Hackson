/** Free-moving circles, kept within their own canvas. No grid or fixed tracks. */
export function createBubbleLayout(width, height, count, random = Math.random) {
  const compact = width < 500;
  const bubbles = [];
  for (let i = 0; i < count; i++) {
    const size = Math.min(width - 16, (compact ? 78 : 108) + random() * (compact ? 48 : 100));
    const radius = size / 2;
    let best, bestClearance = -Infinity;
    for (let attempt = 0; attempt < 160; attempt++) {
      const candidate = { x: radius + 8 + random() * Math.max(0, width - size - 16), y: radius + 8 + random() * Math.max(0, height - size - 16) };
      const clearance = bubbles.length ? Math.min(...bubbles.map(b => Math.hypot(candidate.x - b.x, candidate.y - b.y) - radius - b.radius)) : 0;
      if (clearance > bestClearance) { best = candidate; bestClearance = clearance; }
      if (clearance > 20) break;
    }
    const angle = random() * Math.PI * 2;
    bubbles.push({ ...best, radius, vx: Math.cos(angle) * 12, vy: Math.sin(angle) * 12, phase: random() * Math.PI * 2 });
  }
  return bubbles;
}

export function advanceBubbles(bubbles, width, height, delta, time, frozen = -1) {
  for (let i = 0; i < bubbles.length; i++) {
    if (i === frozen) continue;
    const b = bubbles[i];
    b.vx += Math.sin(time * .24 + b.phase) * delta * 3;
    b.vy += Math.cos(time * .19 + b.phase) * delta * 3;
    for (let j = 0; j < bubbles.length; j++) {
      if (i === j) continue;
      const other = bubbles[j], dx = b.x - other.x, dy = b.y - other.y;
      const distance = Math.hypot(dx, dy) || .01;
      const separation = b.radius + other.radius + 14;
      if (distance < separation) {
        const force = Math.min(30, (separation - distance) * 2);
        b.vx += dx / distance * force * delta;
        b.vy += dy / distance * force * delta;
      }
    }
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 18) { b.vx *= 18 / speed; b.vy *= 18 / speed; }
    b.x += b.vx * delta; b.y += b.vy * delta;
    const pad = b.radius + 5;
    if (b.x < pad) { b.x = pad; b.vx = Math.abs(b.vx); }
    if (b.x > width - pad) { b.x = width - pad; b.vx = -Math.abs(b.vx); }
    if (b.y < pad) { b.y = pad; b.vy = Math.abs(b.vy); }
    if (b.y > height - pad) { b.y = height - pad; b.vy = -Math.abs(b.vy); }
  }
}

export class InspirationField {
  constructor(field) {
    this.field = field; this.slots = [...field.querySelectorAll('.bubble-slot')];
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.resize = () => {
      const width = field.clientWidth;
      if (!width || width === this.width) return;
      this.width = width;
      this.height = Math.max(480, Math.min(760, innerHeight * .7), Math.ceil(this.slots.length / Math.max(2, Math.floor(width / 210))) * (width < 500 ? 165 : 215));
      field.style.height = `${this.height}px`;
      this.bubbles = createBubbleLayout(width, this.height, this.slots.length);
      this.paint();
    };
    this.observer = new ResizeObserver(this.resize); this.observer.observe(field); this.resize();
    const tick = now => {
      if (!field.isConnected) return;
      const delta = Math.min(.04, (now - (this.last || now)) / 1000); this.last = now;
      if (!this.motion.matches && !document.hidden && this.bubbles) {
        const frozen = this.slots.findIndex(s => s.matches(':hover, :focus-within'));
        advanceBubbles(this.bubbles, this.width, this.height, delta, now / 1000, frozen);
        this.paint();
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  paint() {
    this.bubbles.forEach((b, i) => {
      const slot = this.slots[i];
      slot.style.width = `${b.radius * 2}px`; slot.style.height = `${b.radius * 2}px`;
      slot.style.transform = `translate3d(${b.x - b.radius}px,${b.y - b.radius}px,0)`;
      slot.style.setProperty('--depth', String((b.radius - 40) / 100));
    });
  }
  dispose() { cancelAnimationFrame(this.frame); this.observer.disconnect(); }
}
