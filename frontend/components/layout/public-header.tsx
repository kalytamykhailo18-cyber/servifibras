import Link from "next/link";

export function PublicHeader() {
  return (
    <header className="h-16 border-b border-border bg-card flex items-center px-6">
      <Link href="/" className="flex items-center space-x-2">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-lg">S</span>
        </div>
        <span className="font-bold text-xl">Servifibras</span>
      </Link>
    </header>
  );
}
