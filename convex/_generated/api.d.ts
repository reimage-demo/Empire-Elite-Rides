/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminAuth from "../adminAuth.js";
import type * as adminAuthMaintenance from "../adminAuthMaintenance.js";
import type * as bookings from "../bookings.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bookingState from "../lib/bookingState.js";
import type * as lib_defaultPricing from "../lib/defaultPricing.js";
import type * as lib_pricingConfig from "../lib/pricingConfig.js";
import type * as lib_pricingCore from "../lib/pricingCore.js";
import type * as lib_sessionToken from "../lib/sessionToken.js";
import type * as lib_stripeWebhookCore from "../lib/stripeWebhookCore.js";
import type * as lib_time from "../lib/time.js";
import type * as notifications from "../notifications.js";
import type * as paymentRecords from "../paymentRecords.js";
import type * as payments from "../payments.js";
import type * as pricingAdmin from "../pricingAdmin.js";
import type * as promotions from "../promotions.js";
import type * as promotionsAdmin from "../promotionsAdmin.js";
import type * as quotes from "../quotes.js";
import type * as reservations from "../reservations.js";
import type * as stripeWebhook from "../stripeWebhook.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminAuth: typeof adminAuth;
  adminAuthMaintenance: typeof adminAuthMaintenance;
  bookings: typeof bookings;
  crons: typeof crons;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/bookingState": typeof lib_bookingState;
  "lib/defaultPricing": typeof lib_defaultPricing;
  "lib/pricingConfig": typeof lib_pricingConfig;
  "lib/pricingCore": typeof lib_pricingCore;
  "lib/sessionToken": typeof lib_sessionToken;
  "lib/stripeWebhookCore": typeof lib_stripeWebhookCore;
  "lib/time": typeof lib_time;
  notifications: typeof notifications;
  paymentRecords: typeof paymentRecords;
  payments: typeof payments;
  pricingAdmin: typeof pricingAdmin;
  promotions: typeof promotions;
  promotionsAdmin: typeof promotionsAdmin;
  quotes: typeof quotes;
  reservations: typeof reservations;
  stripeWebhook: typeof stripeWebhook;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
