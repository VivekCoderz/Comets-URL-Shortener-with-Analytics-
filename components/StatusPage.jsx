import Link from "next/link";

// One full-screen message with a button, used by the "Link not found" and
// "This link has expired" pages (screens PDF v2, screen 12). The unsafe-link
// warning page (CMT-53) can reuse it too.
export default function StatusPage({ badge, title, message, actionHref = "/", actionLabel }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        {badge}
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{title}</h1>
        <p className="text-sm text-zinc-600">{message}</p>
        <Link
          href={actionHref}
          className="mt-2 rounded-lg bg-linear-to-r from-violet-600 to-cyan-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
        >
          {actionLabel}
        </Link>
      </div>
    </main>
  );
}
