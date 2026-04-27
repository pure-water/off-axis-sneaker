# from repo root
curl -L "$(cat public/models/shoe.glb)" -o public/models/shoe.glb
curl -L "$(cat public/models/face.glb)" -o public/models/face.glb

# verify they are now binary and non-tiny
ls -lh public/models/shoe.glb public/models/face.glb
