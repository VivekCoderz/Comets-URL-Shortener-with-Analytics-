// One-click share buttons (PRD FR-10b, board task CMT-38).
// Plain links, so they work without JavaScript and open the app on phones:
//   WhatsApp → https://wa.me/?text=<short link>
//   LinkedIn → https://www.linkedin.com/sharing/share-offsite/?url=<short link>
// Copy and Download PNG live in CopyButton and QrDesigner.

export function whatsappShareUrl(shortUrl) {
  return `https://wa.me/?text=${encodeURIComponent(shortUrl)}`;
}

export function linkedinShareUrl(shortUrl) {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shortUrl)}`;
}

const buttonClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50";

export default function ShareButtons({ shortUrl }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={whatsappShareUrl(shortUrl)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Share ${shortUrl} on WhatsApp`}
        className={buttonClass}
      >
        WhatsApp
      </a>
      <a
        href={linkedinShareUrl(shortUrl)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Share ${shortUrl} on LinkedIn`}
        className={buttonClass}
      >
        LinkedIn
      </a>
    </div>
  );
}
