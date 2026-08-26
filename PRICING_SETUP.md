# Automatic chauffeur pricing setup

## External services required

The implementation uses Geoapify Address Autocomplete for suggestions and exact server-side revalidation, plus Geoapify Routing for backend mileage and duration calculations. Store the Geoapify key only in Convex; never add it to browser JavaScript or commit it to the repository:

```sh
npx convex env set MAPS_PROVIDER geoapify
npx convex env set GEOAPIFY_API_KEY '<key>'
```

Customers receive a backend-validated price. Instant quotes continue to Stripe Checkout; rides requiring manual review submit a reservation request without taking payment.

## Active local pricing contract

Ordinary local rides use the owner-approved market formula of $4.00 per passenger mile plus $1.00 per passenger minute. They do not receive a base fee, minimum fare, short-notice adjustment, positioning/return-to-base charge, cost-floor increase, peak-time adjustment, holiday adjustment, demand adjustment, or limited-availability price increase.

Airport service adds one flat $10 fee. Airport bookings require the airline and flight number. Meet-and-greet and estimated parking fees are not offered. Customer-selected waiting time is billed from the first selected minute at the configured per-minute rate. Route changes can still change distance and travel-time pricing, while round-trip and approved promotional discounts may reduce the total.

Hourly, event, and long-distance services retain their separate pricing rules and review controls. All currency is stored as integer cents and percentages as basis points.

The competitive long-distance promotion begins at 25 passenger miles. It uses a $20 promotional base, $2.50 per mile for the first 25 miles, $0.95 for each additional passenger mile, and $0.25 per passenger minute. Customer-facing positioning is capped at $0 for these rides. Because the promotion can fall below the internal cost floor, every qualifying ride requires staff confirmation.

Every save creates a new immutable pricing version. Quotes retain the configuration snapshot and version used at calculation time.

## Routing and traffic behavior

The backend resolves the fixed base at `2603 2nd Ave, Watervliet, NY 12189`, stores the validated result, and calculates separate base-to-pickup, passenger, and return-to-base legs. The public browser never supplies accepted coordinates, mileage, duration, availability, demand, or price.

Geoapify Routing supplies road distance and normal driving duration but not dependable future departure-time prediction for this use case. The implementation stores normal duration and applies the admin-controlled time-window fallback (`trafficFallbackBps`) during configured rush windows. Toll availability is stored; missing toll data safely produces a zero estimate and does not prevent quoting.

## Safe deployment order

1. Add provider secrets to the development Convex deployment.
2. Run `npm test` and `npm run admin:build`.
3. Run `npx convex dev --once` against development to validate and deploy the schema/functions.
4. Test autocomplete, estimate transfer, official quotes, manual review, conflicts, expiration, and priced reservation submission.
5. Review the active pricing snapshot in the admin portal and save a versioned change only when the owner approves it.
6. Add the same separately managed secrets to production with `--prod`.
7. Run `npm run convex:deploy`, publish the static site and `admin-portal/dist`, then perform a production quote-and-request smoke test.

Schema changes are additive and Convex migrates them when deployed. Existing booking fields remain compatible; new quote fields are optional on legacy records.
