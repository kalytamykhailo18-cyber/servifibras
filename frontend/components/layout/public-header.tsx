import Image from "next/image";
import Link from "next/link";

export function PublicHeader() {
  return (
    <header className="h-16 border-b border-black bg-black flex items-center px-6 lg:px-12">
      <Link href="/" className="flex items-center gap-2.5">
        <Image
          src="/servifibras-mark-inverted.png"
          alt="Servifibras"
          width={32}
          height={32}
          priority
          className="h-8 w-8 object-contain"
        />
        <span className="text-[1.05rem] font-semibold tracking-[0.04em] text-white">
          SERVIFIBRAS
        </span>
      </Link>
    </header>
  );
}
