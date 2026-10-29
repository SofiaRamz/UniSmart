"""Puntos del mapa del campus (módulo 'locations', p. ej. Servicios del Campus)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select

from .. import serializers
from ..deps import DbSession, Principal, audit, require_module
from ..models import CampusLocation
from ..schemas import LocationIn

router = APIRouter(prefix="/api/admin/locations", tags=["ubicaciones"])
LocPrincipal = Annotated[Principal, Depends(require_module("locations"))]


def _owner(principal: Principal, requested: int | None) -> int | None:
    allowed = principal.department_ids("locations")
    if requested is None:
        return next(iter(allowed)) if len(allowed) == 1 else None
    if not principal.can("locations", requested):
        raise HTTPException(status_code=403, detail="No puedes asignar ubicaciones a otro departamento")
    return requested


def _get_owned(db, principal: Principal, location_id: int) -> CampusLocation:
    loc = db.get(CampusLocation, location_id)
    if loc is None:
        raise HTTPException(status_code=404, detail="Ubicación no encontrada")
    # Las ubicaciones sin dueño (carga inicial) las puede editar cualquier área con el módulo.
    if loc.department_id is not None and not principal.can("locations", loc.department_id):
        raise HTTPException(status_code=403, detail="Esta ubicación pertenece a otro departamento")
    return loc


@router.get("")
def list_locations(principal: LocPrincipal, db: DbSession) -> dict:
    locs = db.scalars(select(CampusLocation).order_by(CampusLocation.name))
    return {
        "locations": [
            {
                **serializers.location(loc),
                "editable": loc.department_id is None or principal.can("locations", loc.department_id),
            }
            for loc in locs
        ]
    }


@router.post("", status_code=201)
def create_location(payload: LocationIn, principal: LocPrincipal, request: Request, db: DbSession) -> dict:
    loc = CampusLocation(
        **payload.model_dump(exclude={"department_id"}), department_id=_owner(principal, payload.department_id)
    )
    db.add(loc)
    db.flush()
    audit(db, request, principal.user, "location.create", "campus_location", loc.id, name=loc.name)
    db.commit()
    return serializers.location(loc)


@router.put("/{location_id}")
def update_location(
    location_id: int, payload: LocationIn, principal: LocPrincipal, request: Request, db: DbSession
) -> dict:
    loc = _get_owned(db, principal, location_id)
    for key, value in payload.model_dump(exclude={"department_id"}).items():
        setattr(loc, key, value)
    if payload.department_id is not None:
        loc.department_id = _owner(principal, payload.department_id)
    audit(db, request, principal.user, "location.update", "campus_location", loc.id, name=loc.name)
    db.commit()
    db.refresh(loc)
    return serializers.location(loc)


@router.delete("/{location_id}", status_code=204, response_class=Response)
def delete_location(location_id: int, principal: LocPrincipal, request: Request, db: DbSession) -> Response:
    loc = _get_owned(db, principal, location_id)
    audit(db, request, principal.user, "location.delete", "campus_location", loc.id, name=loc.name)
    db.delete(loc)
    db.commit()
    return Response(status_code=204)
