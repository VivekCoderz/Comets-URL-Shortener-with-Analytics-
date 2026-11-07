import Link from "next/link";
import LogoutButton from "./logout-button";

const navigation = [
  { label: "Overview", href: "/dashboard" },
  { label: "My links", href: "/dashboard/links" },
  { label: "API keys", href: "/dashboard/keys" },
];

export default function DashboardLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-1 bg-zinc-50 text-zinc-900">
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white px-4 py-6">
        <Link
          href="/dashboard"
          className="mb-8 px-3 text-lg font-semibold tracking-tight"
        >
          Comets
        </Link>

        <nav aria-label="Dashboard" className="flex flex-col gap-1">
          {navigation.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            >
              {label}
            </Link>
          ))}
        </nav>

        <LogoutButton />
      </aside>

      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}
