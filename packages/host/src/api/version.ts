/**
 * GET /api/version — the running Bakin version AND this server generation's
 * identity (#898 K): `pid` and `bootId` are the PROCESS's own (never read
 * back from server.lock — an old server would otherwise report its
 * successor), `state` says whether it is starting, serving or stopping.
 * A CLI signals nothing on this answer; it uses it to recognise its home's
 * server and to prove a restart produced a NEW boot.
 */
import { APP_VERSION } from '@bakin/core/constants'
import { getBootId } from '@/core/boot-id'
import { getServerState } from '@/core/lifecycle'

export async function get(_req: Request, _url: URL): Promise<Response> {
  void _req
  void _url
  return Response.json(
    { version: APP_VERSION, pid: process.pid, bootId: getBootId(), state: getServerState() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
