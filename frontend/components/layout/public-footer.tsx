export function PublicFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card py-6">
      <div className="px-6 text-center text-xs text-muted-foreground">
        © {year} Servifibras — Materiales compuestos
      </div>
    </footer>
  );
}
