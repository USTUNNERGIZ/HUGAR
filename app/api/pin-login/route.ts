
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'PIN ile giriş henüz etkin değil.' },
    { status: 501 }
  );
}
