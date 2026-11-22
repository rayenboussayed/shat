# SHAT — spec v1.0-draft §15.3 target table + build additions.
# npm is the package manager; `make` runs the package.json scripts.

.PHONY: help install setup check lint typecheck test test-unit test-integration \
        test-e2e test-cov test-coverage test-perf test-mem build build-backend \
        build-web build-dashboard build-mobile db-up db-down db-migrate db-reset \
        dev dev-native dev-docker up down logs health compose-config clean \
        docker-build docker-push k8s-validate gen-migrations

help:
	@echo "SHAT — spec v1.0-draft §15.3"
	@echo "  install       npm install --no-audit --no-fund"
	@echo "  setup         install + check"
	@echo "  check         npm run check (typecheck + lint + knip + root tests)"
	@echo "  lint          eslint over the repo"
	@echo "  typecheck     tsc -b tsconfig.base.json + workspace typechecks"
	@echo "  test          all tests (root + workspaces)"
	@echo "  test-unit     unit tests"
	@echo "  test-integration  integration tests"
	@echo "  test-e2e      e2e tests"
	@echo "  test-cov      unit + integration tests with coverage"
	@echo "  test-coverage alias of test-cov"
	@echo "  test-perf     vitest bench"
	@echo "  test-mem      mem tests"
	@echo "  build         build all workspaces"
	@echo "  build-backend|build-web|build-dashboard|build-mobile"
	@echo "  db-up/db-down  start/stop Postgres via Compose"
	@echo "  db-migrate/db-reset  backend db scripts"
	@echo "  dev/dev-native/dev-docker"
	@echo "  up/down/logs  dev Compose stack lifecycle"
	@echo "  health        scripts/health-check.sh (spec §15.4)"
	@echo "  compose-config  validate Compose config"
	@echo "  docker-build/docker-push  build/push production images"
	@echo "  k8s-validate  kubectl dry-run against infrastructure/kubernetes"
	@echo "  gen-migrations  drizzle-kit generate in workspaces"
	@echo "  clean         clean generated outputs"

install:
	npm install --no-audit --no-fund

setup: install
	npm run check

check:
	npm run check

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm run test

test-unit:
	npm run test-unit

test-integration:
	npm run test-integration

test-e2e:
	npm run test-e2e

test-cov:
	npm run test-cov

test-coverage:
	npm run test-cov

test-perf:
	npm run test-perf

test-mem:
	npm run test-mem

build:
	npm run build

build-backend:
	bash -c 'cd apps/backend && npm run build'

build-web:
	bash -c 'cd apps/web && npm run build'

build-dashboard:
	bash -c 'cd apps/dashboard && npm run build'

build-mobile:
	bash -c 'cd apps/mobile && npm run build'

db-up:
	docker compose -f infrastructure/docker/compose.development.yaml up -d postgres

db-down:
	docker compose -f infrastructure/docker/compose.development.yaml down postgres

db-migrate:
	npm run db:migrate

db-reset:
	npm run db-reset

dev:
	npm run dev-native

dev-native:
	npm run dev

dev-docker:
	docker compose -f infrastructure/docker/compose.development.yaml up -d

up: dev-docker

down:
	docker compose -f infrastructure/docker/compose.development.yaml down

logs:
	docker compose -f infrastructure/docker/compose.development.yaml logs -f

health:
	bash scripts/health-check.sh

compose-config:
	docker compose -f infrastructure/docker/compose.development.yaml config > /dev/null
	docker compose -f infrastructure/docker/compose.production.yaml config > /dev/null

docker-build:
	docker compose -f infrastructure/docker/compose.production.yaml build

docker-push:
	docker compose -f infrastructure/docker/compose.production.yaml push

k8s-validate:
	kubectl --dry-run=client apply -f infrastructure/kubernetes/manifests/

gen-migrations:
	npm run gen:migrations

clean:
	npm run clean
