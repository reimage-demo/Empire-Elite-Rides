import { requireActiveSession } from './sessionToken'

export const ADMIN_ROLES = ['owner', 'admin', 'manager']

export async function requireAdmin(ctx: any, token: string, allowedRoles = ADMIN_ROLES) {
  const session = await requireActiveSession(ctx, token)
  const role = session.role || 'admin'
  if (!allowedRoles.includes(role)) throw new Error('FORBIDDEN')
  return { ...session, role }
}
