import { NextResponse } from 'next/server'
import { pluginRegistry } from '@/lib/plugin-registry'

export async function GET() {
  const schemas = pluginRegistry.getSettingsSchemas()
  return NextResponse.json(schemas)
}
