"use client";

import Link from "next/link";
import { useState } from "react";
import CopyButton from "@/components/CopyButton";
import LinkForm from "@/components/LinkForm";

// Home page "/" (PRD section 10): the guest shortener.
//   Before Shorten → screen 01 (dark hero with the URL box).
//   After Shorten  → screen 02 (your short link is ready + copy).
// The QR designer and share buttons from screen 02 come on Day 10 (CMT-38).

const features = [
  { icon: "🎨", title: "Custom QR", text: "Colours + your logo" },
  { icon: "📤", title: "1-click share", text: "WhatsApp, LinkedIn" },
  { icon: "📊", title: "Real analytics", text: "No bots, no refreshes" },
];

export default function Home() {
  // The link returned by POST /api/links, or null while the form is shown.
  const [link, setLink] = useState(null);

  return link ? <Result link={link} onReset={() => setLink(null)} /> : <Hero onCreated={setLink} />;
}

// The gradient square with a white dot: the Comets logo from the screens.
function Logo({ dark }) {
  return (
    <Link
      href="/"
      className={`flex items-center gap-2 text-lg font-semibold tracking-tight ${dark ? "text-white" : "text-zinc-900"}`}
    >
      <span className="relative block h-7 w-7 rounded-lg bg-linear-to-br from-violet-500 to-cyan-500">
        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-white" />
      </span>
      Comets
    </Link>
  );
}

function Header({ dark }) {
  return (
    <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
      <Logo dark={dark} />
      <nav className="flex items-center gap-3 text-sm font-medium">
        <Link
          href="/login"
          className={`rounded-lg border px-4 py-2 ${
            dark ? "border-white/30 text-white hover:bg-white/10" : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
          }`}
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="rounded-lg bg-linear-to-r from-violet-500 to-cyan-500 px-4 py-2 text-white hover:opacity-90"
        >
          Sign up free
        </Link>
      </nav>
    </header>
  );
}

// Screen 01
function Hero({ onCreated }) {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[#0b1020] text-white">
      {/* Soft coloured glows in the background (decoration only). */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-full bg-violet-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-cyan-500/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-purple-600/25 blur-3xl" />

      <Header dark />

      <main className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
        <p className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1 pr-4 pl-1 text-sm text-zinc-200">
          <span className="rounded-full bg-linear-to-r from-violet-500 to-cyan-500 px-2.5 py-0.5 text-xs font-semibold">
            New
          </span>
          Custom QR codes with your own logo
        </p>

        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Long links, made{" "}
          <span className="bg-linear-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
            short &amp; beautiful
          </span>
        </h1>
        <p className="text-zinc-300">
          Shorten, brand your QR code and share in one click. No sign-up needed.
        </p>

        <div className="w-full max-w-3xl">
          <LinkForm variant="hero" onCreated={onCreated} />
        </div>

        <ul className="mt-4 flex flex-wrap justify-center gap-3">
          {features.map((feature) => (
            <li
              key={feature.title}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left"
            >
              <span aria-hidden="true" className="text-xl">
                {feature.icon}
              </span>
              <span>
                <span className="block text-sm font-semibold">{feature.title}</span>
                <span className="block text-xs text-zinc-400">{feature.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

// Screen 02 (left column)
function Result({ link, onReset }) {
  // "comets.vercel.app/geeta-fest" → host part in grey, code in colour.
  const shortUrlText = link.shortUrl.replace(/^https?:\/\//, "");
  const host = shortUrlText.slice(0, shortUrlText.length - link.code.length);

  return (
    <div className="flex flex-1 flex-col bg-indigo-50/60 text-zinc-900">
      <Header />

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
        <section className="relative overflow-hidden rounded-2xl bg-[#0b1020] p-6 text-white">
          <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-cyan-500/25 blur-3xl" />
          <p className="relative flex items-center gap-2 text-sm text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Your short link is ready
          </p>
          <div className="relative mt-3 flex flex-wrap items-center justify-between gap-4">
            <p className="font-mono text-2xl font-semibold break-all sm:text-3xl">
              <span className="text-zinc-300">{host}</span>
              <span className="bg-linear-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                {link.code}
              </span>
            </p>
            <CopyButton text={link.shortUrl} />
          </div>
          <p className="relative mt-2 truncate text-sm text-zinc-400" title={link.longUrl}>
            → {link.longUrl.replace(/^https?:\/\//, "")}
          </p>
        </section>

        <section className="flex flex-col items-start justify-between gap-4 rounded-2xl sm:flex-row sm:items-center bg-linear-to-r from-violet-500 to-cyan-500 p-6 text-white">
          <div>
            <h2 className="text-lg font-semibold">See who clicked your link</h2>
            <p className="text-sm text-white/85">
              Sign up free to save links, see analytics and manage all your QR codes.
            </p>
          </div>
          <Link
            href="/signup"
            className="shrink-0 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-violet-600 hover:bg-white/90"
          >
            Sign up free →
          </Link>
        </section>

        <button
          type="button"
          onClick={onReset}
          className="self-center text-sm font-medium text-violet-600 hover:underline"
        >
          Shorten another link
        </button>
      </main>
    </div>
  );
}
