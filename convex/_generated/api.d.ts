/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as catalog from "../catalog.js";
import type * as customers from "../customers.js";
import type * as documents from "../documents.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as pdfActions from "../pdfActions.js";
import type * as places from "../places.js";
import type * as sites from "../sites.js";
import type * as solutions from "../solutions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  catalog: typeof catalog;
  customers: typeof customers;
  documents: typeof documents;
  http: typeof http;
  migrations: typeof migrations;
  pdfActions: typeof pdfActions;
  places: typeof places;
  sites: typeof sites;
  solutions: typeof solutions;
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
