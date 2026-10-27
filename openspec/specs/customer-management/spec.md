# customer-management Specification

## Purpose

Lets backoffice users manage customer records through the API and the admin UI. It is also the template's reference vertical slice for building a business resource end to end.

## Requirements

### Requirement: Customer resource is exposed over versioned REST

The API SHALL expose customers under `/api/v1/customers` with five operations: list (`GET /`), get one (`GET /:id`), create (`POST /`), partial update (`PATCH /:id`) and soft delete (`DELETE /:id`). Every customer representation SHALL contain `id`, `name`, `email`, `taxId`, `notes`, `createdAt` and `updatedAt`. `email`, `taxId` and `notes` are null when absent.

#### Scenario: Create returns the stored customer

- **WHEN** an admin sends `POST /api/v1/customers` with a valid body
- **THEN** the response is 201 with the created customer representation, including a generated `id`, `createdAt` and `updatedAt`

#### Scenario: Get one returns the customer

- **WHEN** an authenticated user sends `GET /api/v1/customers/:id` for an existing, non-deleted customer
- **THEN** the response is 200 with that customer's representation

#### Scenario: Partial update changes only the sent fields

- **WHEN** an admin sends `PATCH /api/v1/customers/:id` with only `name`
- **THEN** the response is 200, `name` is updated and every other field keeps its previous value

#### Scenario: Unknown customer

- **WHEN** any customer operation targets an id that does not exist
- **THEN** the response is 404

### Requirement: Customer input is validated by the shared schema

Create and update bodies SHALL be validated against the same schemas that the admin UI uses. `name` is required on create and must be 1–200 characters after trimming. `email` is optional and must be a valid email. `notes` is optional, at most 2000 characters. `taxId` is optional and must be a valid Portuguese NIF. On update, every field is optional, and sending `null` clears `email`, `taxId` or `notes`.

#### Scenario: Missing name on create

- **WHEN** an admin sends `POST /api/v1/customers` without `name`
- **THEN** the response is 400 and no customer is created

#### Scenario: Invalid NIF

- **WHEN** an admin sends a create or update body whose `taxId` fails the NIF checksum
- **THEN** the response is 400 and no customer is created or changed

#### Scenario: Clearing the NIF

- **WHEN** an admin sends `PATCH /api/v1/customers/:id` with `taxId: null`
- **THEN** the response is 200 and the customer's `taxId` is null

### Requirement: Reading customers requires authentication; writing requires admin

Any authenticated user SHALL be able to list and get customers. Create, update and delete SHALL require the `admin` role. Unauthenticated requests to any customer operation SHALL be rejected.

#### Scenario: Unauthenticated request

- **WHEN** a request without a valid session reaches any customer operation
- **THEN** the response is 401

#### Scenario: Non-admin reads

- **WHEN** an authenticated user without the `admin` role lists or gets customers
- **THEN** the request succeeds

#### Scenario: Non-admin writes

- **WHEN** an authenticated user without the `admin` role sends a create, update or delete request
- **THEN** the response is 403 and no data changes

### Requirement: Customers are soft deleted

Deleting a customer SHALL mark it as deleted rather than remove the row. A deleted customer SHALL be indistinguishable from a non-existent one for every customer operation: it is excluded from lists, get/update/delete return 404, and it does not count toward NIF uniqueness.

#### Scenario: Delete

- **WHEN** an admin sends `DELETE /api/v1/customers/:id` for an existing customer
- **THEN** the response is 204 and the record remains in storage marked as deleted

#### Scenario: Deleted customer is hidden

- **WHEN** any user gets, updates or deletes a customer that was already deleted
- **THEN** the response is 404

#### Scenario: Deleted customer not listed

- **WHEN** the customer list is requested after a customer was deleted
- **THEN** that customer does not appear in `items` and is not counted in `meta.total`

### Requirement: NIF is unique among active customers

No two non-deleted customers SHALL share the same NIF, compared after normalization. A create or update that would violate this SHALL be rejected with 409 and SHALL NOT change any data. That holds even under concurrent requests. The NIF of a deleted customer SHALL be available for reuse.

#### Scenario: Duplicate NIF on create

