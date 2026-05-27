# Smart Enterprises — Inverter Management API

REST API for Smart Enterprises' B2B inverter sales & manufacturing workflow. Powers the [web app](https://github.com/smart-enterprises/inverter-management-web) and the mobile app. Built on Node.js + Express + MongoDB (Atlas).

## What the project is

A **build-to-order B2B** system for an inverter manufacturer working with a dealer network. The API tracks:

- Salesmen booking orders on behalf of dealers
- Stock allocation across `PACKED` / `UNPACKED` / `PRODUCTION` buckets
- Order workflow: `PENDING → CONFIRMED → PRODUCTION → PACKED → INVOICE → SHIPPED → DELIVERED → COMPLETED` (plus `CANCELLED` / `REJECTED` side states)
- Per-detail status (so partial fulfillment is first-class)
- Dealer discounts, GST invoicing, payment tracking
- Role-based access for super-admin, admin, manager, salesman, production, packing, accounts, delivery, dealer

Side concerns: notifications (Firebase), file storage (AWS S3), bulk Excel import, salesman targets / analytics.

## Tech stack

- **Node.js** + **Express**
- **MongoDB Atlas** (Mongoose)
- **JWT** auth
- **AWS S3** for file uploads
- **Firebase Admin** for push notifications
- **Swagger** auto-generated API docs at `/api-docs`
- **nodemon** for dev hot-reload (watches `.env` too)

## Project structure

```
controllers/     route handlers (thin — delegate to services)
service/         business logic (orderService, analyticsService, ...)
  order/         order-specific helpers split by concern
models/          Mongoose schemas
routes/          Express route definitions
middleware/      auth, error handling, request context, sanitization
utils/           constants, validators, model mappers, helpers
validations/     request payload validators
config/          DB connection, secrets, etc.
postman/         API collection (importable into Postman)
server.js        entry point
```

## Routes (mounted under `/api/v1`)

| Path | Purpose |
|---|---|
| `/auth` | login, logout, password reset |
| `/employees` | users, dealers, dealer discounts |
| `/product-details` | products, brands, stock, price history |
| `/order-details` | orders, order lines, status updates, production summary |
| `/invoice-details` | invoices |
| `/company-address` | company / billing addresses |
| `/locations` | districts, towns lookup |
| `/upload-excel` | bulk import (products, dealers, etc.) |
| `/notifications` | in-app notifications, device tokens |
| `/analytics` | dashboard metrics, salesman achievement |

Public docs at `GET /api-docs` (Swagger UI).

## Getting started

```bash
git clone https://github.com/smart-enterprises/inverter-management-api.git
cd inverter-management-api
npm install
cp .env.example .env   # fill in the values below
npm run dev            # nodemon, hot-reloads on file or .env change
```

### Required `.env` variables

```
PORT=1280
ENVIRONMENT=development
MONGO_URL=mongodb+srv://USER:PASS@CLUSTER/DB?retryWrites=true&w=majority

JWT_SECRET=...                # used to sign access tokens
JWT_EXPIRES_IN=364d

# Super-admin bootstrap (first-run seed only)
SUPER_ADMIN=...
SUPER_ADMIN_EMAIL=...
SUPER_ADMIN_PHONE=...
SUPER_ADMIN_PASSWORD=...

ENCRYPTION_SECRET_KEY=...     # password reveal / encrypted-at-rest data
ALLOWED_ORIGINS=http://localhost:5173,https://erp.smartenterprises.online

AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=eu-north-1
S3_BUCKET_NAME=smartenterprises

FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Feature flags
ENABLE_STOCK_RETURNS=false    # when true, cancelling an order auto-returns stock
SALESMAN_DEFAULT_TARGET_QTY=500  # fallback target for salesman analytics
```

⚠️ **Never commit `.env`.** It's gitignored. Rotate any secret that leaks.

## Order workflow

Orders move through a forward-only state machine (`utils/constants.js → ALLOWED_TRANSITIONS`):

