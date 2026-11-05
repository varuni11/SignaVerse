import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentUser, USER_SESSION_EVENT } from "@/lib/auth-store";

const links = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  { to: "/features", label: "Features" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/demo", label: "Demo" },
  { to: "/technologies", label: "Technologies" },
  { to: "/team", label: "Team" },
  { to: "/contact", label: "Contact" },
] as const;

export function Nav() {
  const [open, setOpen] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    const refresh = () => setHasProfile(!!getCurrentUser());
    refresh();
    window.addEventListener(USER_SESSION_EVENT, refresh);
    return () => window.removeEventListener(USER_SESSION_EVENT, refresh);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-hero text-primary-foreground shadow-elevate">
            <Waves className="size-5" />
          </span>
          <span className="text-sm font-semibold leading-tight">
            Signa<span className="text-gradient">Verse</span>
            <span className="block text-[11px] font-normal text-muted-foreground">
              ISL communication
            </span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              activeOptions={{ exact: l.to === "/" }}
              activeProps={{ className: "text-primary bg-accent" }}
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <Link
          to={hasProfile ? "/dashboard" : "/login"}
          activeProps={{ className: "text-primary" }}
          className="ml-auto hidden text-sm text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
        >
          {hasProfile ? "Dashboard" : "Log in"}
        </Link>

        <Button
          asChild
          variant="hero"
          size="sm"
          className="hidden lg:inline-flex"
        >
          <Link to="/demo">Try live demo</Link>
        </Button>

        <button
          aria-label="Toggle menu"
          onClick={() => setOpen((o) => !o)}
          className="ml-auto rounded-lg border p-2 lg:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open ? (
        <nav className="grid gap-1 border-t bg-background px-5 py-3 lg:hidden">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              onClick={() => setOpen(false)}
              activeOptions={{ exact: l.to === "/" }}
              activeProps={{ className: "text-primary" }}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground"
            >
              {l.label}
            </Link>
          ))}
          <Link
            to={hasProfile ? "/dashboard" : "/login"}
            onClick={() => setOpen(false)}
            activeProps={{ className: "text-primary" }}
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground"
          >
            {hasProfile ? "Dashboard" : "Log in"}
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
