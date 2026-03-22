# Sage — Personal Finance Suite

A unified personal finance application with four modules:

| Module | Description | Port |
|--------|-------------|------|
| Budget Planner | Monthly budget planning (client-side, localStorage) | 5050 |
| Cash Flow | Transaction history and reporting (Quicken CSV import) | 5050 |
| Tax | Tax estimation tool | 5050 |
| Investments | Closed-end fund portfolio tracker | 8000 |

## Running Locally

**Budget / Cash Flow / Tax** (port 5050):
```bash
cd budget
python3 api.py
```

**Investments** (port 8000):
```bash
cd investments
python3 -m uvicorn cef.api.app:create_app --factory --host 0.0.0.0 --port 8000 --reload
```

## Design

- Brand color: sage green `#5a7a52`
- Apple-inspired UI, system fonts
- Shared nav across all tabs with theme toggle (light/dark)
