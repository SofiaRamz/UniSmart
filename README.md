# UniSmart AI

Asistente universitario: chatbot con RAG sobre documentos oficiales, horarios estructurados,
mapa del campus (Leaflet), reportes de mantenimiento con folio y portal administrativo con RBAC
por departamento.

| Capa | Tecnología |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Argon2id, sesiones con cookie HttpOnly + CSRF |
| Base de datos | PostgreSQL 16 + pgvector (o `double precision[]` si pgvector no está instalado) |
| IA | Qwen3-4B Instruct en LM Studio (API compatible con OpenAI), embeddings locales |
| Frontend | React 19 + Tailwind CSS 4 + Leaflet (Vite). Compilado listo en `backend/static/index.html` |

## Inicio rápido (Windows, PowerShell)

```powershell
docker compose up -d                       # PostgreSQL + pgvector
cd backend
py -3.12 -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env                # edita SECRET_KEY y LLM_MODEL
alembic upgrade head
python -m app.seed --demo
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Abre http://localhost:8000 (portal) y http://localhost:8000/api/docs (API).

## Reglas de diseño

- **Horarios fuera del RAG.** Se importan desde CSV (`scripts/import_schedules.py`) y se consultan con SQL exacto.
- **Regla de oro del chat.** Sin evidencia suficiente la respuesta es exactamente
  «No tengo información oficial sobre esto en los documentos cargados.» y el modelo ni siquiera se llama.
- **RBAC en el servidor.** Cada endpoint reconstruye los permisos desde la sesión guardada en la base:
  departamento → módulos (`documents`, `schedules`, `reports`, `locations`).

## Pruebas

```powershell
cd backend
pytest                                     # SQLite en memoria
$env:TEST_DATABASE_URL="postgresql+psycopg://unismart:unismart_dev_2026@localhost:5432/unismart_test"; pytest
```
