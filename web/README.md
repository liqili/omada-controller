# Omada Mobile-First Dashboard

A responsive React dashboard for the TP-Link Omada SDN Controller (v5.15.6.7),
built to work on phones, tablets, and desktops. It talks to the controller
through a hybrid API strategy (official OpenAPI + internal `/api/v2` web API,
verified against `docs/api-spec.yaml`).

## Stack

React 18 · TypeScript · Vite · MUI v5 · React Router v6 · TanStack Query v5

## Layout

| Path | Purpose |
|---|---|
| `docs/api-spec.yaml` | OpenAPI spec generated from the controller's compiled DTO classes |
| `docs/api-endpoints.txt` | All `/api/v2` paths extracted from the vendor SPA jar |
| `scripts/extract-endpoints.sh` | Regenerate `docs/api-endpoints.txt` |
| `src/api/` | axios client (`{errCode,data}` envelope + token), domain clients |
| `src/auth/` | login, token session, route guard |
| `src/layout/` | responsive shell: drawer nav (hamburger on mobile), site selector |
| `src/pages/` | Dashboard, Devices, Clients, Logs, Wireless, Network, VPN, Authentication, Guest control, Services, RF planning, Site settings, Controller settings, Accounts, Upgrades |
| `src/components/SettingsKit.tsx` | shared settings building blocks (resource form card, read-only list, draft/save) |
| `sim/` | device simulator (`omada-sim.mjs`) and its end-to-end scenario (`scenario.mjs`) |
| `terminal/` | WebSocket ⇄ SSH gateway behind the device page's Terminal tab (own container) |
| `docs/HANDOFF.md` | live-verified endpoint/verb table, current state, open items |
| `nginx.conf.template` + `Dockerfile` | static serving + `/controller-api` reverse proxy; controller address from `OMADA_CONTROLLER_URL` |
| `docker-compose.standalone.yml` | web UI + terminal gateway alone, for a controller that already runs elsewhere |

## Dev

```bash
npm install
# controller must be reachable at https://localhost:8043 (docker compose up)
npm run dev        # http://localhost:5173
npm test           # vitest
npm run build      # production bundle in dist/
npm run gen:api    # regenerate typed client from docs/api-spec.yaml
```

## Testing without hardware

No real device can be faked at the protocol level (devices authenticate to the
controller with vendor TLS certificates), so `sim/omada-sim.mjs` simulates them
at the API layer: it serves the built dashboard on http://localhost:8090 and
proxies every request to the real controller, adding three simulated devices
that can be adopted, provisioned, rebooted and forgotten. Saving a real setting
(for example a new SSID) re-provisions the simulated devices from the
controller's real configuration.

```bash
npm run build
npm run sim                                   # http://localhost:8090
OMADA_PASS=... npm run sim:scenario           # scripted run, 20 checks, cleans up after itself
```

Simulated devices carry a "Simulated" chip and never reach the controller's
database. Details in `docs/HANDOFF.md` §6.

## Deployment

The web-ui container's nginx serves the dashboard and proxies `/controller-api/*`
to the controller, so the browser never deals with CORS or the self-signed cert,
and `/terminal/ws` to the terminal gateway. The device terminal signs in with the
site's device account and needs SSH turned on for the site (Services → SSH).
Its optional **startup command** runs instead of the login shell, on a terminal
(`ssh -t admin@<device-ip> <command>`): enter `sh` for EAPs such as the F65 whose
plain login opens TP-Link's `EAP>` CLI — their dropbear runs it as a real shell.

**With the bundled controller** (repo-root `docker-compose.yml`):
`docker-compose up -d --build --no-deps web-ui terminal` → https://&lt;host&gt;:8443 (http://&lt;host&gt;:8080 redirects there).

**With a controller you already run** (a NAS, another host): the controller is
left alone; only the dashboard and terminal gateway are deployed, and they reach
the controller at its HTTPS management address.

```bash
cd web
cp .env.example .env        # set OMADA_CONTROLLER_URL=https://<controller-ip>:8043
docker compose -f docker-compose.standalone.yml up -d --build
```

Then open https://&lt;host&gt;:8443 and sign in with the controller's admin account
(http://&lt;host&gt;:8080 redirects there). The certificate is self-signed, created on
first start and kept on the `web-ui-certs` volume, so the browser warns once; put
your own `tls.crt` and `tls.key` in that volume to avoid it.
The host running the web UI must reach the controller on its HTTPS port (8043 by
default). `OMADA_CONTROLLER_URL` is scheme, host and port only; a trailing `/`
is dropped and anything else stops the container with a message. A hostname must
resolve when the container starts (an IP address always works). The UI was
built and verified against controller 5.15.6.7.

## Roadmap

- **P1 (now):** login, dashboard, devices, clients — read-only monitoring
- **P2:** device actions (reboot/locate/ports), WLAN/SSID, gateway settings
- **P3:** client control, guest portal, alerts, insight/statistics charts
- **P4:** upgrades/maintenance, users/sites, controller settings, PWA install
