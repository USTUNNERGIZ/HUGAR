
import { NextRequest, NextResponse } from 'next/server';
import { verifyUser } from '../../../lib/verify-user';
import { verifyPassword } from '../../../lib/verify-password';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';

  if (!authorization.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Oturum doğrulaması gerekli.' },
      { status: 401 }
    );
  }

  const user = await verifyUser(authorization.slice(7));

  if (!user || !user.email) {
    return NextResponse.json(
      { error: 'Geçersiz oturum.' },
      { status: 401 }
    );
  }

  let body: { password?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Geçersiz istek.' },
      { status: 400 }
    );
  }

  if (typeof body.password !== 'string' || !body.password) {
    return NextResponse.json(
      { error: 'Mevcut şifre gerekli.' },
      { status: 400 }
    );
  }

  const valid = await verifyPassword(
    user.email,
    body.password,
    user.id
  );

  if (!valid) {
    return NextResponse.json(
      { error: 'Şifre doğrulanamadı.' },
      { status: 401 }
    );
  }

  return NextResponse.json(
    { error: 'PIN oluşturma henüz etkin değil.' },
    { status: 501 }
  );
}
