"""Horarios estructurados: alta, empalmes, importación CSV y consultas exactas del chat."""

from __future__ import annotations

from pathlib import Path

from .conftest import login

SAMPLE = Path(__file__).resolve().parent.parent / "data" / "horarios_ejemplo.csv"


def _import_sample(client, headers) -> dict:
    with SAMPLE.open("rb") as fh:
        response = client.post(
            "/api/admin/schedules/import?dry_run=false&mode=replace",
            headers=headers,
            files={"file": ("horarios.csv", fh, "text/csv")},
        )
    assert response.status_code == 200, response.text
    return response.json()


def test_csv_dry_run_does_not_write(client):
    headers = login(client, "coordinacion")
    with SAMPLE.open("rb") as fh:
        preview = client.post(
            "/api/admin/schedules/import", headers=headers, files={"file": ("h.csv", fh, "text/csv")}
        ).json()
    assert preview["valid_rows"] == 80 and preview["errors"] == [] and preview["created"] == 0
    assert client.get("/api/public/schedules?group=1AS").json()["entries"] == []


def test_import_and_public_query(client):
    headers = login(client, "coordinacion")
    assert _import_sample(client, headers)["created"] == 80
    entries = client.get("/api/public/schedules?group=3AS&day=1").json()["entries"]
    assert len(entries) == 4 and {e["classroom"] for e in entries} == {"16"}
    options = client.get("/api/public/schedules/options").json()
    assert options["groups"] == ["1AS", "3AS", "5AS", "7AS"]
    assert options["active_period"]["code"] == "2026-AGO-DIC"


def test_conflicting_entry_is_rejected(client):
    headers = login(client, "coordinacion")
    _import_sample(client, headers)
    period_id = client.get("/api/public/schedules/options").json()["active_period"]["id"]
    clash = client.post(
        "/api/admin/schedules",
        headers=headers,
        json={
            "period_id": period_id,
            "group": "9XX",
            "subject": "Seminario",
            "classroom": "15",
            "day": 1,
            "start_time": "08:00",
            "end_time": "09:00",
        },
    )
    assert clash.status_code == 409
    assert "aula 15" in " ".join(clash.json()["detail"]["conflicts"]).lower()
    ok = client.post(
        "/api/admin/schedules",
        headers=headers,
        json={
            "period_id": period_id,
            "group": "9XX",
            "subject": "Seminario",
            "classroom": "15",
            "day": 6,
            "start_time": "08:00",
            "end_time": "09:00",
        },
    )
    assert ok.status_code == 201 and ok.json()["day_name"] == "Sábado"


def test_other_department_cannot_edit_schedules(make_client):
    c = make_client()
    headers = login(c, "control")
    assert (
        c.post("/api/admin/schedules/import", headers=headers, files={"file": ("h.csv", b"x", "text/csv")}).status_code
        == 403
    )


def test_chat_answers_classroom_exactly_without_llm(client, app):
    headers = login(client, "coordinacion")
    _import_sample(client, headers)
    response = client.post("/api/public/chat", json={"message": "¿En qué salón toma clases el grupo 3AS?"}).json()
    assert response["route"] == "schedule" and response["answered"] is True
    assert "Aula 16" in response["answer"] and "Aula 15" not in response["answer"]
    assert {e["group"] for e in response["schedule"]} == {"3AS"}
    assert app.state.fake_llm.calls == []  # los horarios nunca pasan por el modelo


def test_chat_unknown_group_says_no_info(client):
    headers = login(client, "coordinacion")
    _import_sample(client, headers)
    response = client.post("/api/public/chat", json={"message": "¿Qué clases tiene el grupo 9AS?"}).json()
    assert response["answered"] is False and "No tengo información oficial" in response["answer"]


def test_chat_asks_for_group_when_missing(client):
    response = client.post("/api/public/chat", json={"message": "¿Qué clases hay el lunes?"}).json()
    assert response["route"] == "clarify"


def test_chat_location_question(client):
    response = client.post("/api/public/chat", json={"message": "¿Dónde está la biblioteca?"}).json()
    assert response["route"] == "location" and response["location"]["name"] == "Biblioteca Central"
