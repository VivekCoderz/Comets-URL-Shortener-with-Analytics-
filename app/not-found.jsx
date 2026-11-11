import StatusPage from "@/components/StatusPage";

// Shown for any unknown page, and for a short code that doesn't exist or was
// deleted: the redirect route (app/[code]/route.js) calls notFound(), and
// Next.js renders this file with a 404 status.
export const metadata = { title: "Link not found · Comets" };

export default function NotFound() {
  return (
    <StatusPage
      badge={
        <p className="bg-linear-to-r from-violet-600 to-cyan-500 bg-clip-text text-6xl font-black tracking-tighter text-transparent">
          404
        </p>
      }
      title="Link not found"
      message="Check the link for typos. It may also have been deleted by its owner."
      actionLabel="Go to home page"
    />
  );
}
