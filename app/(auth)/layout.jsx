import Link from "next/link";

// Shared frame for /signup and /login (screens PDF v2, screen 04).
// Left: dark brand panel. Right: the page's form (children).
// "(auth)" is a route group: the brackets keep it out of the URL,
// so the pages are /signup and /login, not /auth/signup.

// The gradient square with a white dot used as the Comets logo in the screens.
function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
      <span className="relative block h-7 w-7 rounded-lg bg-linear-to-br from-violet-500 to-cyan-500">
        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-white" />
      </span>
      Comets
    </Link>
  );
}

export default function AuthLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-1">
      {/* Brand panel. Hidden on phones so the form fits the screen. */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-[#0b1020] p-10 text-white lg:flex">
        {/* Soft coloured glows in the background (decoration only). */}
        <div className="pointer-events-none absolute -top-20 -left-24 h-96 w-96 rounded-full bg-violet-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-80 w-80 rounded-full bg-purple-600/25 blur-3xl" />

        <div className="relative">
          <Logo />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-bold tracking-tight">
            Every click,
            <br />
            <span className="bg-linear-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              counted right.
            </span>
          </h2>
          <p className="mt-4 text-sm text-zinc-300">
            Save your links, see real visitors (no bots, no refreshes) and manage all your QR
            codes in one place.
          </p>

          {/* Example stats card from the screen design. The numbers are a fixed
              illustration, not real data. */}
          <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <p className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Live: /geeta-fest
            </p>
            <div className="mt-3 flex items-end gap-8">
              <div>
                <p className="text-2xl font-bold">140</p>
                <p className="text-xs text-zinc-400">clicks</p>
              </div>
              <div>
                <p className="text-2xl font-bold">94</p>
                <p className="text-xs text-zinc-400">unique</p>
              </div>
              <svg viewBox="0 0 140 36" className="ml-auto h-9 w-36" aria-hidden="true">
                <polyline
                  points="0,32 12,22 24,26 36,20 48,22 60,14 72,16 84,12 96,10 108,4 120,4 140,6"
                  fill="none"
                  stroke="#a5b4fc"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-zinc-400">Team Comets · Elite Batch</p>
      </aside>

      {/* Form side */}
      <main className="flex flex-1 items-center justify-center bg-white px-6 py-12 text-zinc-900">
        <div className="w-full max-w-sm">
          {/* On phones the brand panel is hidden, so show the logo here instead. */}
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
