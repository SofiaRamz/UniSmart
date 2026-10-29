-- Se ejecuta una sola vez al crear el contenedor: extensión vector y base para pruebas.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE DATABASE unismart_test OWNER unismart;
\connect unismart_test
CREATE EXTENSION IF NOT EXISTS vector;
