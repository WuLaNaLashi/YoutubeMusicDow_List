/**
 * 基础 UI 组件(轻量自实现,不引 shadcn 全家桶,保持 bundle 小)。
 * 用 Tailwind v4 + 自定义 token(见 styles.css)。
 */
import { type ButtonHTMLAttributes, type ReactNode } from "react";

type BtnVariant = "primary" | "default" | "danger" | "ghost";

export function Button({
  variant = "default",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const base =
    "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border text-[13px] cursor-pointer transition-all font-[inherit] disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<BtnVariant, string> = {
    primary: "bg-brand border-brand text-white hover:bg-brand-strong",
    default: "bg-bg border-border-strong hover:bg-bg-soft2",
    danger: "text-err border-err hover:bg-err-soft",
    ghost: "border-transparent hover:bg-bg-soft2",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-bg border border-border rounded-lg p-4 shadow-[0_1px_2px_rgba(15,23,42,.04),0_1px_3px_rgba(15,23,42,.06)] ${className}`}
    >
      {children}
    </div>
  );
}

type TagColor =
  | "ok"
  | "warn"
  | "err"
  | "info"
  | "alias"
  | "neutral";

export function Tag({
  color = "neutral",
  children,
  className = "",
}: {
  color?: TagColor;
  children: ReactNode;
  className?: string;
}) {
  const colors: Record<TagColor, string> = {
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    err: "bg-err-soft text-err",
    info: "bg-info-soft text-info",
    alias: "bg-alias-soft text-alias",
    neutral: "bg-bg-soft2 text-text-2",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[11px] text-[11.5px] font-medium whitespace-nowrap ${colors[color]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 bg-bg-soft2 rounded overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-brand to-[#8b5cf6] rounded transition-[width] duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Stat({
  num,
  label,
  numColor,
  icon,
}: {
  num: number | string;
  label: string;
  numColor?: string;
  icon?: string;
}) {
  return (
    <div className="bg-bg border border-border rounded-lg px-4 py-3 shadow-sm">
      {icon && <div className="float-right text-lg opacity-50">{icon}</div>}
      <div className="text-2xl font-bold leading-none" style={numColor ? { color: numColor } : undefined}>
        {num}
      </div>
      <div className="text-[11.5px] text-text-3 mt-0.5">{label}</div>
    </div>
  );
}

export function toast(msg: string) {
  // 简易 toast:DOM 注入
  let el = document.getElementById("__toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "__toast";
    el.style.cssText =
      "position:fixed;bottom:60px;right:24px;background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.15);opacity:0;transform:translateY(10px);transition:.2s;z-index:50";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  el.style.transform = "translateY(0)";
  clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => {
    el!.style.opacity = "0";
    el!.style.transform = "translateY(10px)";
  }, 2200);
}
