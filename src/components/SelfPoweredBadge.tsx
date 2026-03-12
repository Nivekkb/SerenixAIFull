interface SelfPoweredBadgeProps {
  className?: string;
}

export default function SelfPoweredBadge({ className = '' }: SelfPoweredBadgeProps) {
  return (
    <div className={`inline-flex items-center gap-2.5 rounded-full border border-white/60 bg-white/60 px-3.5 py-1.5 text-[11px] text-serenix-ink/60 ${className}`}>
      <span className="uppercase tracking-[0.18em] text-serenix-ink/35">Powered by</span>
      <a
        href="https://governedbyself.com"
        target="_blank"
        rel="noreferrer"
        title="SELF Support-First Logic Engine"
        aria-label="SELF Support-First Logic Engine"
        className="inline-flex items-center justify-center rounded-md p-0.5 hover:bg-white/60 transition-colors"
      >
        <img
          src="/assets/self-badge-wide.png"
          alt="SELF Support-First Logic Engine"
          className="h-5 w-auto md:h-6 max-w-[140px] rounded-sm object-contain"
          loading="lazy"
        />
      </a>
    </div>
  );
}
