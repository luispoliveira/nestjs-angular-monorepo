# Local Observability Stack

## Purpose

Defines the requirements for a local development observability stack powered by Prometheus and Grafana, provisioned via `docker-compose.yaml`. Covers automatic scraping of all NestJS apps, Grafana datasource provisioning, and cross-platform (Linux) compatibility documentation.

---

## Requirements

### Requirement: Prometheus scrapes all apps in local development

The `docker-compose.yaml` SHALL include a Prometheus service (`prom/prometheus`) that scrapes all NestJS apps (`auth`, `api`, `cron`, `notifications`, `worker`) running on the host via `host.docker.internal`. Every app shares the same `/api` prefix and is distinguished by port, not by path. The scrape config SHALL live in `docker/prometheus/prometheus.yml` and be mounted as a volume.

#### Scenario: Prometheus service starts with docker:up

- **WHEN** `pnpm docker:up` is run
- **THEN** a Prometheus instance is accessible at `http://localhost:9090`

#### Scenario: All app scrape targets are configured

- **WHEN** the Prometheus UI target list is viewed
- **THEN** scrape targets exist for `auth` (port 3000), `api` (port 3100), `notifications` (port 3200), `worker` (port 3300), and `cron` (port 3400)

---

### Requirement: Grafana is provisioned with Prometheus as a datasource

The `docker-compose.yaml` SHALL include a Grafana service (`grafana/grafana`) with a provisioned Prometheus datasource pointing to the Prometheus service. The provisioning config SHALL live in `docker/grafana/provisioning/datasources/prometheus.yaml`.

#### Scenario: Grafana accessible after docker:up

- **WHEN** `pnpm docker:up` is run
- **THEN** Grafana is accessible at `http://localhost:3333`

#### Scenario: Prometheus datasource is pre-configured

- **WHEN** Grafana is opened for the first time
- **THEN** a Prometheus datasource named "Prometheus" is available without manual configuration

---

### Requirement: Linux compatibility is documented in the scrape config

The `docker/prometheus/prometheus.yml` file SHALL include a comment instructing Linux users to add `extra_hosts: ["host.docker.internal:host-gateway"]` to the Prometheus service definition in `docker-compose.yaml`.

#### Scenario: Linux instructions present in config

- **WHEN** `docker/prometheus/prometheus.yml` is read
- **THEN** a comment describes the `extra_hosts` workaround for Linux
