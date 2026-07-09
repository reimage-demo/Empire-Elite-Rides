# Empire Elite Rides

The public site is intentionally static (`index.html`, `booking.html`, `styles.css`, and plain JavaScript). The private React admin portal lives in `admin-portal/` and uses Vite and Convex.

## Connect the production Convex deployment

The project is connected to the existing **Empire Elite Rides** Convex project. Its functions are deployed to production at `https://bold-okapi-506.convex.cloud`, and both clients are configured to use that deployment.

The protected admin credentials have been set in Convex production (they remain server-side). To rotate them later:

   ```sh
   npx convex env set ADMIN_USERNAME williamfarrar
   npx convex env set ADMIN_PASSWORD '<new-password>'
   ```

Pushover booking notifications use the protected Convex environment variables `PUSHOVER_API_TOKEN` and `PUSHOVER_USER_KEY`. Both development and production deployments are configured. Rotate either value with `npx convex env set` and add `--prod` for production.

The admin portal includes a **New Booking** view. Admin-created bookings use the same conflict and availability checks as public requests, are confirmed immediately, and trigger the same Pushover notification action.

Run `npm run convex:deploy` when backend functions change, then `npm run build` for admin UI changes. Serve the project root with any static host; do not open the HTML via `file://` because the booking page imports the Convex browser client as an ES module.

The `bookings:create` mutation rejects overlapping reservations and maintains a two-hour buffer after every active booking. Cancelled bookings release their times.
