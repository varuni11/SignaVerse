import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle: string;
}) {
  return (
    <div className="relative overflow-hidden border-b bg-soft">
      <div className="absolute inset-0 grid-bg opacity-60" />
      <div className="relative mx-auto max-w-4xl px-5 py-20 text-center animate-rise">
        <span className="inline-flex rounded-full glass-panel px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {eyebrow}
        </span>
        <h1 className="mt-5 text-4xl font-bold sm:text-5xl">{title}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

export function Section({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`mx-auto w-full max-w-6xl px-5 py-16 sm:py-20 ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  kicker,
  title,
  lead,
}: {
  kicker: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="mb-10 max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal">
        {kicker}
      </p>
      <h2 className="mt-3 text-3xl font-bold sm:text-4xl">{title}</h2>
      {lead ? <p className="mt-3 text-muted-foreground">{lead}</p> : null}
    </div>
  );
}
