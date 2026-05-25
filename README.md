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

## Scripts

```bash
npm run dev               # nodemon, hot-reload
npm start                 # production
npm run swagger-autogen   # regenerate swagger-output.json
```

## Branching

- `shahul_dev` — Shahul's work-in-progress branch (this README is on it)
- `dev` — integration branch (PR target)
- `qa` / `live` / `main` — promotion stages

## License

Internal project — Smart Enterprises. Not for redistribution.
