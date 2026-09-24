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
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as invoiceEmails from "../invoiceEmails.js";
import type * as invoiceLinks from "../invoiceLinks.js";
import type * as invoices from "../invoices.js";
import type * as migrations from "../migrations.js";
import type * as payments from "../payments.js";
import type * as pdfActions from "../pdfActions.js";
import type * as pdfCopies from "../pdfCopies.js";
import type * as pdfCopyFiles from "../pdfCopyFiles.js";
import type * as pdfRenderer from "../pdfRenderer.js";
import type * as places from "../places.js";
import type * as proposalEmails from "../proposalEmails.js";
import type * as proposals from "../proposals.js";
import type * as salesTax from "../salesTax.js";
import type * as settings from "../settings.js";
import type * as signingLinks from "../signingLinks.js";
import type * as sites from "../sites.js";
import type * as sitesPrototype from "../sitesPrototype.js";
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
  email: typeof email;
  http: typeof http;
  invoiceEmails: typeof invoiceEmails;
  invoiceLinks: typeof invoiceLinks;
  invoices: typeof invoices;
  migrations: typeof migrations;
  payments: typeof payments;
  pdfActions: typeof pdfActions;
  pdfCopies: typeof pdfCopies;
  pdfCopyFiles: typeof pdfCopyFiles;
  pdfRenderer: typeof pdfRenderer;
  places: typeof places;
  proposalEmails: typeof proposalEmails;
  proposals: typeof proposals;
  salesTax: typeof salesTax;
  settings: typeof settings;
  signingLinks: typeof signingLinks;
  sites: typeof sites;
  sitesPrototype: typeof sitesPrototype;
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
