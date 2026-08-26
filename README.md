# Empire Elite Rides

The project has three deliberately separate layers:

- The public site is static HTML, CSS, and JavaScript at the project root.
- `convex/` is the shared backend used by the public booking form and admin portal.
- `admin-portal/` is the private Vite/React administration interface.

## Production

Both clients use the Empire Elite Rides production Convex deployment. Administrator
credentials remain server-side. Password verification uses the following production
environment variables:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_ALGORITHM`
- `ADMIN_PASSWORD_ITERATIONS`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_PASSWORD_SALT`
- `ADMIN_PASSWORD_PEPPER`

There is no plaintext administrator password variable.

Pushover booking notifications use protected production environment variables.
Provider credentials must remain server-side and must never be added to browser code.

## Development

- Run `npm test` for the contract and pricing test suite.
- Run `npm run convex:deploy` when shared backend functions change.
- Run `npm run admin:build` for admin interface changes.
- Serve public files over HTTP; do not open them through `file://`.

The admin portal’s booking workflow uses the same conflict and availability checks as
public requests. The backend rejects overlapping reservations and keeps a two-hour
buffer after active bookings; cancelled bookings release their times.

## Pricing

The public homepage and booking page share the Convex pricing pipeline. The backend
owns routes, quote pricing, expiration checks, vehicle conflicts, versioned pricing
snapshots, and audit history.

See [PRICING_SETUP.md](PRICING_SETUP.md) for provider setup, pricing configuration,
webhook configuration, and deployment order.
