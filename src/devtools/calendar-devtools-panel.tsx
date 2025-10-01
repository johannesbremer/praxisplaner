import * as React from "react";

import { CalendarDevtoolsEventClient } from "./event-client";

interface AutoscrollState {
  active: boolean;
  direction?: "down" | "up";
  intervalActive: boolean;
}
interface DragState {
  column?: string;
  dragging: boolean;
  slotIndex?: number;
}
interface EffectStat {
  count: number;
  name: string;
}

export function CalendarDevtoolsPanel() {
  const [renders, setRenders] = React.useState(0);
  const [lastRenderAt, setLastRenderAt] = React.useState<null | number>(null);
  const [appointments, setAppointments] = React.useState({
    count: 0,
    diff: {
      added: [] as string[],
      removed: [] as string[],
      updated: [] as string[],
    },
    lastChangeAt: 0,
  });
  const [drag, setDrag] = React.useState<DragState>({ dragging: false });
  const [autoscroll, setAutoscroll] = React.useState<AutoscrollState>({
    active: false,
    intervalActive: false,
  });
  const [effects, setEffects] = React.useState<EffectStat[]>([]);
  const [perf, setPerf] = React.useState<null | {
    lastCommitAt: number;
    renderDeltaMs: number;
    sinceMountMs: number;
  }>(null);

  React.useEffect(() => {
    const offRender = CalendarDevtoolsEventClient.on("calendar-render", (e) => {
      setRenders(e.payload.renders);
      setLastRenderAt(e.payload.lastRenderAt);
    });
    const offApp = CalendarDevtoolsEventClient.on(
      "calendar-appointments",
      (e) => {
        setAppointments({
          count: e.payload.count,
          diff: e.payload.diff,
          lastChangeAt: e.payload.lastChangeAt,
        });
      },
    );
    const offDrag = CalendarDevtoolsEventClient.on("calendar-drag", (e) => {
      setDrag(e.payload);
    });
    const offAuto = CalendarDevtoolsEventClient.on(
      "calendar-autoscroll",
      (e) => {
        setAutoscroll(e.payload);
      },
    );
    const offEffect = CalendarDevtoolsEventClient.on("calendar-effect", (e) => {
      setEffects((prev) => {
        const existing = prev.find((p) => p.name === e.payload.name);
        if (existing) {
          return prev.map((p) =>
            p.name === e.payload.name ? { ...p, count: e.payload.count } : p,
          );
        }
        return [...prev, { count: e.payload.count, name: e.payload.name }];
      });
    });
    const offPerf = CalendarDevtoolsEventClient.on(
      "calendar-performance",
      (e) => {
        setPerf(e.payload);
      },
    );
    return () => {
      offRender();
      offApp();
      offDrag();
      offAuto();
      offEffect();
      offPerf();
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui",
        fontSize: 12,
        gap: 12,
        padding: 12,
      }}
    >
      <section>
        <h4 style={{ margin: "0 0 4px" }}>Calendar Renders</h4>
        <div>Count: {renders}</div>
        <div>
          Last:{" "}
          {lastRenderAt ? new Date(lastRenderAt).toLocaleTimeString() : "-"}
        </div>
        {perf && (
          <div style={{ marginTop: 4 }}>
            <div>Render Δ: {perf.renderDeltaMs.toFixed(2)} ms</div>
            <div>Since Mount: {perf.sinceMountMs.toFixed(0)} ms</div>
          </div>
        )}
      </section>
      <section>
        <h4 style={{ margin: "0 0 4px" }}>Appointments</h4>
        <div>Total: {appointments.count}</div>
        <div>
          Δ Added: {appointments.diff.added.length} Removed:{" "}
          {appointments.diff.removed.length} Updated:{" "}
          {appointments.diff.updated.length}
        </div>
      </section>
      <section>
        <h4 style={{ margin: "0 0 4px" }}>Drag</h4>
        <div>
          {drag.dragging
            ? `Dragging ${drag.column} @ ${drag.slotIndex}`
            : "Idle"}
        </div>
      </section>
      <section>
        <h4 style={{ margin: "0 0 4px" }}>Auto-Scroll</h4>
        <div>
          {autoscroll.active
            ? `Active (${autoscroll.direction || "n/a"})`
            : "Inactive"}
        </div>
      </section>
      <section>
        <h4 style={{ margin: "0 0 4px" }}>Effects</h4>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {effects
            .toSorted((a, b) => a.name.localeCompare(b.name))
            .map((e) => (
              <li key={e.name}>
                {e.name}: {e.count}
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
