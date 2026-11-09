"use client";

import { useState } from "react";
import LinkForm from "@/components/LinkForm";
import LinkTable from "@/components/LinkTable";

// /dashboard/links: create form on top, the user's links below (screen 06).
// proxy.js already sends logged-out users to /login before this page loads.
export default function MyLinksPage() {
  // Bumping this number makes LinkTable load the list again,
  // so a new link appears in the table straight after Shorten.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col gap-5">
      <LinkForm variant="card" onCreated={() => setRefreshKey((key) => key + 1)} />
      <LinkTable refreshKey={refreshKey} />
    </div>
  );
}
