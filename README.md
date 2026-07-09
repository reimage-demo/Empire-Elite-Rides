# Empire Elite Rides

The project has three deliberately separate layers:

- The public site is static HTML, CSS, and JavaScript at the project root.
- `convex/` is the shared root-level backend used by both the public booking form and the admin portal.
- `admin-portal/` is the private Vite/React administration interface.

## Connect the production Convex deployment

The project is connected to the existing **Empire Elite Rides** Convex project. Its functions are deployed to production at `https://bold-okapi-506.convex.cloud`, and both clients use that deployment.

The protected admin credentials have been set in Convex production (they remain server-side). To rotate them later:

   ```sh
   npx convex env set ADMIN_USERNAME williamfarrar
   npx convex env set ADMIN_PASSWORD '<new-password>'
   ```

Pushover booking notifications use the protected Convex environment variables `PUSHOVER_API_TOKEN` and `PUSHOVER_USER_KEY`. Both development and production deployments are configured. Rotate either value with `npx convex env set` and add `--prod` for production.

The admin portal includes a **New Booking** view. Admin-created bookings use the same conflict and availability checks as public requests, are confirmed immediately, and trigger the same Pushover notification action.

Run `npm run convex:deploy` from the project root when shared backend functions change. Run `npm run admin:build` from the root (or `npm run build` inside `admin-portal/`) for admin UI changes. Serve the public files from the project root; do not open the HTML through `file://` because the booking page imports the Convex browser client as an ES module.

The `bookings:create` mutation rejects overlapping reservations and maintains a two-hour buffer after every active booking. Cancelled bookings release their times.
