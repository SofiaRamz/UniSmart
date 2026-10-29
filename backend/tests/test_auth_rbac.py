"""Autenticación, sesiones, CSRF y aislamiento entre departamentos."""

from __future__ import annotations

from .conftest import PASSWORD, USERS, login


def test_login_sets_httponly_cookie_and_returns_csrf(client):
    response = client.post("/api/auth/login", json={"email": USERS["control"][0], "password": PASSWORD})
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "unismart_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    body = response.json()
    assert body["csrf_token"] and body["departments"][0]["code"] == "CONTROL_ESCOLAR"
    assert "password_hash" not in body


def test_wrong_password_is_generic(client):
    bad = client.post("/api/auth/login", json={"email": USERS["control"][0], "password": "incorrecta123"})
    unknown = client.post("/api/auth/login", json={"email": "nadie@unismart.test", "password": "incorrecta123"})
    assert bad.status_code == unknown.status_code == 401
    assert bad.json()["detail"] == unknown.json()["detail"]


def test_account_locks_after_failed_attempts(client):
    for _ in range(5):
        client.post("/api/auth/login", json={"email": USERS["campus"][0], "password": "incorrecta123"})
    locked = client.post("/api/auth/login", json={"email": USERS["campus"][0], "password": PASSWORD})
    assert locked.status_code == 429


def test_me_requires_session(client):
    assert client.get("/api/auth/me").status_code == 401
    login(client, "coordinacion")
    me = client.get("/api/auth/me").json()
    assert me["departments"][0]["modules"] == ["documents", "schedules"]


def test_mutation_without_csrf_is_rejected(client):
    login(client, "coordinacion")
    payload = {
        "period_id": 1,
        "group": "9ZZ",
        "subject": "Prueba",
        "classroom": "15",
        "day": 6,
        "start_time": "07:00",
        "end_time": "08:00",
    }
    assert client.post("/api/admin/schedules", json=payload).status_code == 403


def test_logout_invalidates_session(client):
    headers = login(client, "control")
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_department_cannot_use_other_modules(make_client):
    control = make_client()
    login(control, "control")
    assert control.get("/api/admin/documents").status_code == 200
    assert control.get("/api/admin/schedules").status_code == 403
    assert control.get("/api/admin/reports").status_code == 403
    assert control.get("/api/admin/locations").status_code == 403
    assert control.get("/api/superadmin/users").status_code == 403


def test_forged_frontend_role_is_ignored(make_client):
    """Aunque el cliente envíe datos de rol, el backend solo usa la sesión."""
    c = make_client()
    login(c, "mantenimiento")
    response = c.get("/api/superadmin/metrics", headers={"X-Role": "superadmin"}, cookies={"role": "superadmin"})
    assert response.status_code == 403


def test_superadmin_creates_user_with_department(make_client):
    admin = make_client()
    headers = login(admin, "super")
    deps = admin.get("/api/superadmin/departments").json()["departments"]
    maint = next(d for d in deps if d["code"] == "MANTENIMIENTO")
    created = admin.post(
        "/api/superadmin/users",
        headers=headers,
        json={
            "email": "Nuevo@Unismart.test",
            "full_name": "Nuevo Técnico",
            "password": "Tecnico2026seguro",
            "department_ids": [maint["id"]],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["email"] == "nuevo@unismart.test"
    weak = admin.post(
        "/api/superadmin/users",
        headers=headers,
        json={
            "email": "otro@unismart.test",
            "full_name": "Otro",
            "password": "soloLetrasLargas",
            "department_ids": [maint["id"]],
        },
    )
    assert weak.status_code == 422
    new_client = make_client()
    new_client.post("/api/auth/login", json={"email": "nuevo@unismart.test", "password": "Tecnico2026seguro"})
    assert new_client.get("/api/admin/reports").status_code == 200


def test_superadmin_cannot_remove_last_superadmin(make_client):
    admin = make_client()
    headers = login(admin, "super")
    me = admin.get("/api/auth/me").json()
    response = admin.patch(f"/api/superadmin/users/{me['id']}", headers=headers, json={"is_active": False})
    assert response.status_code == 422


def test_disabled_department_loses_access(make_client):
    admin, staff = make_client(), make_client()
    headers = login(admin, "super")
    login(staff, "campus")
    deps = admin.get("/api/superadmin/departments").json()["departments"]
    campus = next(d for d in deps if d["code"] == "SERVICIOS_CAMPUS")
    assert (
        admin.patch(
            f"/api/superadmin/departments/{campus['id']}", headers=headers, json={"modules": ["reports"]}
        ).status_code
        == 200
    )
    assert staff.get("/api/admin/locations").status_code == 403
    assert staff.get("/api/admin/reports").status_code == 200


def test_metrics_and_audit(make_client):
    admin = make_client()
    login(admin, "super")
    metrics = admin.get("/api/superadmin/metrics").json()
    assert metrics["departments"] == 5 and metrics["users"]["total"] == len(USERS)
    logs = admin.get("/api/superadmin/audit").json()["logs"]
    assert any(log["action"] == "auth.login" for log in logs)
