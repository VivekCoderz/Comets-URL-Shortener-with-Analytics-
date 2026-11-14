"use client";

import { useEffect, useState } from "react";
import AnalyticsBreakdownCharts from "@/components/charts/AnalyticsBreakdownCharts";
import DailyChart from "@/components/charts/DailyChart";

const RANGES = [7, 30, 90];
const numberFormat = new Intl.NumberFormat("en-IN");

function StatCard({ label, value, dashed = false }) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 ${dashed ? "border-dashed border-zinc-300" : "border-zinc-200"}`}
    >
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{numberFormat.format(value)}</p>
    </div>
  );
}

// The analytics part of the link details page (Screen 08): the 4 boxes,
// the 7d / 30d / 90d switch, the clicks-per-day chart and the breakdown charts.
// Data comes from Tripti's GET /api/links/[id]/analytics?range=7|30|90 (CMT-26).
export default function LinkAnalytics({ linkId }) {
  const [range, setRange] = useState(7);
  // { range, data } or { range, error }. Keeping the range lets us tell an
  // old answer from the answer for the range the user has now picked.
  const [result, setResult] = useState(null);

  useEffect(() => {
    // If the user clicks another range before this answer arrives, ignore it.
    let ignore = false;

    fetch(`/api/links/${linkId}/analytics?range=${range}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Could not load analytics");
        return body;
      })
      .then((data) => !ignore && setResult({ range, data }))
      .catch((error) => !ignore && setResult({ range, error: error.message }));

    return () => {
      ignore = true;
    };
  }, [linkId, range]);

  const loading = result?.range !== range;
  const data = loading ? null : result.data;
  const error = loading ? null : result.error;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* Total clicks already exclude bots and refreshes (PRD 7.7).
          Refreshes are shown only in the dashed "Extra details" box. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total clicks" value={data?.totals.clicks ?? 0} />
        <StatCard label="Unique clicks" value={data?.totals.uniqueClicks ?? 0} />
        <StatCard label="QR scans" value={data?.totals.qrClicks ?? 0} />
        <StatCard label="Extra details: refreshes" value={data?.totals.refreshes ?? 0} dashed />
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Clicks per day</h2>

          <div role="group" aria-label="Date range" className="flex rounded-lg border border-zinc-200 p-0.5">
            {RANGES.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setRange(days)}
                aria-pressed={range === days}
                className={`rounded-md px-3 py-1 text-sm ${
                  range === days ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        {data ? (
          <DailyChart data={data.daily} />
        ) : (
          <p className="flex h-64 items-center justify-center text-sm text-zinc-500">
            {error ? "No data" : "Loading…"}
          </p>
        )}
      </section>

      {data && (
        <AnalyticsBreakdownCharts
          byCountry={data.breakdowns.country}
          byReferrer={data.breakdowns.referrer}
          byDevice={data.breakdowns.device}
          byBrowser={data.breakdowns.browser}
        />
      )}
    </div>
  );
}
