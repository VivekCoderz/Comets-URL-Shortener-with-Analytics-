import StatusPage from "@/components/StatusPage";

// The redirect route sends visitors here when a link is past its expiry date,
// has used up its click limit, or was turned off by its owner (PRD FR-08).
export const metadata = { title: "Link expired · Comets" };

export default function ExpiredPage() {
  return (
    <StatusPage
      badge={
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-3xl" aria-hidden="true">
          ⌛
        </span>
      }
      title="This link has expired"
      message="The owner set this link to stop working after a date or a number of clicks, or turned it off."
      actionLabel="Create your own short link"
    />
  );
}
