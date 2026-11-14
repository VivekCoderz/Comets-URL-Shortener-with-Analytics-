const numberFormat = new Intl.NumberFormat("en-IN");
const donutColors = ["#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6", "#64748b"];

function getEntries(data, formatLabel = (label) => label) {
  const entries = data instanceof Map ? [...data.entries()] : Object.entries(data ?? {});

  return entries
    .map(([label, count]) => ({
      label: formatLabel(String(label)),
      count: Number(count),
    }))
    .filter(({ label, count }) => label && Number.isFinite(count) && count > 0)
    .sort((a, b) => b.count - a.count);
}

function ChartCard({ title, children }) {
  return (
    <section className="flex min-h-[24rem] flex-col rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

function EmptyChart() {
  return (
    <p className="flex flex-1 items-center justify-center py-10 text-sm text-slate-500">
      No clicks yet
    </p>
  );
}

function BarChart({ data, title, formatLabel }) {
  const entries = getEntries(data, formatLabel);

  return (
    <ChartCard title={title}>
      {entries.length === 0 ? (
        <EmptyChart />
      ) : (
        <ul className="mt-5 flex flex-col gap-4">
          {entries.map(({ label, count }) => (
            <li key={label} className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-slate-600" title={label}>
                  {label}
                </span>
                <span className="shrink-0 font-medium text-slate-800">
                  {numberFormat.format(count)}
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-slate-100"
                role="img"
                aria-label={`${label}: ${numberFormat.format(count)} clicks`}
              >
                <div
                  className="h-full rounded-full bg-blue-600"
                  style={{ width: `${(count / entries[0].count) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

function DeviceChart({ data }) {
  const entries = getEntries(data);
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);

  if (entries.length === 0) {
    return (
      <ChartCard title="Devices">
        <EmptyChart />
      </ChartCard>
    );
  }

  const slices = entries.map(({ count }, index) => {
    const previousCount = entries
      .slice(0, index)
      .reduce((sum, entry) => sum + entry.count, 0);
    const start = (previousCount / total) * 100;
    const end = index === entries.length - 1 ? 100 : start + (count / total) * 100;
    const slice = `${donutColors[index % donutColors.length]} ${start}% ${end}%`;
    return slice;
  });

  return (
    <ChartCard title="Devices">
      <div className="mt-5 flex flex-1 flex-col items-center justify-center gap-5 sm:flex-row">
        <div
          className="relative size-36 shrink-0 rounded-full"
          role="img"
          aria-label={`Device clicks: ${entries
            .map(({ label, count }) => `${label} ${numberFormat.format(count)}`)
            .join(", ")}`}
          style={{ background: `conic-gradient(${slices.join(", ")})` }}
        >
          <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white">
            <span className="text-xl font-semibold text-slate-800">
              {numberFormat.format(total)}
            </span>
            <span className="text-xs text-slate-500">Clicks</span>
          </div>
        </div>
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2 sm:flex-col sm:flex-nowrap">
          {entries.map(({ label, count }, index) => (
            <li key={label} className="flex items-center gap-2 text-sm text-slate-600">
              <span
                className="size-2.5 shrink-0 rounded-full"
                aria-hidden="true"
                style={{ backgroundColor: donutColors[index % donutColors.length] }}
              />
              <span>{label}</span>
              <span className="font-medium text-slate-800">{numberFormat.format(count)}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

export default function AnalyticsBreakdownCharts({
  byCountry,
  byDevice,
  byBrowser,
  byReferrer,
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <BarChart title="Countries" data={byCountry} />
      <BarChart
        title="Referrers"
        data={byReferrer}
        formatLabel={(label) => (label ? label.replaceAll("_", ".") : "Direct")}
      />
      <DeviceChart data={byDevice} />
      <BarChart title="Browsers" data={byBrowser} />
    </div>
  );
}
