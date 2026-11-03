// Home page. On Day 3 the guest shortener form comes here,
// and on Day 10 the QR designer and share buttons.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Team Comets</p>
      <h1 className="text-4xl font-bold tracking-tight">Comets URL Shortener</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Turn long links into short, readable ones. Create custom QR codes, share in one
        click and see who clicked.
      </p>
      <p className="text-sm text-zinc-500">
        Setup check:{" "}
        <a className="font-medium text-blue-600 underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}