- **WHEN** an admin creates a customer with a NIF that an active customer already holds, written with different spacing or a `PT` prefix
- **THEN** the response is 409 and no customer is created

#### Scenario: Duplicate NIF on update

- **WHEN** an admin updates a customer's `taxId` to a NIF that another active customer holds
- **THEN** the response is 409 and the customer is unchanged

#### Scenario: Reuse after delete

- **WHEN** the customer holding a NIF is deleted and an admin then creates a new customer with that NIF
- **THEN** the response is 201

### Requirement: Customer list is paginated and sortable from an allow-list

`GET /api/v1/customers` SHALL return the shared paginated shape `{ items, meta }` and accept `skip` (default 0), `take` (1–100, default 20), `sortBy` and `sortOrder` (`asc` | `desc`). `sortBy` SHALL accept only `name`, `email`, `createdAt` and `updatedAt`. The default order SHALL be `createdAt` descending.

#### Scenario: Default listing

- **WHEN** an authenticated user requests the list without query parameters
- **THEN** at most 20 customers are returned, newest first, with `meta.total` equal to the number of active customers

#### Scenario: Sort field outside the allow-list

- **WHEN** the list is requested with `sortBy=taxId` or any field not in the allow-list
- **THEN** the response is 400

#### Scenario: Page size above the limit

- **WHEN** the list is requested with `take=101`
- **THEN** the response is 400

### Requirement: Customer list supports a single search term

The list SHALL accept an optional `search` term. A non-blank term SHALL match customers whose `name` or `email` contains it, case-insensitively. When the term normalizes to a valid NIF, customers holding exactly that NIF SHALL also match. A blank or absent term SHALL not filter. Search SHALL combine with pagination and sorting.

#### Scenario: Partial name match

- **WHEN** the list is requested with `search=silva`
- **THEN** customers whose name or email contains "silva" in any letter case are returned

#### Scenario: Exact NIF match

- **WHEN** the list is requested with `search` set to a customer's valid NIF in any accepted notation
- **THEN** that customer is returned

#### Scenario: Partial NIF does not match by NIF

- **WHEN** the list is requested with `search` set to the first five digits of a customer's NIF
- **THEN** that customer is not returned because of its NIF

### Requirement: Admin UI lists and manages customers

The web app SHALL provide a `/customers` page inside the authenticated shell, reachable from the navigation by every authenticated user. It SHALL show a paginated, searchable table of customers. Admins SHALL additionally be able to create, edit and delete customers. Non-admins SHALL see no write controls.

#### Scenario: Admin manages customers

- **WHEN** an admin opens `/customers`
- **THEN** the table is shown together with controls to create a customer and to edit or delete each row

#### Scenario: Non-admin reads only

- **WHEN** an authenticated non-admin opens `/customers`
- **THEN** the table is shown and no create, edit or delete control is present

#### Scenario: Unauthenticated access

- **WHEN** an unauthenticated visitor opens `/customers`
- **THEN** they are redirected to sign-in before any customer data renders

#### Scenario: Delete requires confirmation

- **WHEN** an admin chooses to delete a customer
- **THEN** the deletion happens only after they confirm it in a dialog

### Requirement: Customer forms validate with the shared schema and surface server conflicts

The create and edit forms SHALL validate with the same schemas the API uses and SHALL show field-level errors before submission. A 409 from the API SHALL be shown as an error on the NIF field. Any other failure SHALL be reported to the user without closing the form.

#### Scenario: Invalid NIF in the form

- **WHEN** an admin types a NIF that fails the checksum
- **THEN** the NIF field shows an error and the form cannot be submitted

#### Scenario: Duplicate NIF from the server

- **WHEN** submitting the form returns 409
- **THEN** the form stays open and the NIF field shows that the NIF is already in use

#### Scenario: List refreshes after a write

- **WHEN** a create, edit or delete succeeds
- **THEN** the table reflects the change without a manual page reload

### Requirement: Customer responses are validated at the network boundary

The web app SHALL parse every customer response through the shared response schemas before it uses the data. A malformed response SHALL surface as a load error instead of rendering partial data.

#### Scenario: Malformed list response

- **WHEN** the list response lacks `meta.total` or an item lacks `id`
- **THEN** the page shows a load error and renders no rows from that response
