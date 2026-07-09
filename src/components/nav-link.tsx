"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Top-nav link with an active state (the admin tabs already have one; the main
// nav didn't). Active = exact match or a sub-path, so /admin/tags lights Admin.
export function NavLink({
  href,
  variant = "ghost",
  children,
}: {
  href: string;
  variant?: "ghost" | "default";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Button
      asChild
      variant={variant}
      size="sm"
      className={cn(active && variant === "ghost" && "bg-accent text-accent-foreground")}
    >
      <Link href={href} aria-current={active ? "page" : undefined}>
        {children}
      </Link>
    </Button>
  );
}
