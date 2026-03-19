import { NextResponse } from 'next/server'
import { readAllContent } from '@/lib/content'

export async function GET() {
  const files = readAllContent()
  return NextResponse.json(files)
}
