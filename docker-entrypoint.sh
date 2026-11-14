#!/bin/bash
# Container entrypoint for the Omada Controller.
#
# 1. A pid file left behind by a killed run (docker stop/kill, host crash)
#    makes jsvc refuse to start ("Still running according to PID file"), and
#    `tpeap start` then waits up to 40 minutes for a controller that never
#    comes up. /var/run is not on a volume but survives a container restart,
#    so clear it here: at container start nothing from a previous run can be
#    alive.
# 2. bash as PID 1 ignores SIGTERM unless it traps it, so `docker stop` used
#    to wait out the grace period and then SIGKILL the JVM and MongoDB. Trap
#    it and run `tpeap stop`, which shuts both down cleanly and removes the
#    pid file itself.

PID_FILE=/var/run/omada.pid
LOG_FILE="${WORK_DIR:-/opt/tplink/EAPController}/logs/server.log"

if [ -s "${PID_FILE}" ]; then
    echo "Clearing stale ${PID_FILE} (pid $(cat "${PID_FILE}")) from a previous run."
    : > "${PID_FILE}"
fi

stopping=0
shutdown() {
    [ ${stopping} -eq 1 ] && return
    stopping=1
    echo "Received stop signal, stopping Omada Controller..."
    tpeap stop
    [ -n "${tail_pid:-}" ] && kill "${tail_pid}" 2>/dev/null
    exit 0
}
trap shutdown TERM INT

# Run start in the background and wait on it, so a stop signal that arrives
# while the controller is still booting is handled right away.
tpeap start &
wait $!

tail -F "${LOG_FILE}" &
tail_pid=$!
wait "${tail_pid}"