```
PENDING ──┬──► CONFIRMED ──► PRODUCTION ──► PACKED ──► INVOICE ──► SHIPPED ──► DELIVERED ──► COMPLETED
          └──► REJECTED                                                                            ▲
                                                                                                   │
PENDING / CONFIRMED / PRODUCTION / PACKED ────────────────────────► CANCELLED                      │
                                                                                                   │
(when ALL details fully delivered the order auto-flips to COMPLETED) ──────────────────────────────┘
```

- **`DELIVERED`** = at least one line delivered, some still pending
- **`COMPLETED`** = all lines fully delivered (auto-set by `allDetailsDelivered`)
- **`REJECTED`** = allowed only from `PENDING`
- **`CANCELLED`** = allowed up to and including `PACKED`; after `INVOICE`, issue a credit note instead
- **Immutable end states:** `DELIVERED`, `COMPLETED`, `CANCELLED`, `REJECTED` (no further edits)

The order's status is derived from its line items (`order_details`). See `service/order/orderStatus.js`.

## Stock workflow

Each product tracks three buckets: `PACKED` (ready to ship), `UNPACKED` (needs packing), `PRODUCTION` (to be manufactured). At order time, the system allocates from these in priority `PACKED → UNPACKED → PRODUCTION` and flags the order line accordingly.

When an order is cancelled, **stock auto-return is OFF by default** (controlled by `ENABLE_STOCK_RETURNS`). Cancellation always records the audit trail and updates `total_cancelled_qty`; only the physical stock movement is gated by the flag.

## Recent changes — May 2026

What we shipped over the last week:

### Orders list filtering (`GET /api/v1/order-details`)
- New `salesman` query param: admin/manager/super-admin can filter by salesman.
- Salesman role's view is still locked to their own `salesman_id` (server-side enforced).
- Existing filters unchanged: `status`, `priority`, `search`, `dealer`, `startDate`, `endDate`, `deliveryStartDate`, `deliveryEndDate`.

### Production Summary endpoint
- New `GET /api/v1/order-details/production-summary`.
- Per-product remaining qty grouped by status (`PRODUCTION`, `PACKED`, `INVOICE`, `SHIPPED`).
- Drill-down: each product also returns a `dealers[]` array with each dealer's per-status counts (name, shop, town, phone, qty).
- `remaining_qty = max(0, qty_ordered − qty_delivered − total_cancelled_qty)`. Delivered and cancelled units are excluded.
- **Access:** super-admin, admin, manager only (enforced both client- and server-side via `validateMainRoleAccess()` → 403 otherwise).

### Order response shape — `order.progress`
Every order endpoint now returns a `progress` field:
```json
{
  "qty_ordered_total": 22,
  "qty_delivered_total": 13,
  "qty_cancelled_total": 2,
  "qty_in_production_total": 2,
  "qty_packed_total": 0,
  "qty_invoiced_total": 0,
  "qty_shipped_total": 5,
  "qty_remaining_total": 7,
  "items_total": 3,
  "items_delivered": 1,
  "delivered_percent": 59
}
```
Lets the UI render partial fulfillment without inventing new statuses.

### Status workflow cleanup
- `IMMUTABLE_ORDER_STATUSES` now includes `REJECTED` and `COMPLETED` (previously only `DELIVERED` and `CANCELLED`).
- `ALLOWED_TRANSITIONS` adds explicit `DELIVERED → COMPLETED` edge.
- Renamed internal `ORDER_STATUS_TRANSITIONS` to `DETAIL_STATUSES_REQUIRED_FOR_ORDER_TARGET` and removed nonsensical backward rows.
- Cancellation error message now mentions the GST credit-note path for invoiced orders.

### Stock auto-return — fully gated
Previously only one of three call sites honoured `ENABLE_STOCK_RETURNS`. Cancelling a whole order or flipping it to `CANCELLED`/`REJECTED` would still move stock back regardless. All three sites now check the flag consistently. With `ENABLE_STOCK_RETURNS=false` (the default), no stock auto-return happens anywhere; cancellation accounting (status, audit history, `total_cancelled_qty`, price recalc) still runs.

