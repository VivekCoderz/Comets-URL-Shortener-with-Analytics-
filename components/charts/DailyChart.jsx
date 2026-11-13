"use client";

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11-06" → "6 Nov". We split the string instead of using new Date(),
// because new Date("2026-11-06") is midnight UTC and could show the wrong day.
function shortDay(day) {
  const [, month, date] = day.split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1]}`;
}

// "Clicks per day" line chart on the link details page (Screen 08).
// `data` = the `daily` list from GET /api/links/[id]/analytics:
// [{ day: "2026-11-06", clicks: 3 }, …], one entry per day, 0 if no clicks.
export default function DailyChart({ data }) {
  return (
    // `responsive` makes the chart fill this div and resize with it (Recharts 3).
    <div className="h-64 w-full">
      <LineChart responsive data={data} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
        <CartesianGrid stroke="#e4e4e7" vertical={false} />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 12 }} minTickGap={16} />
        {/* Clicks are whole numbers, so no "0.5" ticks. */}
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip labelFormatter={shortDay} formatter={(value) => [value, "Clicks"]} />
        <Line type="monotone" dataKey="clicks" stroke="#2563eb" strokeWidth={2} dot={data.length <= 30} />
      </LineChart>
    </div>
  );
}
