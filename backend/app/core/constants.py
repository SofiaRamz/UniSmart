"""Catálogos compartidos entre modelos, validaciones y frontend."""

MODULES = ("documents", "schedules", "reports", "locations")
MODULE_LABELS = {
    "documents": "Documentos",
    "schedules": "Horarios",
    "reports": "Reportes",
    "locations": "Ubicaciones",
}
DOCUMENT_STATUSES = ("processing", "indexed", "failed")
LOCATION_KINDS = ("edificio", "aula", "oficina", "servicio", "acceso", "area_verde", "deportivo", "estacionamiento")
