#!/usr/bin/env bash
set -euo pipefail

curl -L "$(cat public/models/shoe.glb)" -o public/models/shoe.glb
curl -L "$(cat public/models/face.glb)" -o public/models/face.glb
