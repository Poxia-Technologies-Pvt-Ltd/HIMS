# Keeps the reverse SSH tunnel to jh-lims open so the HMIS on this PC is
# reachable at https://surgimax-hospital.dvaic.com. Reconnects on any drop.
# Run at startup (Task Scheduler) or as a service (NSSM).
#   -LocalPort: 5011 for the Docker deployment, 5714 for the dev server.
param([int]$LocalPort = 5011, [string]$Key = "C:\surgimax\surgimax_tunnel")
while ($true) {
  ssh -i $Key -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes `
      -o StrictHostKeyChecking=accept-new -R "127.0.0.1:7060:localhost:$LocalPort" surgimaxtunnel@35.154.15.135
  Start-Sleep -Seconds 10
}
