import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from './auth';

const PUBLIC_PATHS = [
  /^\/login(\?.*)?$/,
  /^\/i\/.+/,
  /^\/api\/auth\/.*/,
  /^\/api\/health/,
  /^\/api\/telegram\/webhook$/,
];
const ADMIN_PATHS = [/^\/admin(\/.*)?$/, /^\/api\/admin\/.*/];

function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return res;
}

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(path));
}

function isAdmin(path: string): boolean {
  return ADMIN_PATHS.some((re) => re.test(path));
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? '';
}

function ipAllowed(ip: string, allowlist: string): boolean {
  if (!allowlist.trim()) return true;
  const ips = allowlist.split(',').map((s) => s.trim()).filter(Boolean);
  if (ips.length === 0) return true;
  return ips.includes(ip);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return applySecurityHeaders(NextResponse.next());

  const session = await auth();

  if (!session?.user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  if (isAdmin(pathname)) {
    if (session.user.role !== 'admin') {
      return applySecurityHeaders(NextResponse.redirect(new URL('/dashboard', req.url)));
    }
    const allowlist = process.env.ADMIN_IP_ALLOWLIST ?? '';
    if (allowlist && !ipAllowed(getClientIp(req), allowlist)) {
      return applySecurityHeaders(new NextResponse('Forbidden: IP not allowed', { status: 403 }));
    }
  } else {
    if (session.user.status !== 'approved') {
      return applySecurityHeaders(NextResponse.redirect(new URL('/login?error=NotApproved', req.url)));
    }
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static files, _next, etc.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map)).*)',
  ],
};
