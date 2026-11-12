import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AnalyticsBreakdownCharts from "@/components/charts/AnalyticsBreakdownCharts";

describe("analytics breakdown charts", () => {
  it("renders breakdown values and labels empty referrers as Direct", () => {
    const markup = renderToStaticMarkup(
      createElement(AnalyticsBreakdownCharts, {
        byCountry: new Map([["IN", 8], ["US", 3]]),
        byDevice: { Mobile: 7, Desktop: 4 },
        byBrowser: { Chrome: 6, Safari: 2 },
        byReferrer: { "": 2, instagram_com: 5 },
      }),
    );

    expect(markup).toContain("Countries");
    expect(markup).toContain("IN");
    expect(markup).toContain("Devices");
    expect(markup).toContain("Mobile");
    expect(markup).toContain("Browsers");
    expect(markup).toContain("Chrome");
    expect(markup).toContain("Referrers");
    expect(markup).toContain("instagram.com");
    expect(markup).toContain("Direct");
  });

  it("shows the empty state for all breakdowns without clicks", () => {
    const markup = renderToStaticMarkup(createElement(AnalyticsBreakdownCharts));

    expect(markup.match(/No clicks yet/g)).toHaveLength(4);
  });
});
