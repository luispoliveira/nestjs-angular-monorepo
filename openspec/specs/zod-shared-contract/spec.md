# Zod Shared Contract

## Purpose

Defines the shared schema package as the enforced contract between the backend services and the browser application, now that there is no generated type-safe transport between them. It covers which runtimes must be able to consume the package, what the package must describe, and where the schemas must actually be applied so that a drifting contract fails loudly instead of producing silently wrong data.

## Requirements

### Requirement: The shared schema package is consumable by both the service and browser build pipelines

The shared schema package SHALL be importable, without transpilation workarounds, by the backend services and by the browser application's bundler. Its published entry points SHALL resolve to files that exist, and its declared module format SHALL match what it actually emits.

#### Scenario: Backend service consumes the package

- **WHEN** any backend service is built
- **THEN** the build succeeds
- **AND** schemas and enums imported from the shared package are usable at runtime

#### Scenario: Browser application consumes the package

- **WHEN** the browser application is built
- **THEN** the build succeeds
- **AND** the build reports no module-interoperability or optimization-bailout warnings attributable to the shared package

#### Scenario: Declared entry points resolve

- **WHEN** the package's declared entry points are resolved
- **THEN** every declared path points to a file that exists in the published output

#### Scenario: Unused schemas are eliminated from the browser bundle

- **WHEN** the browser application imports one schema from the package
- **THEN** schemas it does not import are not retained in the production bundle

---

### Requirement: A single schema library instance is shared across the workspace

The workspace SHALL resolve exactly one version and one instance of the schema library, so that a schema created in one package is recognised as the same construct when used by another.

#### Scenario: One resolved version

- **WHEN** the workspace dependency tree is inspected
- **THEN** exactly one version of the schema library is resolved

#### Scenario: Schema identity holds across package boundaries

- **WHEN** a backend service validates input against a schema defined in the shared package
- **THEN** validation behaves identically to validating against that schema inside the shared package itself

---

### Requirement: The package describes both requests and responses

The shared package SHALL define schemas for the request payloads the browser application sends and for the response payloads it consumes. Response shapes the application depends on SHALL NOT be typed only by a third-party library's exported types.

#### Scenario: Request payload has a schema

- **WHEN** the browser application submits a payload to a backend endpoint
- **THEN** a schema for that payload exists in the shared package
- **AND** the backend derives its validation from that same schema

#### Scenario: Response payload has a schema

- **WHEN** the browser application consumes a response it renders
- **THEN** a schema for that response exists in the shared package

#### Scenario: Paginated responses share one shape

- **WHEN** more than one endpoint returns a paginated collection
- **THEN** they describe pagination with the same shared schema

---

### Requirement: Responses are validated at the network boundary

The browser application SHALL validate responses against the shared response schemas before using them. A response the application cannot render without SHALL cause a visible, reported failure when it does not satisfy its schema. A response whose non-essential parts are malformed MAY be rendered partially rather than failing outright.

#### Scenario: Malformed essential response

- **WHEN** a response the screen cannot render without does not satisfy its schema
- **THEN** the failure is surfaced to the user as an error
- **AND** unvalidated data is not rendered

#### Scenario: Contract drift is loud

- **WHEN** a backend changes a response field in a way that breaks its schema
- **THEN** the browser application reports an error identifying the validation failure
- **AND** does not silently display incorrect data

#### Scenario: Valid response renders

- **WHEN** a response satisfies its schema
- **THEN** it is rendered without any validation error being surfaced

---

### Requirement: Form validation is derived from the shared schemas

The browser application SHALL drive form-field validation from the shared request schemas rather than from separately written validation rules, so that client-side and server-side validity cannot diverge.

#### Scenario: One schema drives both sides

- **WHEN** a form field's validity is evaluated in the browser
- **THEN** the rule applied is the one defined in the shared schema for that payload

#### Scenario: Field-level errors

- **WHEN** a value fails the shared schema
- **THEN** the error is reported against the specific field that failed
- **AND** not only as a whole-form error

#### Scenario: No divergent duplicate rules

- **WHEN** a validation rule changes in a shared schema
- **THEN** the browser application's form validation reflects the change without a separate edit to client-side rules
