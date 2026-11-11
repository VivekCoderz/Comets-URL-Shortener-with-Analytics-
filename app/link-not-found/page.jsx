import { notFound } from "next/navigation";

// The redirect route (app/[code]/route.js) sends unknown or deleted short codes
// here. A route handler's notFound() only returns an empty 404, so we send the
// visitor to this page instead: calling notFound() in a page renders
// app/not-found.jsx ("Link not found") with a 404 status.
export default function LinkNotFound() {
  notFound();
}
