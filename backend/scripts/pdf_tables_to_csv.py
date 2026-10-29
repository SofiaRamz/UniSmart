"""Detecta tablas de un PDF de horarios con PyMuPDF (sin IA) y las guarda como CSV para revisión humana.

Uso (desde backend/):
    python -m scripts.pdf_tables_to_csv docs/horario_2026B.pdf
Genera una carpeta horario_2026B_tablas/ con un CSV por tabla. Después, copia los datos verificados
a la plantilla data/horarios_plantilla.csv y súbelos con scripts.import_schedules.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from app.services.pdf_extract import extract_tables


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extraer tablas de un PDF a CSV")
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args(argv)
    tables = extract_tables(args.pdf)
    if not tables:
        print("No se detectaron tablas. Si el PDF es escaneado, captura el horario directamente en la plantilla CSV.")
        return 1
    out_dir = args.pdf.with_name(f"{args.pdf.stem}_tablas")
    out_dir.mkdir(exist_ok=True)
    for i, (page, rows) in enumerate(tables, start=1):
        target = out_dir / f"pagina{page:02d}_tabla{i:02d}.csv"
        with target.open("w", encoding="utf-8-sig", newline="") as fh:
            csv.writer(fh).writerows(rows)
        print(f"Página {page}: {len(rows)} filas → {target}")
    print("Revisa cada tabla contra el documento impreso antes de importarla.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