### Salesman achievement now honours per-salesman targets
`GET /api/v1/analytics/salesman-achievement` previously used `DEFAULT_SALESMAN_TARGET_QTY` for every salesman, ignoring the `assignedTarget` field that admins set per-user in the employees collection. Now each row uses the salesman's own `assignedTarget` when it's > 0, falling back to the default otherwise. Each row also exposes a `target_source: "assigned" | "default"` so the UI can show which target is in effect.

### Search regex hardening
Every search endpoint built a `RegExp` directly from user input. Two problems:
- A search term containing `(`, `)`, or other unclosed regex metacharacters crashed the endpoint with `HTTP 500: Invalid regular expression`.
- A search term like `.*` was interpreted as regex syntax and matched every record — instead of being treated as a literal `.*` string.

New `escapeRegex(value)` helper in `utils/validationUtils.js` escapes the metacharacters `.*+?^${}()|[]\` before building the pattern. Applied at every site that turns user input into a regex:
- `orderService.getAllOrders` (order list search)
- `validationUtils.buildEmployeeQueryFilter` (employee/dealer search)
- `productService.getProducts` (product search)
- `publicController.search` (global search)

Now `(` returns 0 results (literal lookup), `.*` returns 0 (no record contains the literal characters), and normal alphanumeric search behaves exactly the same as before.

Verified end-to-end against the live DB.

### Role-based notifications wired into the remaining order flows
Previously notifications only fired from `createOrder` and `updateOrderAndDetails` — most real-world updates (per-item status changes, batch detail updates, add-items) sent nothing. Now:

- `updateOrderDetailStatus` (single-line route handler) fires `ORDER_STATUS_*` when the parent order's status actually moves. Internal cascade callers (`updateOrderDetailsBatch`, `updateOrderAndDetails`) pass `{ skipParentNotification: true }` so the parent owns the aggregate signal instead of N+1.
- `updateMultipleOrderDetailsStatus` fires `ORDER_CONFIRMED` or `ORDER_STATUS_*` based on the status delta.
- `addItemsToOrder` fires the new `ORDER_ITEMS_ADDED` type — targets `SUPER_ADMIN / ADMIN / MANAGER / PRODUCTION / PACKING` so production teams see new work.

### Notification de-duplication on production completion
When `has_production_completed: true` is set in `updateOrderAndDetails` and the parent order auto-flips to `PACKED`, only the more informative `ORDER_STATUS_PRODUCTION_COMPLETED` push fires. The redundant generic `ORDER_STATUS_PACKED` push that used to also fire for the same event is now suppressed. If the order moves anywhere other than PACKED on the same call (unusual), both still fire.

### Add items to an existing order
New endpoint: `POST /api/v1/order-details/:orderNumber/items`. Appends new line items to an order without going through the full create flow. Validates the same per-item rules as `create-order`. After insert, recalculates `order_total_price`, `order_total_discount`, `promised_delivery_date`, and re-derives the parent order's status (a new production-needing line on a PACKED order regresses to PRODUCTION).

Access: order's original creator OR `SUPER_ADMIN` / `ADMIN` / `MANAGER`. Blocked when order is in `DELIVERED` / `COMPLETED` / `CANCELLED` / `REJECTED`.

GST note: currently allowed at any non-terminal status, including `INVOICE` and `SHIPPED`, because real GST/billing isn't in this system yet. When invoicing is added, this should be tightened to mirror `assertCancellable` (block once invoiced).

### Schema-based request validation on critical writes
Critical write endpoints now run an `express-validator` chain at the route boundary before any business logic. Catches malformed input (wrong types, negative quantities, missing required fields, unknown enum values) and returns a `400 ValidationException` with field-level error messages.

Endpoints with new validation:
- `POST /order-details/create-order` — dealer_id, priority enum, order_details array with per-item qty/product_id/delivery_date checks
- `POST /product-details/create-product` — brand/model/name/type required, price/cost non-negative, status & product_category enums
- `PUT /product-details/:productId` — same rules, all optional (partial update)
- `POST /employees/dealer/create-discount` — required fields + discount_value non-negative + is_percentage boolean
- `POST /employees/dealer/create-discounts` — array variant of the above
- `PUT /employees/dealer/update-discount` — dealer_discount_id required, rest optional

Shared rejection middleware in `validations/orderValidation.js → validateRequest` throws `ValidationException` so the response shape matches the rest of the API.

### Server-side role gates on admin-only endpoints
Previously most admin actions trusted only the frontend's `routePermissions.js` — anyone with a valid JWT could curl them directly. `validateMainRoleAccess()` (allows `SUPER_ADMIN`, `ADMIN`, `MANAGER`) is now applied to:
- `PUT /employees/update/delete-employee` (deleteEmployee)
- `PUT /employees/update/reset-password/:employeeId` (resetPasswordById — resetting *another* user's password; self-reset endpoint stays open)
- `POST /employees/dealer/create-discount`, `POST /employees/dealer/create-discounts`, `PUT /employees/dealer/update-discount`
- `POST /product-details/create-product`, `PUT /product-details/:productId`, `PUT /product-details/createOrUpdate/product-stocks`
- `POST /product-details/create/brands`, `PUT /product-details/brand/:brandName`
- `POST /upload-excel` (bulk import)

Non-allowed roles now get `403 ForbiddenException` server-side. Existing read endpoints are unchanged.

## Scripts

```bash
npm run dev               # nodemon, hot-reload
npm start                 # production
npm run swagger-autogen   # regenerate swagger-output.json
```

## Known limitations / TODO

These are gaps identified in the May 2026 audit. **Not blocking everyday use**, but worth knowing about and fixing when time allows.

### Auth — JWT lifetime + in-memory blacklist
- `JWT_EXPIRES_IN=364d`. A single long-lived access token. If it leaks, the attacker has up to a year of access.
- Logout writes the token to an **in-memory** blacklist (`service/tokenBlacklistService.js`). Any server restart (nodemon, deploy, crash) wipes it, so "logged-out" tokens become valid again.
- **Recommended fix:** switch to access + refresh token pattern. Access token 15m–1h, refresh token 30d stored in MongoDB with a TTL index. Add `POST /auth/refresh` endpoint. Requires coordinated changes on web + mobile clients.
- **Interim mitigation if not done:** rotate `JWT_SECRET` periodically (invalidates everything), persist the blacklist in MongoDB, and cut lifetime to ~7d.

### Stock allocation race condition AND createOrder is not transactional
- `productService.checkAndReserveStock` does read-then-save without a transaction or atomic op. Two concurrent orders for the same product can both see the same starting stock and both subtract — overselling possible under load.
- `orderService.createOrder` writes stock → Order → OrderDetails sequentially without a session. Mid-flight failure leaves inconsistent state (stock debited but order not saved, or order saved with no detail lines).
- **Recommended fix:** wrap `createOrder` in `mongoose.startSession()` + `withTransaction()`, and inside the transaction replace `checkAndReserveStock`'s read-then-save with `Stock.findOneAndUpdate({ product_id, packed_stock: { $gte: needed }}, { $inc: { packed_stock: -needed }}, { session })`. Single atomic op per stock bucket + multi-doc consistency.
- **Status: parked.** Per business decision the stock system is paused while the rest of the platform stabilises. Re-open this work around Dec 2026 (≈6–7 months from May 2026) when stock is brought back online.

### Role enforcement — substantially addressed
- The frontend `routePermissions.js` map blocks routes per role; the backend has `validateMainRoleAccess()` applied to all the main admin-only endpoints (see "Recent changes — Server-side role gates" above for the full list).
- `GET /employees/get/employees-password` now requires `SUPER_ADMIN` (via the stricter `validateSuperAdminAccess()` helper).
- **Still open:** order-status mutations (`PUT /order-details/status/:orderNumber` and per-detail updates), invoice mutations, and notification admin endpoints aren't gated yet — review whether they need role checks.

### Other notes
- `console.info(...)` still used in a few places (e.g. `updateOrderAndDetails`) — should standardise on `logger`.
- Global JSON body limit is 100mb. Consider per-route caps for the smaller endpoints.

## Branching

- `shahul_dev` — Shahul's work-in-progress branch (this README is on it)
- `dev` — integration branch (PR target)
- `qa` / `live` / `main` — promotion stages

## License

Internal project — Smart Enterprises. Not for redistribution.
