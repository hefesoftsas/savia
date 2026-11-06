#!/usr/bin/env bash

# The source dump creates its own PostGIS extensions and schemas.  Replacing
# the image's initialization hook avoids creating those objects twice.
:
