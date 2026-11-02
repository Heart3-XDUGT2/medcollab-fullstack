import type { RealtimeClient, RealtimeMember } from './realtimeClient';

/** Patient-space cursors and ghost trails, isolated from the authoritative labelmap pixels. */
export class CollaborationOverlay {
  private canvases = new Map<any, HTMLCanvasElement>();
  private members: RealtimeMember[] = [];
  private trails = new Map<string, { points: number[][]; at: number; username: string }>();
  private lastSent = 0;
  private stroke: number[][] = [];
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private runtime: any,
    private client: RealtimeClient,
    private self: string,
    private canEdit: () => boolean
  ) {
    document.addEventListener('pointermove', this.move, true);
    document.addEventListener('pointerup', this.up, true);
    this.timer = setInterval(() => this.paint(), 150);
  }
  update(members: RealtimeMember[]) {
    this.members = members;
    this.paint();
  }
  preview(payload: any) {
    if (payload.subject === this.self || !Array.isArray(payload.points)) return;
    const points = payload.points.filter(
      point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)
    );
    this.trails.set(payload.subject, {
      points,
      at: Date.now(),
      username: String(payload.username || ''),
    });
    this.paint();
  }
  committed(subject: string) {
    this.trails.delete(subject);
    this.paint();
  }
  private viewports(): any[] {
    const { viewportGridService, cornerstoneViewportService } =
      this.runtime.servicesManager.services;
    return [...viewportGridService.getState().viewports.keys()]
      .map(id => {
        try {
          return cornerstoneViewportService.getCornerstoneViewport(id);
        } catch {
          return null;
        }
      })
      .filter(viewport => viewport?.element && viewport?.canvasToWorld && viewport?.worldToCanvas);
  }
  private move = (event: PointerEvent) => {
    if (Date.now() - this.lastSent < 50) return;
    this.lastSent = Date.now();
    const viewport = this.viewports().find(vp => vp.element.contains(event.target));
    if (!viewport) {
      this.client.setCursor(null);
      return;
    }
    const rect = viewport.element.getBoundingClientRect();
    const world = Array.from(
      viewport.canvasToWorld([event.clientX - rect.left, event.clientY - rect.top])
    ) as number[];
    if (world.length !== 3 || !world.every(Number.isFinite)) return;
    this.client.setCursor({ world });
    const group = this.runtime.servicesManager.services.toolGroupService.getToolGroupForViewport(
      viewport.id
    );
    const tool = group?.getActivePrimaryMouseButtonTool?.() || '';
    if (event.buttons === 1 && this.canEdit() && /Brush|Eraser|Paint/.test(tool)) {
      this.stroke.push(world);
      this.stroke = this.stroke.slice(-32);
      this.client.preview(this.stroke);
    } else this.stroke = [];
  };
  private up = () => {
    this.stroke = [];
  };
  private point(viewport: any, world: number[]) {
    const camera = viewport.getCamera?.(),
      origin = camera?.focalPoint,
      normal = camera?.viewPlaneNormal;
    if (!origin || !normal) return null;
    const distance = world.reduce((sum, value, i) => sum + (value - origin[i]) * normal[i], 0);
    const spacing = viewport.getImageData?.()?.spacing;
    if (Math.abs(distance) > Math.max(0.5, ...(spacing || [1])) / 2) return null;
    const point = viewport.worldToCanvas(world);
    return point?.every(Number.isFinite) ? point : null;
  }
  private color(subject: string) {
    let hash = 0;
    for (const char of subject) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 85% 65%)`;
  }
  private paint() {
    const views = this.viewports(),
      active = new Set(views.map(v => v.element));
    for (const [element, canvas] of this.canvases)
      if (!active.has(element)) {
        canvas.remove();
        this.canvases.delete(element);
      }
    for (const [subject, trail] of this.trails)
      if (Date.now() - trail.at > 2000) this.trails.delete(subject);
    for (const viewport of views) {
      let canvas = this.canvases.get(viewport.element);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        Object.assign(canvas.style, {
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: '15',
        });
        viewport.element.appendChild(canvas);
        this.canvases.set(viewport.element, canvas);
      }
      const rect = viewport.element.getBoundingClientRect(),
        ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.font = '12px sans-serif';
      for (const member of this.members) {
        if (member.subject === this.self || !member.online || !member.cursor?.world) continue;
        const point = this.point(viewport, member.cursor.world);
        if (!point) continue;
        ctx.strokeStyle = this.color(member.subject);
        ctx.fillStyle = this.color(member.subject);
        ctx.beginPath();
        ctx.arc(point[0], point[1], 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(
          member.username,
          Math.max(0, Math.min(rect.width - 80, point[0] + 9)),
          Math.max(14, point[1] - 8)
        );
      }
      for (const [subject, trail] of this.trails) {
        ctx.strokeStyle = this.color(subject);
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        let connected = false;
        for (const world of trail.points) {
          const point = this.point(viewport, world);
          if (!point) {
            connected = false;
            continue;
          }
          if (connected) ctx.lineTo(point[0], point[1]);
          else ctx.moveTo(point[0], point[1]);
          connected = true;
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  destroy() {
    clearInterval(this.timer);
    document.removeEventListener('pointermove', this.move, true);
    document.removeEventListener('pointerup', this.up, true);
    this.canvases.forEach(canvas => canvas.remove());
    this.canvases.clear();
  }
}
