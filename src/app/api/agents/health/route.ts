import { NextResponse } from 'next/server'
import { readHeartbeats } from '@/lib/content'

export async function GET() {
  const heartbeats = readHeartbeats()
  return NextResponse.json(heartbeats)
}
