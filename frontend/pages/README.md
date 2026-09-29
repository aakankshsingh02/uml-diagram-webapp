# Intentionally empty

Next.js must find its `app` and `pages` routers in the same folder. Keeping this empty `pages/`
next to the root `app/` stops Next from picking up `src/pages`, which is the Feature-Sliced Design
`pages` layer (screens), not the Next.js Pages Router. Do not add routes here; use `app/`.
