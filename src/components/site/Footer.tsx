import { Link } from "@tanstack/react-router";
import { Waves } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-24 border-t bg-soft">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-hero text-primary-foreground">
            <Waves className="size-5" />
          </span>
          <div className="text-sm">
            <p className="font-semibold">SignaVerse</p>
            <p className="text-muted-foreground">
              AI smart communication for Deaf & Mute people, in Indian Sign
              Language.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <Link to="/features" className="hover:text-foreground">
            Features
          </Link>
          <Link to="/demo" className="hover:text-foreground">
            Demo
          </Link>
          <Link to="/team" className="hover:text-foreground">
            Team
          </Link>
          <Link to="/contact" className="hover:text-foreground">
            Contact
          </Link>
          <Link to="/admin-login" className="hover:text-foreground">
            Admin
          </Link>
        </div>
      </div>
      <div className="border-t py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} SignaVerse. Built for accessible
        conversation.
      </div>
    </footer>
  );
}
