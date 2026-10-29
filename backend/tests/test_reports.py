"""Reportes de mantenimiento: folio, privacidad, estados y aislamiento por departamento."""

from __future__ import annotations

from app.core.tracking import is_valid_tracking_code

from .conftest import login


def _categories(client) -> dict[str, dict]:
    return {c["code"]: c for c in client.get("/api/public/report-categories").json()["categories"]}


def _create(client, category_code: str = "electrico", **extra) -> dict:
    cat = _categories(client)[category_code]
    payload = {
        "category_id": cat["id"],
        "location_text": "Edificio A, pasillo planta alta",
        "description": "Dos lámparas fundidas frente al aula 17",
        **extra,
    }
    response = client.post("/api/public/reports", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_public_report_gets_tracking_code(client):
    created = _create(client, contact_email="alumno@correo.mx")
    assert is_valid_tracking_code(created["tracking_code"])
    assert created["status"] == "recibido" and created["department"] == "Mantenimiento"
    public = client.get(f"/api/public/reports/{created['tracking_code']}").json()
    assert public["status_label"] == "Recibido"
    assert "contact_email" not in public and "description" not in public  # sin datos personales


def test_lookup_accepts_lowercase_and_rejects_bad_format(client):
    code = _create(client)["tracking_code"]
    assert client.get(f"/api/public/reports/{code.lower()}").status_code == 200
    assert client.get("/api/public/reports/hola").status_code == 422
    assert client.get("/api/public/reports/UNI-2222-2222").status_code == 404


def test_honeypot_and_validation(client):
    cat = _categories(client)["limpieza"]
    bot = client.post(
        "/api/public/reports",
        json={
            "category_id": cat["id"],
            "location_text": "Baños",
            "description": "Texto de prueba suficiente",
            "website": "spam.com",
        },
    )
    assert bot.status_code == 400
    short = client.post(
        "/api/public/reports", json={"category_id": cat["id"], "location_text": "B", "description": "x"}
    )
    assert short.status_code == 422


def test_rate_limit_on_reports(client):
    for _ in range(5):
        _create(client)
    cat = _categories(client)["electrico"]
    blocked = client.post(
        "/api/public/reports",
        json={"category_id": cat["id"], "location_text": "Edificio B", "description": "Otro reporte más de prueba"},
    )
    assert blocked.status_code == 429


def test_department_updates_status_with_history(make_client):
    public = make_client()
    code = _create(public)["tracking_code"]
    staff = make_client()
    headers = login(staff, "mantenimiento")
    reports = staff.get("/api/admin/reports").json()["reports"]
    report = next(r for r in reports if r["tracking_code"] == code)
    assert report["allowed_transitions"] == ["en_revision", "asignado", "descartado"]

    invalid = staff.patch(f"/api/admin/reports/{report['id']}/status", headers=headers, json={"status": "resuelto"})
    assert invalid.status_code == 409

    ok = staff.patch(
        f"/api/admin/reports/{report['id']}/status",
        headers=headers,
        json={"status": "asignado", "internal_note": "Cuadrilla 2", "public_note": "Técnico asignado"},
    )
    assert ok.status_code == 200 and ok.json()["status"] == "asignado"
    history = public.get(f"/api/public/reports/{code}").json()["history"]
    assert [h["status"] for h in history] == ["recibido", "asignado"]
    assert history[-1]["public_note"] == "Técnico asignado"
    assert "internal_note" not in history[-1]


def test_other_department_cannot_see_or_update(make_client):
    public = make_client()
    _create(public, "limpieza")  # pertenece a Servicios del Campus
    maint = make_client()
    headers = login(maint, "mantenimiento")
    assert maint.get("/api/admin/reports").json()["reports"] == []
    campus = make_client()
    login(campus, "campus")
    report_id = campus.get("/api/admin/reports").json()["reports"][0]["id"]
    forbidden = maint.patch(f"/api/admin/reports/{report_id}/status", headers=headers, json={"status": "en_revision"})
    assert forbidden.status_code == 404
