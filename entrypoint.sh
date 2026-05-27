#!/bin/bash
set -e

# Vertex AI auth is ADC via GOOGLE_APPLICATION_CREDENTIALS (mounted service-account
# JSON). Nothing to configure at entry; the app fail-fasts on missing Vertex env.
exec "$@"
