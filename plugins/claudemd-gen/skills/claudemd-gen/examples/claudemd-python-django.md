# Example: Python Django CLAUDE.md

This is a complete example for a Django web application.

---

```markdown
# CLAUDE.md

E-commerce platform backend. Django 5 + DRF + PostgreSQL + Celery for async tasks.

## Build & Test

- `python manage.py runserver` — Dev server (port 8000)
- `python manage.py test` — Run all tests
- `python manage.py test apps.orders.tests.test_checkout` — Run specific test module
- `ruff check .` — Lint
- `ruff format .` — Auto-format
- `mypy .` — Type checking

### Database

- `python manage.py migrate` — Apply migrations
- `python manage.py makemigrations` — Create new migration
- `python manage.py makemigrations --check` — Verify no pending migrations (CI uses this)

### Environment

- Python 3.12 + virtualenv
- `source .venv/bin/activate` before running commands
- Copy `.env.example` to `.env` for local config
- `pip install -r requirements/dev.txt` — Install dev dependencies

## Architecture

### App Structure

- `apps/accounts/` — User auth, profiles, permissions
- `apps/products/` — Product catalog, categories, search
- `apps/orders/` — Cart, checkout, payment integration
- `apps/notifications/` — Email/SMS via Celery tasks
- `core/` — Base models, mixins, shared utilities

### Key Patterns

- **Fat models, thin views** — Business logic lives in model methods and managers, not views
- **Service layer** — Complex operations (checkout, payment) use `apps/<app>/services.py`
- **Signals sparingly** — Only for cross-app side effects. Document in `apps/<app>/signals.py`

## Conventions

- Models: `TimeStampedModel` base (from `core/models.py`) for all models
- Serializers: one per use case, not one per model (`OrderListSerializer`, `OrderDetailSerializer`)
- URLs: RESTful. Use DRF routers for viewsets. Manual urlpatterns for custom views.
- Tests: `TestCase` for DB tests, `SimpleTestCase` for pure logic. Factory Boy for fixtures.
- Celery tasks: always accept primitive args (IDs, not objects). Idempotent.

## Common Pitfalls

- Forgetting `makemigrations` after model changes — tests pass locally but CI fails
- Circular imports between apps — use string references for ForeignKey: `"accounts.User"`
- Celery tasks silently fail without `CELERY_TASK_ALWAYS_EAGER=True` in test settings
```
