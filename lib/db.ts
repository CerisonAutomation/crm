import { PrismaClient } from '@/generated/prisma/client'
import { DomainError } from '@/lib/domain/states'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { selectDbAdapterKind } from '@/lib/db-adapter'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaStamp: number | undefined
}
let localStatementSequence = 0

function localDemoPgOptions() {
  if (process.env.CITIZEN_LANE_PRISMA_DEMO !== '1') return undefined

  // Prisma dev's PGlite-backed PostgreSQL endpoint shares protocol state in a
  // way that rejects unnamed prepared statements after a connection changes.
  // Names are process-unique, so they cannot collide across local processes.
  return {
    statementNameGenerator: () => `cl_demo_${process.pid}_${++localStatementSequence}`,
  }
}

/** Narrow type for the env subset we actually read. */
type DbEnv = { DB_DRIVER?: string };

/**
 * Connection is PostgreSQL on Neon, configured through the environment: the
 * pooled `DATABASE_URL` for the app and the direct, non-pooled `DIRECT_URL` for
 * migrations. Migrate reads its URL from `prisma.config.ts`; the runtime URL is
 * handed to the driver adapter below.
 *
 * Prisma 7 no longer bundles a query engine, so the client must be given either
 * an `adapter` or an `accelerateUrl` — there is no default connection path. The
 * Neon serverless driver is this deployment's adapter.
 */
function clientOptions(): ConstructorParameters<typeof PrismaClient>[0] {
  // Query logging is a development aid only. In production it would write every
  // SQL statement — including bound parameters that can carry PII — to stdout,
  // adding log volume and latency to every request. Warn/keep-alive events stay
  // on in all environments; `query` is gated to non-production.
  const adapterKind = selectDbAdapterKind(process.env as DbEnv)
  const adapter = adapterKind === "pg"
    ? new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }, localDemoPgOptions())
    : new PrismaNeon({ connectionString: process.env.DATABASE_URL ?? "" })
  return {
    adapter,
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  }
}

/**
 * Stamp of the generated client (mtime of the generated client.ts). When the
 * generated client changes on disk while the dev server is running, the
 * globalThis-cached instance would keep serving the OLD model set. Comparing
 * stamps on every module evaluation lets a `db push` hot-reload into the
 * running dev server without a restart.
 */
function generatedClientStamp(): number {
  // Prisma 7 with the `prisma-client` generator writes the generated client to
  // the explicit `output` path (here: `src/generated/prisma`). The file that
  // reliably changes on every `prisma generate` is `client.ts`.
  const path = join(process.cwd(), 'src', 'generated', 'prisma', 'client.ts')
  try {
    // `turbopackIgnore` is load-bearing: `path` is resolved at runtime, so
        // without the annotation the tracer cannot bound this read and includes
        // the whole project in the standalone output.
        // Hot-reload sentinel: src/generated/prisma/client.ts changes on every `prisma generate`.
        return statSync(/* turbopackIgnore: true */ path).mtimeMs
  } catch {
    return 0
  }
}

const stamp = generatedClientStamp()

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = new PrismaClient(clientOptions())
  globalForPrisma.prismaStamp = stamp
} else if (process.env.NODE_ENV !== 'production' && globalForPrisma.prismaStamp !== stamp) {
  // Turbopack cannot bundle an absolute runtime `require()` of the generated
  // TypeScript client. Rebuild from the statically imported generated class;
  // HMR refreshes that module graph while the global cache keeps connections
  // bounded to one active client.
  void globalForPrisma.prisma.$disconnect().catch(() => undefined)
  globalForPrisma.prisma = new PrismaClient(clientOptions())
  globalForPrisma.prismaStamp = stamp
}

/** Transaction client handed to `withTenantContext` bodies (derived, no internal imports). */
export type TenantTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/**
 * Request-scoped RLS tenant context (ADR-002 P1).
 *
 * Opens an explicit interactive transaction and sets `app.current_org_id` via
 * `set_config(..., is_local=true)` as its first statement ($1-bound — never
 * interpolated), so the value dies with the transaction and can never leak
 * across pooled connections. Session-level SET on a pooled client is forbidden
 * for exactly that reason.
 *
 * Fail-closed: empty orgId throws; unset setting denies all rows per the
 * migration policies. Requires a driver with interactive-transaction support
 * (DB_DRIVER=pg); Neon HTTP mode rejects `$transaction` and therefore throws
 * here instead of running unscoped — a loud failure, never a silent bypass.
 */
export async function withTenantContext<T>(
  orgId: string,
  fn: (tx: TenantTx) => Promise<T>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  if (!orgId) throw new DomainError('Explicit tenant context is required', 400)
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`
      return fn(tx)
    },
    { timeout: opts?.timeoutMs ?? 20000 },
  )
}

export const db = globalForPrisma.prisma
