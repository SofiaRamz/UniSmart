"""Importa horarios oficiales desde CSV directamente a PostgreSQL (sin pasar por la IA).

Uso (desde backend/):
    python -m scripts.import_schedules data/horarios_2026B.csv --dry-run        # solo valida
    python -m scripts.import_schedules data/horarios_2026B.csv --replace        # reemplaza el periodo
    python -m scripts.import_schedules data/horarios_2026B.csv --create-period "2026-AGO-DIC" "Agosto–Diciembre 2026"
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import update

from app.core.schedule_csv import parse_schedule_csv
from app.db import SessionLocal
from app.models import AcademicPeriod
from app.services.schedules import get_period_by_code, import_rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Importar horarios desde CSV")
    parser.add_argument("csv", type=Path, help="Archivo CSV con la plantilla oficial")
    parser.add_argument("--dry-run", action="store_true", help="Validar sin guardar")
    parser.add_argument("--replace", action="store_true", help="Borrar antes los horarios de los periodos del archivo")
    parser.add_argument("--create-period", nargs=2, metavar=("CODIGO", "NOMBRE"), help="Crear y activar el periodo")
    args = parser.parse_args(argv)

    rows, errors = parse_schedule_csv(args.csv.read_bytes())
    print(f"Filas válidas: {len(rows)} · Errores: {len(errors)}")
    for err in errors[:50]:
        print(f"  línea {err.line} [{err.field}]: {err.message}")
    if errors:
        print("Corrige el archivo y vuelve a intentarlo. No se guardó nada.")
        return 1
    if args.dry_run:
        print("Validación correcta (--dry-run): no se guardó nada.")
        return 0

    with SessionLocal() as db:
        if args.create_period:
            code, name = args.create_period[0].upper(), args.create_period[1]
            if get_period_by_code(db, code) is None:
                db.execute(update(AcademicPeriod).values(is_active=False))
                db.add(AcademicPeriod(code=code, name=name, is_active=True))
                db.flush()
                print(f"Periodo {code} creado y activado")
        try:
            summary = import_rows(db, rows, replace=args.replace, user_id=None)
        except ValueError as exc:
            db.rollback()
            print(f"Error: {exc}")
            return 1
        if summary["conflicts"]:
            db.rollback()
            print("Se encontraron empalmes con horarios ya registrados (no se guardó nada):")
            for c in summary["conflicts"][:50]:
                print(f"  línea {c['line']}: {c['message']}")
            print("Usa --replace para sustituir el horario del periodo completo.")
            return 1
        db.commit()
    print(f"Importación terminada: {summary['created']} clases creadas, {summary['deleted']} eliminadas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
