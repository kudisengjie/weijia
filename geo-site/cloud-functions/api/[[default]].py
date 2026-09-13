import sys
from pathlib import Path

from fastapi import FastAPI


# EdgeOne loads the route file from cloud-functions/api; make the shared package
# resolvable even when only the route directory is initially present on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geo_backend.app import create_app


# EdgeOne identifies this file as an ASGI entry through the FastAPI instance.
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/", create_app())
