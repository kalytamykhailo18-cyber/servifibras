"use client";

import { useAuthStore, selectUser } from "@/lib/store/auth-store";
import { Skeleton } from "@/components/ui/skeleton";
import { USER_ROLE_LABELS } from "@/types";
import PersonIcon from "@mui/icons-material/Person";
import EmailIcon from "@mui/icons-material/Email";
import BadgeIcon from "@mui/icons-material/Badge";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";

const AVATAR_GRADIENTS = [
  "from-blue-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-purple-500 to-pink-400",
  "from-orange-500 to-amber-400",
  "from-indigo-500 to-violet-400",
  "from-rose-500 to-pink-400",
];

const initials = (name?: string) => {
  if (!name) return "?";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
};

const gradientFor = (name?: string) =>
  AVATAR_GRADIENTS[(name?.charCodeAt(0) ?? 0) % AVATAR_GRADIENTS.length];

export default function ProfilePage() {
  const user = useAuthStore(selectUser);

  if (!user) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }

  const gradient = gradientFor(user.name);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* PAGE HEADER */}
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(59_130_246/0.45)] sm:h-11 sm:w-11">
          <PersonIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Mi Perfil</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">Información de tu cuenta</p>
        </div>
      </div>

      {/* IDENTITY HERO */}
      <div className="relative rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        {/* Banner — neutral wash so the user-coloured avatar pops over it */}
        <div className="relative h-32 overflow-hidden rounded-t-2xl bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50/60">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(15_23_42/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(15_23_42/0.04)_1px,transparent_1px)] bg-[size:32px_32px] opacity-50"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-blue-200/40 blur-3xl"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-12 left-1/3 h-36 w-36 rounded-full bg-violet-200/30 blur-3xl"
          />
        </div>

        {/* Avatar — absolutely positioned so it always sits half-in / half-out of the banner */}
        <span
          className={`absolute left-6 top-32 grid h-24 w-24 shrink-0 -translate-y-1/2 place-items-center rounded-2xl bg-gradient-to-br ${gradient} text-xl font-bold tracking-tight sm:text-3xl text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_16px_32px_-8px_rgb(15_23_42/0.3)] ring-4 ring-white`}
          aria-hidden
        >
          {initials(user.name)}
        </span>

        {/* Body — left-padded to clear the avatar */}
        <div className="flex flex-col gap-4 px-6 pb-6 pt-16 sm:flex-row sm:items-end sm:justify-between sm:pl-36 sm:pt-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold tracking-tight sm:text-2xl text-slate-900">
              {user.name}
            </h2>
            <p className="truncate text-sm text-slate-500">@{user.username}</p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                user.active
                  ? "border-emerald-200/70 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              <span className="relative flex h-1.5 w-1.5">
                {user.active && (
                  <span className="absolute inset-0 inline-flex animate-ping rounded-full bg-emerald-500 opacity-75" />
                )}
                <span
                  className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                    user.active ? "bg-emerald-500" : "bg-slate-400"
                  }`}
                />
              </span>
              {user.active ? "Activo" : "Inactivo"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/70 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              {USER_ROLE_LABELS[user.role]}
            </span>
          </div>
        </div>
      </div>

      {/* DETAILS */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Datos de la cuenta
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            icon={<PersonIcon sx={{ fontSize: 14 }} />}
            tint="bg-blue-50 text-blue-600"
            label="Nombre"
            value={user.name}
          />
          <Field
            icon={<AccountCircleIcon sx={{ fontSize: 14 }} />}
            tint="bg-violet-50 text-violet-600"
            label="Usuario"
            value={user.username}
          />
          <Field
            icon={<EmailIcon sx={{ fontSize: 14 }} />}
            tint="bg-emerald-50 text-emerald-600"
            label="Email"
            value={user.email}
          />
          <Field
            icon={<BadgeIcon sx={{ fontSize: 14 }} />}
            tint="bg-amber-50 text-amber-600"
            label="Rol"
            value={USER_ROLE_LABELS[user.role]}
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  icon,
  tint,
  label,
  value,
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tint}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="truncate text-sm font-medium text-slate-900">{value}</p>
      </div>
    </div>
  );
}
