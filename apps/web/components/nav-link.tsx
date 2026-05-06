'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Props {
  href: string;
  label: string;
  /**
   * When true, this link matches /href exactly. When false (default), it
   * also matches /href/* so a child route keeps the parent active.
   */
  exact?: boolean;
}

export function NavLink({ href, label, exact = false }: Props) {
  const pathname = usePathname() ?? '/';
  const isActive = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} className="nav-link" data-active={isActive}>
      {label}
    </Link>
  );
}
